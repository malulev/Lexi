#!/usr/bin/env python3
"""
lexi-slotd: host-wide admission for agent runs.

One daemon per host. Client apps connect over a unix socket, ask for a slot,
and hold the connection for as long as their agent runs. The connection is the
lease: there is no release message, so a client that dies is a client whose
slot the kernel gives back. Design and the measurements behind every default:
docs/superpowers/specs/2026-09-14-host-admission-queue-design.md

Python 3.9+, standard library only. Runs on Linux in production and on macOS
for a developer's stress test; the two differ only inside the Platform classes.
"""
from __future__ import annotations

import asyncio
import grp
import json
import os
import pwd
import signal
import socket
import struct
import subprocess
import sys
import time
from collections import deque
from dataclasses import dataclass
from typing import Callable, Deque, Dict, List, Optional

# ---------------------------------------------------------------------------
# Sizes and configuration
# ---------------------------------------------------------------------------

_UNITS = {"K": 1024, "M": 1024 ** 2, "G": 1024 ** 3}


def parse_size(text: str) -> int:
    """'400M' -> 419430400. Bare digits are bytes."""
    raw = text.strip().upper()
    multiplier = 1
    if raw and raw[-1] in _UNITS:
        multiplier = _UNITS[raw[-1]]
        raw = raw[:-1]
    if not raw.isdigit():
        raise ValueError(f"not a size: {text!r}")
    return int(raw) * multiplier


@dataclass
class Config:
    """Every tunable, with the defaults the spec derived from measurement."""

    agent_mem_estimate: int = parse_size("400M")
    agent_mem_cap: int = parse_size("800M")
    app_rss_estimate: int = parse_size("160M")
    host_reserve: int = parse_size("600M")
    cpu_oversubscribe: float = 2.0
    brake_margin: int = parse_size("200M")
    # "peer": the kernel names the client (SO_PEERCRED). "claimed": the client
    # names itself in the acquire message. The second exists so a developer can
    # run ten fake clients from one uid on a Mac; it is never set in production.
    identity: str = "peer"
    group: str = "lexi-slots"
    socket_path: str = "/run/lexi/slotd.sock"
    clients_override: Optional[int] = None
    capacity_override: Optional[int] = None
    ring_size: int = 50
    tick_seconds: float = 1.0

    @classmethod
    def from_env(cls, env: Optional[Dict[str, str]] = None) -> "Config":
        source: Dict[str, str] = dict(os.environ) if env is None else env
        config = cls()
        sizes = {
            "AGENT_MEM_ESTIMATE": "agent_mem_estimate",
            "AGENT_MEM_CAP": "agent_mem_cap",
            "APP_RSS_ESTIMATE": "app_rss_estimate",
            "HOST_RESERVE": "host_reserve",
            "BRAKE_MARGIN": "brake_margin",
        }
        for name, attribute in sizes.items():
            if name in source:
                setattr(config, attribute, parse_size(source[name]))
        if "CPU_OVERSUBSCRIBE" in source:
            config.cpu_oversubscribe = float(source["CPU_OVERSUBSCRIBE"])
        config.identity = source.get("SLOTD_IDENTITY", config.identity)
        if config.identity not in ("peer", "claimed"):
            raise ValueError(f"SLOTD_IDENTITY must be 'peer' or 'claimed', not {config.identity!r}")
        config.group = source.get("SLOTD_GROUP", config.group)
        config.socket_path = source.get("SLOTD_SOCKET", config.socket_path)
        if "SLOTD_CLIENTS" in source:
            config.clients_override = int(source["SLOTD_CLIENTS"])
        if "SLOTD_CAPACITY" in source:
            config.capacity_override = int(source["SLOTD_CAPACITY"])
        return config


def compute_capacity(mem_total: int, cpu_count: int, clients: int, config: Config) -> int:
    """
    How many agents fit: what memory allows after every client's app and the
    host itself are reserved, capped by what the CPUs can carry. Never below
    one, or a small box could admit nobody forever.
    """
    reserve = clients * config.app_rss_estimate + config.host_reserve
    mem_slots = (mem_total - reserve) // config.agent_mem_estimate
    cpu_slots = int(cpu_count * config.cpu_oversubscribe)
    return max(1, min(mem_slots, cpu_slots))
