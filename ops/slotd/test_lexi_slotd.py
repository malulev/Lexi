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
