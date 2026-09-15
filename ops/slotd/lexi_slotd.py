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


# ---------------------------------------------------------------------------
# Platform: what the daemon needs from the host
# ---------------------------------------------------------------------------


class Platform:
    """Linux in production, Darwin on a developer's Mac, Fake in tests."""

    def mem_total(self) -> int:
        raise NotImplementedError

    def mem_available(self) -> int:
        raise NotImplementedError

    def cpu_count(self) -> int:
        return os.cpu_count() or 1

    def peer_uid(self, sock: socket.socket) -> int:
        raise NotImplementedError

    def group_members(self, group: str) -> List[str]:
        try:
            return list(grp.getgrnam(group).gr_mem)
        except KeyError:
            return []

    def uid_to_name(self, uid: int) -> Optional[str]:
        try:
            return pwd.getpwuid(uid).pw_name
        except KeyError:
            return None


def parse_meminfo(text: str) -> Dict[str, int]:
    """/proc/meminfo lines ('MemTotal:  3910784 kB') to bytes."""
    values: Dict[str, int] = {}
    for line in text.splitlines():
        if ":" not in line:
            continue
        key, rest = line.split(":", 1)
        parts = rest.split()
        if not parts or not parts[0].isdigit():
            continue
        amount = int(parts[0])
        if len(parts) > 1 and parts[1].lower() == "kb":
            amount *= 1024
        values[key.strip()] = amount
    return values


def parse_subuid(text: str, uid: int) -> Optional[str]:
    """The /etc/subuid owner of a subordinate uid, or None if it is nobody's."""
    for line in text.splitlines():
        parts = line.strip().split(":")
        if len(parts) != 3 or not (parts[1].isdigit() and parts[2].isdigit()):
            continue
        start, count = int(parts[1]), int(parts[2])
        if start <= uid < start + count:
            return parts[0]
    return None


class LinuxPlatform(Platform):
    def _meminfo(self) -> Dict[str, int]:
        with open("/proc/meminfo", encoding="utf8") as handle:
            return parse_meminfo(handle.read())

    def mem_total(self) -> int:
        return self._meminfo()["MemTotal"]

    def mem_available(self) -> int:
        return self._meminfo()["MemAvailable"]

    def peer_uid(self, sock: socket.socket) -> int:
        credentials = sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
        _pid, uid, _gid = struct.unpack("3i", credentials)
        return uid

    def uid_to_name(self, uid: int) -> Optional[str]:
        # A container process that is not root inside lands in the client's
        # subordinate range rather than on the client's own uid.
        name = super().uid_to_name(uid)
        if name is not None:
            return name
        try:
            with open("/etc/subuid", encoding="utf8") as handle:
                return parse_subuid(handle.read(), uid)
        except OSError:
            return None


def parse_vm_stat(text: str) -> int:
    """
    macOS `vm_stat` to an approximation of Linux's MemAvailable: pages that
    are free, inactive, speculative or purgeable, times the page size. Good
    enough to drive a brake on a developer's Mac; never used in production.
    """
    page_size = 4096
    pages: Dict[str, int] = {}
    for line in text.splitlines():
        if "page size of" in line:
            page_size = int(line.split("page size of")[1].split()[0])
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        value = value.strip().rstrip(".")
        if value.isdigit():
            pages[key.strip()] = int(value)
    wanted = ("Pages free", "Pages inactive", "Pages speculative", "Pages purgeable")
    return sum(pages.get(key, 0) for key in wanted) * page_size


class DarwinPlatform(Platform):
    # Python does not export these on macOS. getsockopt(SOL_LOCAL, LOCAL_PEERCRED)
    # fills a struct xucred whose first two fields are the version and the uid;
    # the rest (group list) is not needed and its layout is not relied on.
    _SOL_LOCAL = 0
    _LOCAL_PEERCRED = 0x0001
    _XUCRED_SIZE = 76

    def mem_total(self) -> int:
        return int(subprocess.check_output(["sysctl", "-n", "hw.memsize"]).decode().strip())

    def mem_available(self) -> int:
        return parse_vm_stat(subprocess.check_output(["vm_stat"]).decode())

    def peer_uid(self, sock: socket.socket) -> int:
        credentials = sock.getsockopt(self._SOL_LOCAL, self._LOCAL_PEERCRED, self._XUCRED_SIZE)
        _version, uid = struct.unpack_from("II", credentials)
        return uid


class FakePlatform(Platform):
    """Every reading settable: tests, and the harness when it fakes memory."""

    def __init__(
        self,
        mem_total: int = 8 * 1024 ** 3,
        mem_available: int = 4 * 1024 ** 3,
        cpu_count: int = 4,
        uid: int = 1000,
        members: Optional[List[str]] = None,
        names: Optional[Dict[int, str]] = None,
    ) -> None:
        self.total = mem_total
        self.available = mem_available
        self.cpus = cpu_count
        self.uid = uid
        self.members = list(members or [])
        self.names: Dict[int, str] = dict(names or {})

    def mem_total(self) -> int:
        return self.total

    def mem_available(self) -> int:
        return self.available

    def cpu_count(self) -> int:
        return self.cpus

    def peer_uid(self, sock: object) -> int:
        return self.uid

    def group_members(self, group: str) -> List[str]:
        return list(self.members)

    def uid_to_name(self, uid: int) -> Optional[str]:
        return self.names.get(uid)


def detect_platform() -> Platform:
    return DarwinPlatform() if sys.platform == "darwin" else LinuxPlatform()
