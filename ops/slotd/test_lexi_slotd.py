"""
Tests for lexi-slotd. Standard library only, no root, no Docker.
Run: python3 -m unittest discover -s ops/slotd -p 'test_*.py' -v
"""
from __future__ import annotations

import unittest

import lexi_slotd as slotd


class SizesAndConfig(unittest.TestCase):
    def test_parse_size_reads_bytes_kilo_mega_giga(self):
        self.assertEqual(slotd.parse_size("400"), 400)
        self.assertEqual(slotd.parse_size("400K"), 400 * 1024)
        self.assertEqual(slotd.parse_size("400M"), 400 * 1024 ** 2)
        self.assertEqual(slotd.parse_size("2G"), 2 * 1024 ** 3)
        self.assertEqual(slotd.parse_size(" 800m "), 800 * 1024 ** 2)

    def test_parse_size_refuses_nonsense(self):
        for bad in ("", "M", "4.5G", "four", "-1M"):
            with self.assertRaises(ValueError, msg=bad):
                slotd.parse_size(bad)

    def test_config_defaults_match_the_spec(self):
        config = slotd.Config.from_env({})
        self.assertEqual(config.agent_mem_estimate, slotd.parse_size("400M"))
        self.assertEqual(config.agent_mem_cap, slotd.parse_size("800M"))
        self.assertEqual(config.app_rss_estimate, slotd.parse_size("160M"))
        self.assertEqual(config.host_reserve, slotd.parse_size("600M"))
        self.assertEqual(config.cpu_oversubscribe, 2.0)
        self.assertEqual(config.brake_margin, slotd.parse_size("200M"))
        self.assertEqual(config.identity, "peer")
        self.assertEqual(config.group, "lexi-slots")
        self.assertEqual(config.socket_path, "/run/lexi/slotd.sock")
        self.assertIsNone(config.clients_override)
        self.assertIsNone(config.capacity_override)

    def test_config_reads_every_override(self):
        config = slotd.Config.from_env({
            "AGENT_MEM_ESTIMATE": "300M",
            "AGENT_MEM_CAP": "1G",
            "APP_RSS_ESTIMATE": "100M",
            "HOST_RESERVE": "1G",
            "CPU_OVERSUBSCRIBE": "1.5",
            "BRAKE_MARGIN": "50M",
            "SLOTD_IDENTITY": "claimed",
            "SLOTD_GROUP": "editors",
            "SLOTD_SOCKET": "/tmp/x.sock",
            "SLOTD_CLIENTS": "7",
            "SLOTD_CAPACITY": "3",
        })
        self.assertEqual(config.agent_mem_estimate, slotd.parse_size("300M"))
        self.assertEqual(config.agent_mem_cap, slotd.parse_size("1G"))
        self.assertEqual(config.app_rss_estimate, slotd.parse_size("100M"))
        self.assertEqual(config.host_reserve, slotd.parse_size("1G"))
        self.assertEqual(config.cpu_oversubscribe, 1.5)
        self.assertEqual(config.brake_margin, slotd.parse_size("50M"))
        self.assertEqual(config.identity, "claimed")
        self.assertEqual(config.group, "editors")
        self.assertEqual(config.socket_path, "/tmp/x.sock")
        self.assertEqual(config.clients_override, 7)
        self.assertEqual(config.capacity_override, 3)

    def test_config_refuses_an_unknown_identity_mode(self):
        with self.assertRaises(ValueError):
            slotd.Config.from_env({"SLOTD_IDENTITY": "trust-me"})


class Capacity(unittest.TestCase):
    """The table in the spec, on the measured host: 3819 MB, 2 vCPU."""

    MB = 1024 ** 2

    def test_two_clients_on_the_measured_host_is_four_slots(self):
        config = slotd.Config.from_env({})
        self.assertEqual(slotd.compute_capacity(3819 * self.MB, 2, 2, config), 4)

    def test_ten_clients_on_the_measured_host_is_still_four_slots(self):
        config = slotd.Config.from_env({})
        self.assertEqual(slotd.compute_capacity(3819 * self.MB, 10, 10, config), 4)

    def test_memory_binds_before_cpu_when_the_reserve_is_large(self):
        config = slotd.Config.from_env({})
        # 20 clients: reserve 20*160+600 = 3800 MB; nothing left -> floor of 1.
        self.assertEqual(slotd.compute_capacity(3819 * self.MB, 8, 20, config), 1)

    def test_cpu_binds_on_a_big_box(self):
        config = slotd.Config.from_env({})
        # 64 GB, 4 cores, 2 clients: memory allows ~160, CPU allows 8.
        self.assertEqual(slotd.compute_capacity(64 * 1024 * self.MB, 4, 2, config), 8)

    def test_never_below_one(self):
        config = slotd.Config.from_env({})
        self.assertEqual(slotd.compute_capacity(100 * self.MB, 1, 50, config), 1)

    def test_overrides_change_the_answer(self):
        config = slotd.Config.from_env({"AGENT_MEM_ESTIMATE": "200M", "CPU_OVERSUBSCRIBE": "4"})
        self.assertEqual(slotd.compute_capacity(3819 * self.MB, 2, 2, config), 8)


if __name__ == "__main__":
    unittest.main()


# ---------------------------------------------------------------------------
# Platform
# ---------------------------------------------------------------------------
import os
import socket


MEMINFO = """MemTotal:        3910784 kB
MemFree:          855040 kB
MemAvailable:    2928640 kB
Buffers:          123456 kB
"""

SUBUID = """malulev:100000:65536
imidan:165536:65536
claude:231072:65536
"""

VM_STAT = """Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                4355.
Pages active:                            375519.
Pages inactive:                          373570.
Pages speculative:                          516.
Pages throttled:                              0.
Pages wired down:                        190991.
Pages purgeable:                          15148.
"""


def pwd_name() -> str:
    import pwd
    return pwd.getpwuid(os.getuid()).pw_name


class PlatformParsing(unittest.TestCase):
    def test_meminfo_is_read_in_bytes(self):
        values = slotd.parse_meminfo(MEMINFO)
        self.assertEqual(values["MemTotal"], 3910784 * 1024)
        self.assertEqual(values["MemAvailable"], 2928640 * 1024)

    def test_subuid_maps_a_subordinate_uid_to_its_owner(self):
        self.assertEqual(slotd.parse_subuid(SUBUID, 165536), "imidan")
        self.assertEqual(slotd.parse_subuid(SUBUID, 165536 + 65535), "imidan")
        self.assertEqual(slotd.parse_subuid(SUBUID, 100000), "malulev")
        self.assertIsNone(slotd.parse_subuid(SUBUID, 99999))
        self.assertIsNone(slotd.parse_subuid(SUBUID, 1000))

    def test_vm_stat_approximates_available_memory(self):
        expected = (4355 + 373570 + 516 + 15148) * 16384
        self.assertEqual(slotd.parse_vm_stat(VM_STAT), expected)


class PlatformOnThisMachine(unittest.TestCase):
    """The one real kernel call: the peer of a socketpair is this process."""

    def test_peer_uid_of_a_socketpair_is_our_own_uid(self):
        platform = slotd.detect_platform()
        left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            self.assertEqual(platform.peer_uid(right), os.getuid())
        finally:
            left.close()
            right.close()

    def test_real_readings_are_positive(self):
        platform = slotd.detect_platform()
        self.assertGreater(platform.mem_total(), 0)
        self.assertGreater(platform.mem_available(), 0)
        self.assertGreaterEqual(platform.cpu_count(), 1)

    def test_our_own_uid_has_a_name(self):
        platform = slotd.detect_platform()
        self.assertEqual(platform.uid_to_name(os.getuid()), pwd_name())


class FakePlatformBehaves(unittest.TestCase):
    def test_every_reading_is_settable(self):
        fake = slotd.FakePlatform(mem_total=10, mem_available=5, cpu_count=3, uid=42,
                                  members=["a", "b"], names={42: "a"})
        self.assertEqual(fake.mem_total(), 10)
        self.assertEqual(fake.mem_available(), 5)
        self.assertEqual(fake.cpu_count(), 3)
        self.assertEqual(fake.peer_uid(None), 42)
        self.assertEqual(fake.group_members("anything"), ["a", "b"])
        self.assertEqual(fake.uid_to_name(42), "a")
        self.assertIsNone(fake.uid_to_name(7))


# ---------------------------------------------------------------------------
# Broker
# ---------------------------------------------------------------------------
import asyncio


class Clock:
    """Deterministic time for the broker; advance() also lets the loop run."""

    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    async def advance(self, seconds: float) -> None:
        self.now += seconds
        await asyncio.sleep(0)


def make_broker(capacity=2, mem_available=None, ring=None, clock=None, tick_seconds=0.01):
    config = slotd.Config.from_env({})
    config.tick_seconds = tick_seconds
    platform = slotd.FakePlatform(mem_available=mem_available if mem_available is not None else 4 * 1024 ** 3)
    broker = slotd.Broker(config, platform, capacity, clock=clock or Clock())
    for held in ring or []:
        broker.held_ring.append(held)
    return broker, platform


async def ask(broker, client, request_id="r", max_wait_ms=None):
    """Start an acquire; returns (task, list of queued positions announced)."""
    positions: list = []
    task = asyncio.ensure_future(broker.acquire(client, request_id, max_wait_ms, positions.append))
    await asyncio.sleep(0)
    return task, positions


class BrokerQueue(unittest.IsolatedAsyncioTestCase):
    async def test_grants_at_once_below_capacity_without_announcing_a_wait(self):
        broker, _ = make_broker(capacity=2)
        task, positions = await ask(broker, "a")
        grant = await task
        self.assertIsInstance(grant, slotd.Grant)
        self.assertEqual(grant.memory_bytes, slotd.parse_size("800M"))
        self.assertEqual(positions, [])

    async def test_queues_in_arrival_order_and_promotes_exactly_the_next_on_release(self):
        broker, _ = make_broker(capacity=1)
        first, _ = await ask(broker, "a")
        second, second_positions = await ask(broker, "b")
        third, third_positions = await ask(broker, "c")
        self.assertTrue(first.done())
        self.assertFalse(second.done())
        self.assertFalse(third.done())
        self.assertEqual(second_positions, [1])
        self.assertEqual(third_positions, [2])

        broker.release("a")
        await asyncio.sleep(0)
        self.assertTrue(second.done())
        self.assertFalse(third.done())

        broker.release("b")
        await asyncio.sleep(0)
        self.assertTrue(third.done())

    async def test_a_client_that_already_holds_or_waits_is_refused(self):
        broker, _ = make_broker(capacity=1)
        holder, _ = await ask(broker, "a")
        await holder
        again, _ = await ask(broker, "a")
        self.assertEqual((await again).reason, "already_holding")

        waiter, _ = await ask(broker, "b")
        twice, _ = await ask(broker, "b")
        self.assertEqual((await twice).reason, "already_holding")
        waiter.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await waiter

    async def test_a_waiter_that_leaves_is_withdrawn_and_the_next_is_served(self):
        broker, _ = make_broker(capacity=1)
        holder, _ = await ask(broker, "a")
        await holder
        leaver, _ = await ask(broker, "b")
        stayer, _ = await ask(broker, "c")
        leaver.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await leaver
        broker.release("a")
        await asyncio.sleep(0)
        self.assertTrue(stayer.done())
        self.assertEqual(broker.status()["queued"], 0)

    async def test_release_records_how_long_the_lease_was_held(self):
        clock = Clock()
        broker, _ = make_broker(capacity=1, clock=clock)
        task, _ = await ask(broker, "a")
        await task
        await clock.advance(12.5)
        broker.release("a")
        self.assertEqual(list(broker.held_ring), [12.5])

    async def test_capacity_can_be_raised_live(self):
        broker, _ = make_broker(capacity=1)
        first, _ = await ask(broker, "a")
        await first
        second, _ = await ask(broker, "b")
        self.assertFalse(second.done())
        broker.capacity = 2
        broker.pump()
        await asyncio.sleep(0)
        self.assertTrue(second.done())


class BrokerEarlyRefusal(unittest.IsolatedAsyncioTestCase):
    async def test_without_history_a_long_queue_simply_queues(self):
        broker, _ = make_broker(capacity=1)
        first, _ = await ask(broker, "a")
        await first
        waiter, positions = await ask(broker, "b", max_wait_ms=1000)
        self.assertFalse(waiter.done())
        self.assertEqual(positions, [1])
        waiter.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await waiter

    async def test_with_history_a_projected_wait_past_the_ceiling_is_refused_at_once(self):
        # p50 held = 60s, capacity 1: position 1 projects 60s; a 30s ceiling is hopeless.
        broker, _ = make_broker(capacity=1, ring=[60.0, 60.0, 60.0])
        first, _ = await ask(broker, "a")
        await first
        hopeless, positions = await ask(broker, "b", max_wait_ms=30_000)
        self.assertEqual((await hopeless).reason, "projected_wait_exceeds_ceiling")
        self.assertEqual(positions, [])
        self.assertEqual(broker.status()["refused"]["projected_wait_exceeds_ceiling"], 1)

    async def test_with_history_a_reachable_wait_queues(self):
        broker, _ = make_broker(capacity=1, ring=[10.0])
        first, _ = await ask(broker, "a")
        await first
        fine, _ = await ask(broker, "b", max_wait_ms=30_000)
        self.assertFalse(fine.done())
        fine.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await fine


class BrokerBrake(unittest.IsolatedAsyncioTestCase):
    async def test_a_free_slot_is_not_granted_while_available_memory_is_below_the_threshold(self):
        # threshold = 400M estimate + 200M margin = 600M
        broker, platform = make_broker(capacity=2, mem_available=slotd.parse_size("500M"))
        task, positions = await ask(broker, "a")
        self.assertFalse(task.done())
        self.assertEqual(positions, [1])
        self.assertTrue(broker.braked)
        self.assertTrue(broker.status()["braked"])

        platform.available = slotd.parse_size("700M")
        await asyncio.sleep(0.05)  # a tick
        self.assertTrue(task.done())
        self.assertFalse(broker.braked)

    async def test_a_braked_head_that_reaches_its_ceiling_is_refused(self):
        clock = Clock()
        broker, _ = make_broker(capacity=2, mem_available=slotd.parse_size("100M"), clock=clock)
        task, _ = await ask(broker, "a", max_wait_ms=5_000)
        self.assertFalse(task.done())
        await clock.advance(6)
        await asyncio.sleep(0.05)
        self.assertEqual((await task).reason, "projected_wait_exceeds_ceiling")
        self.assertEqual(broker.status()["queued"], 0)


class BrokerStatus(unittest.IsolatedAsyncioTestCase):
    async def test_status_reports_the_whole_picture(self):
        broker, platform = make_broker(capacity=2, ring=[4.0, 6.0, 8.0])
        holder, _ = await ask(broker, "a", request_id="req-a")
        await holder
        status = broker.status()
        self.assertEqual(status["capacity"], 2)
        self.assertEqual(status["leased"], 1)
        self.assertEqual(status["queued"], 0)
        self.assertEqual(status["braked"], False)
        self.assertEqual(status["memoryBytes"], slotd.parse_size("800M"))
        self.assertEqual(status["memAvailable"], platform.available)
        self.assertEqual(status["heldSecondsP50"], 6.0)
        self.assertEqual(status["holders"], {"a": "req-a"})
        self.assertEqual(status["refused"], {})
        # Granted at once is a wait of zero, and a median of zero is a fact
        # worth reporting, not an absence of data.
        self.assertEqual(status["waitSecondsP50"], 0.0)
