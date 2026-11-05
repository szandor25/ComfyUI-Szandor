"""System tab (CPU + sensors) tests with ComfyUI stubbed out.

Run with the ComfyUI venv (needs psutil, aiohttp):
    python -m unittest discover -s tests -p "test_system_sensors.py"
"""
import importlib.util
from pathlib import Path
import struct
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch


def load_module():
    server = ModuleType("server")
    server.PromptServer = SimpleNamespace(instance=SimpleNamespace(routes=SimpleNamespace(get=lambda _: lambda h: h)))
    with patch.dict(sys.modules, {"server": server}):
        spec = importlib.util.spec_from_file_location(
            "system_sensors_under_test", Path(__file__).resolve().parents[1] / "nodes" / "system_sensors.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module


def text(value, size):
    return value.encode("utf-8").ljust(size, b"\0")


def hwinfo_blob(sensors, readings, signature=b"HWiS", v2=True):
    """HWiNFO_SENSORS_SHARED_MEM2 layout: header, sensor elements, reading elements (pack 1)."""
    s_size = 8 + 128 * (3 if v2 else 2)
    r_size = 316 + (144 if v2 else 0)
    s_off = 48
    r_off = s_off + s_size * len(sensors)
    blob = struct.pack("<4sIIqIIIIII", signature, 2, 1, 0, s_off, s_size, len(sensors), r_off, r_size, len(readings))
    blob = blob.ljust(s_off, b"\0")
    for name in sensors:
        element = struct.pack("<II", 0, 0) + text("orig " + name, 128) + text(name if not v2 else "", 128)
        if v2:
            element += text(name, 128)
        blob += element
    for type_id, sensor, label, unit, values in readings:
        element = struct.pack("<III", type_id, sensor, 0) + text("orig " + label, 128) + text(label, 128)
        element += text(unit if unit.isascii() else "", 16) + struct.pack("<dddd", *values)
        if v2:
            element += text(label, 128) + text(unit, 16)
        blob += element
    return blob


SENSORS = ["CPU [#0]: AMD Ryzen 9 9950X: Enhanced", "GIGABYTE X870E AORUS MASTER (ITE IT8696E)",
           "GPU [#0]: NVIDIA GeForce RTX 5090", "S.M.A.R.T.: Samsung SSD 990 PRO"]
READINGS = [
    (1, 0, "Core Temperatures", "°C", (60, 40, 80, 55)),
    (1, 0, "CPU (Tctl/Tdie)", "°C", (72.5, 41, 90, 60)),
    (5, 0, "CPU Package Power", "W", (142.6, 30, 200, 90)),
    (2, 0, "CPU Core Voltage (SVI3 TFN)", "V", (1.254, 0.9, 1.4, 1.1)),
    (3, 1, "CPU", "RPM", (1180, 600, 1900, 1000)),
    (3, 1, "System 3", "RPM", (0, 0, 0, 0)),
    (1, 1, "System", "°C", (34, 30, 36, 33)),
    (1, 2, "GPU Temperature", "°C", (65, 30, 70, 50)),
    (1, 3, "Drive Temperature", "°C", (41, 35, 50, 40)),
]


class HWiNFOTests(unittest.TestCase):
    def setUp(self):
        self.m = load_module()

    def test_parses_groups_kinds_values_and_units(self):
        groups = self.m.parse_hwinfo(hwinfo_blob(SENSORS, READINGS))
        self.assertEqual([(g["name"], g["kind"]) for g in groups], [
            ("CPU [#0]: AMD Ryzen 9 9950X: Enhanced", "cpu"), ("GIGABYTE X870E AORUS MASTER (ITE IT8696E)", "other"),
            ("GPU [#0]: NVIDIA GeForce RTX 5090", "gpu"), ("S.M.A.R.T.: Samsung SSD 990 PRO", "drive")])
        tctl = groups[0]["readings"][1]
        self.assertEqual(tctl, {"type": "temperature", "label": "CPU (Tctl/Tdie)", "value": 72.5, "unit": "°C",
                                "min": 41, "max": 90})
        self.assertEqual([r["type"] for r in groups[0]["readings"]], ["temperature", "temperature", "power", "voltage"])
        self.assertEqual([(r["label"], r["value"]) for r in groups[1]["readings"] if r["type"] == "fan"],
                         [("CPU", 1180), ("System 3", 0)])

    def test_version_1_layout_uses_ansi_names(self):
        groups = self.m.parse_hwinfo(hwinfo_blob(SENSORS[:1], READINGS[2:3], v2=False))
        self.assertEqual(groups[0]["name"], SENSORS[0])
        self.assertEqual(groups[0]["readings"][0]["label"], "CPU Package Power")
        self.assertEqual(groups[0]["readings"][0]["unit"], "W")

    def test_disabled_shared_memory_and_garbage(self):
        with self.assertRaises(self.m.HWiNFOOff):
            self.m.parse_hwinfo(hwinfo_blob(SENSORS, READINGS, signature=b"DAED"))
        self.assertIsNone(self.m.parse_hwinfo(hwinfo_blob(SENSORS, READINGS, signature=b"\0\0\0\0")))

    def test_headline_prefers_tctl_and_package_power(self):
        groups = self.m._sorted_groups(self.m.parse_hwinfo(hwinfo_blob(SENSORS, READINGS)))
        headline = self.m.cpu_headline(groups)
        self.assertEqual((headline["temp"], headline["temp_label"], headline["temp_max"]), (72.5, "CPU (Tctl/Tdie)", 90))
        self.assertEqual((headline["power"], headline["power_label"]), (142.6, "CPU Package Power"))
        self.assertEqual([g["kind"] for g in groups], ["cpu", "other", "gpu", "drive"])


LHM_TREE = {"Text": "Sensor", "Children": [{"Text": "DESKTOP", "ImageURL": "images_icon/computer.png", "Children": [
    {"Text": "AMD Ryzen 9 9950X", "ImageURL": "images_icon/cpu.png", "Children": [
        {"Text": "Temperatures", "Children": [
            {"Text": "Core (Tctl/Tdie)", "Value": "71,3 °C", "Min": "40,0 °C", "Max": "89,9 °C"},
            {"Text": "CCD1 (Tdie)", "Value": "65.0 °C", "Min": "", "Max": ""}]},
        {"Text": "Powers", "Children": [{"Text": "Package", "Value": "120.4 W", "Min": "20 W", "Max": "200 W"}]},
        {"Text": "Load", "Children": [{"Text": "CPU Total", "Value": "12.5 %"}]}]},
    {"Text": "Gigabyte X870E AORUS MASTER", "ImageURL": "images_icon/mainboard.png", "Children": [
        {"Text": "ITE IT8696E", "ImageURL": "images_icon/chip.png", "Children": [
            {"Text": "Fans", "Children": [{"Text": "Fan #1", "Value": "1180 RPM"}, {"Text": "Fan #2", "Value": "-"}]},
            {"Text": "Temperatures", "Children": [{"Text": "System", "Value": "34.0 °C"}]}]}]},
    {"Text": "NVIDIA GeForce RTX 5090", "ImageURL": "images_icon/nvidia.png", "Children": [
        {"Text": "Temperatures", "Children": [{"Text": "GPU Core", "Value": "60.0 °C"}]}]},
]}]}


class LibreHardwareMonitorTests(unittest.TestCase):
    def setUp(self):
        self.m = load_module()

    def test_web_tree_with_nested_superio_and_decimal_commas(self):
        groups = self.m.parse_lhm_json(LHM_TREE)
        self.assertEqual([(g["name"], g["kind"]) for g in groups],
                         [("AMD Ryzen 9 9950X", "cpu"), ("ITE IT8696E", "other"), ("NVIDIA GeForce RTX 5090", "gpu")])
        cpu = groups[0]["readings"]
        self.assertEqual(cpu[0], {"type": "temperature", "label": "Core (Tctl/Tdie)", "value": 71.3, "unit": "°C",
                                  "min": 40.0, "max": 89.9})
        self.assertEqual([r["type"] for r in cpu], ["temperature", "temperature", "power", "load"])
        self.assertEqual([(r["label"], r["value"]) for r in groups[1]["readings"]],
                         [("Fan #1", 1180), ("System", 34.0)])  # "-" (no reading) is skipped
        headline = self.m.cpu_headline(groups)
        self.assertEqual((headline["temp"], headline["power"]), (71.3, 120.4))

    def test_hardware_types(self):
        self.assertEqual([self.m.lhm_kind(t) for t in ("Cpu", "GpuNvidia", "GpuAmd", "Storage", "Memory", "SuperIO")],
                         ["cpu", "gpu", "gpu", "drive", "memory", "other"])


class HeadlineAndLinuxTests(unittest.TestCase):
    def setUp(self):
        self.m = load_module()

    def test_falls_back_to_hottest_cpu_sensor_then_board_cpu_sensor(self):
        r = self.m.reading
        groups = [{"name": "cpu", "kind": "cpu", "readings": [r("temperature", "CCD1", 60), r("temperature", "CCD2", 66)]}]
        self.assertEqual(self.m.cpu_headline(groups)["temp"], 66)
        board = [{"name": "board", "kind": "other", "readings": [r("temperature", "System", 30), r("temperature", "CPU", 55)]}]
        self.assertEqual(self.m.cpu_headline(board)["temp"], 55)
        self.assertIsNone(self.m.cpu_headline([])["temp"])

    def test_psutil_sensors(self):
        temps = {"k10temp": [SimpleNamespace(label="Tctl", current=70.0, high=None, critical=None)],
                 "nvme": [SimpleNamespace(label="Composite", current=40.0, high=80.0, critical=90.0)]}
        fans = {"nct6798": [SimpleNamespace(label="", current=900)]}
        with patch.object(self.m.psutil, "sensors_temperatures", lambda: temps, create=True), \
                patch.object(self.m.psutil, "sensors_fans", lambda: fans, create=True):
            groups = self.m._sorted_groups(self.m.read_psutil())
        self.assertEqual([(g["name"], g["kind"]) for g in groups], [("k10temp", "cpu"), ("nct6798", "other"), ("nvme", "drive")])
        self.assertEqual(groups[1]["readings"][0]["label"], "fan1")
        self.assertEqual(groups[2]["readings"][0]["max"], 80.0)
        self.assertEqual(self.m.cpu_headline(groups)["temp"], 70.0)


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.m = load_module()

    def test_first_working_source_is_kept_and_failures_wait_before_retrying(self):
        calls = []
        group = [{"name": "cpu", "kind": "cpu", "readings": [self.m.reading("temperature", "Tctl", 50)]}]
        results = {"a": None, "b": group}

        def source(name):
            def read():
                calls.append(name)
                if isinstance(results[name], Exception):
                    raise results[name]
                return results[name]
            return read

        sensors = self.m.Sensors()
        sensors.sources = lambda: [("a", source("a")), ("b", source("b"))]
        self.assertEqual(sensors.read()[0], "b")
        calls.clear()
        self.assertEqual(sensors.read()[0], "b")
        self.assertEqual(calls, ["b"], "a working source is read directly")
        results["b"] = OSError("gone")
        self.assertEqual(sensors.read()[:2], (None, []))
        calls.clear()
        self.assertEqual(sensors.read()[:2], (None, []))
        self.assertEqual(calls, [], "no new attempts until RETRY_SECONDS pass")

    def test_hwinfo_off_gives_its_own_hint(self):
        sensors = self.m.Sensors()

        def off():
            raise self.m.HWiNFOOff()
        sensors.sources = lambda: [("HWiNFO", off)]
        source, groups, hint = sensors.read()
        self.assertIsNone(source)
        self.assertIn("Shared Memory Support", hint)
        self.assertIn("12 hours", hint)

    def test_stats_filter_types_and_cache(self):
        groups = self.m.parse_hwinfo(hwinfo_blob(SENSORS, READINGS))
        self.m._state["sensors"].read = lambda: ("HWiNFO", self.m._sorted_groups(groups), None)
        basic = self.m.system_stats("basic")
        types = {r["type"] for g in basic["sensors"]["groups"] for r in g["readings"]}
        self.assertEqual(types, {"temperature", "fan"})
        full = self.m.system_stats("all")
        self.assertIn("voltage", {r["type"] for g in full["sensors"]["groups"] for r in g["readings"]})
        self.assertIs(self.m.system_stats("basic"), basic, "repeated requests within CACHE_SECONDS reuse the result")
        cpu = basic["cpu"]
        self.assertEqual(len(cpu["loads"]), cpu["threads"])
        self.assertEqual(cpu["temp"], 72.5)
        if self.m.IS_WINDOWS:
            self.assertEqual(len(cpu["clocks"]), cpu["threads"])
            self.assertGreater(cpu["base_clock"], 0)


if __name__ == "__main__":
    unittest.main()
