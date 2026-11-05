"""Zakładka System w Memory Monitor: obciążenie i rzeczywiste zegary CPU, temperatury, wentylatory, moc.

Na Windows psutil podaje tylko zegar bazowy, więc rzeczywisty zegar każdego wątku liczymy z liczników
wydajności (jak Menedżer zadań). Temperatur i wentylatorów Windows nie udostępnia bez sterownika —
czytamy je z działającego HWiNFO (Shared Memory Support) albo LibreHardwareMonitor (WMI lub Remote Web
Server). Na Linuksie wszystko daje psutil (hwmon / lm-sensors).
"""
import asyncio
import ctypes
import json
import logging
import os
import platform
import re
import struct
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import psutil
from aiohttp import web
from server import PromptServer

IS_WINDOWS = sys.platform == "win32"
ANSI = "mbcs" if IS_WINDOWS else "latin-1"
LHM_URL = os.environ.get("SZANDOR_LHM_URL", "http://localhost:8085/data.json")
LHM_NAMESPACES = ("root\\LibreHardwareMonitor", "root\\OpenHardwareMonitor")
HWINFO_MAP = "Global\\HWiNFO_SENS_SM2"
FILE_MAP_READ = 0x4
BASIC_TYPES = ("temperature", "fan")
RETRY_SECONDS = 10
CACHE_SECONDS = 0.4
UNITS = {"temperature": "°C", "fan": "RPM", "voltage": "V", "power": "W", "clock": "MHz",
         "load": "%", "control": "%", "current": "A", "other": ""}
KIND_ORDER = ("cpu", "other", "gpu", "memory", "drive")
NO_SENSORS_HINT = ("Windows does not expose temperatures and fans. Run HWiNFO (Settings → Shared Memory Support) "
                   "or LibreHardwareMonitor (as administrator) and they appear here.")

_PROCESS = psutil.Process()


def _try(fn, *args, default=None):
    try:
        return fn(*args)
    except Exception:
        return default


def reading(type_, label, value, unit=None, low=None, high=None):
    return {"type": type_, "label": label, "value": value, "unit": UNITS.get(type_, "") if unit is None else unit,
            "min": low, "max": high}


def hardware_kind(name):
    """Rodzaj urządzenia z nazwy czujnika: cpu / gpu / memory / drive / other (płyta główna i reszta)."""
    text = name.lower()
    for kind, pattern in (("cpu", r"^cpu\b|\bk10temp\b|\bcoretemp\b|\bzenpower\b"),
                          ("gpu", r"^gpu\b|\bnvidia\b|\bgeforce\b|\bradeon\b|\bamdgpu\b|\bnouveau\b"),
                          ("drive", r"s\.m\.a\.r\.t|^drive\b|\bnvme\b|\bssd\b|\bhdd\b"),
                          ("memory", r"\bdimm\b|^memory\b|\bspd")):
        if re.search(pattern, text):
            return kind
    return "other"


def _sorted_groups(groups):
    groups = [g for g in groups if g["readings"]]
    return sorted(groups, key=lambda g: KIND_ORDER.index(g["kind"]) if g["kind"] in KIND_ORDER else len(KIND_ORDER))


# ─── CPU ──────────────────────────────────────────────────────────────────────

def cpu_name():
    if IS_WINDOWS:
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0") as key:
                return winreg.QueryValueEx(key, "ProcessorNameString")[0].strip()
        except OSError:
            pass
    else:
        try:
            with open("/proc/cpuinfo", encoding="utf-8", errors="replace") as f:
                for line in f:
                    if line.startswith("model name"):
                        return line.split(":", 1)[1].strip()
        except OSError:
            pass
    return platform.processor() or "CPU"


class _PdhValue(ctypes.Structure):
    _fields_ = [("status", ctypes.c_ulong), ("value", ctypes.c_double)]


class _PdhItem(ctypes.Structure):
    _fields_ = [("name", ctypes.c_wchar_p), ("value", _PdhValue)]


class WindowsClocks:
    """Rzeczywisty zegar każdego wątku: zegar bazowy × „% Processor Performance” (liczniki PDH, bez pywin32)."""
    FORMAT = 0x200 | 0x8000  # PDH_FMT_DOUBLE | PDH_FMT_NOCAP100

    def __init__(self):
        self.pdh = ctypes.WinDLL("pdh")
        self.query = ctypes.c_void_p()
        self.perf = ctypes.c_void_p()
        self.base = ctypes.c_void_p()
        for status in (self.pdh.PdhOpenQueryW(None, None, ctypes.byref(self.query)),
                       self.pdh.PdhAddEnglishCounterW(self.query, r"\Processor Information(*)\% Processor Performance",
                                                      None, ctypes.byref(self.perf)),
                       self.pdh.PdhAddEnglishCounterW(self.query, r"\Processor Information(_Total)\Processor Frequency",
                                                      None, ctypes.byref(self.base))):
            if status:
                raise OSError(f"PDH error 0x{status & 0xFFFFFFFF:08X}")
        # Licznik procentowy potrzebuje dwóch odczytów — pierwszy robimy od razu.
        self.pdh.PdhCollectQueryData(self.query)

    def _values(self, counter):
        size, count = ctypes.c_ulong(0), ctypes.c_ulong(0)
        self.pdh.PdhGetFormattedCounterArrayW(counter, self.FORMAT, ctypes.byref(size), ctypes.byref(count), None)
        if not size.value:
            return {}
        buffer = ctypes.create_string_buffer(size.value)
        if self.pdh.PdhGetFormattedCounterArrayW(counter, self.FORMAT, ctypes.byref(size), ctypes.byref(count), buffer):
            return {}
        items = ctypes.cast(buffer, ctypes.POINTER(_PdhItem))
        return {items[i].name: items[i].value.value for i in range(count.value) if items[i].value.status <= 1}

    def read(self):
        """(zegar bazowy, [zegar każdego wątku w kolejności numerów procesorów]) w MHz."""
        self.pdh.PdhCollectQueryData(self.query)
        base = self._values(self.base).get("_Total")
        threads = []
        for name, value in self._values(self.perf).items():
            group, _, index = name.partition(",")
            if group.isdigit() and index.isdigit():  # pomijamy "_Total" i "0,_Total"
                threads.append(((int(group), int(index)), value))
        if not base:
            return None, []
        return base, [base * value / 100 for _, value in sorted(threads)]


def _busy_time(times):
    return sum(times) - times.idle - getattr(times, "iowait", 0)


class CpuReader:
    """Obciążenie liczone z różnic cpu_times (nie z psutil.cpu_percent, którego stan dzielą inne węzły)."""

    def __init__(self):
        self.name = cpu_name()
        self.cores = psutil.cpu_count(logical=False)
        self.threads = psutil.cpu_count()
        self.last = psutil.cpu_times(percpu=True)
        _PROCESS.cpu_percent(None)
        self.clocks = None
        if IS_WINDOWS:
            try:
                self.clocks = WindowsClocks()
            except Exception as exc:
                logging.info("[Szandor System] CPU clocks unavailable: %s", exc)

    def loads(self):
        now = psutil.cpu_times(percpu=True)
        loads = []
        for before, after in zip(self.last, now):
            total = sum(after) - sum(before)
            busy = _busy_time(after) - _busy_time(before)
            loads.append(min(100.0, max(0.0, busy / total * 100)) if total > 0 else 0.0)
        self.last = now
        return loads

    def read(self):
        loads = self.loads()
        if self.clocks is not None:
            base, clocks = _try(self.clocks.read, default=(None, []))
            boost = None
        else:
            freqs = _try(psutil.cpu_freq, True) or []
            clocks = [f.current for f in freqs if f.current]
            total = _try(psutil.cpu_freq)
            base, boost = None, (total.max or None) if total else None
        return {
            "name": self.name, "cores": self.cores, "threads": self.threads,
            "load": sum(loads) / len(loads) if loads else None,
            "loads": [round(v, 1) for v in loads],
            "clocks": [round(v) for v in clocks],
            "clock": sum(clocks) / len(clocks) if clocks else None,
            "base_clock": base, "max_clock": boost,
            "process": _try(_PROCESS.cpu_percent, None, default=0) / max(1, self.threads or 1),
        }


# ─── HWiNFO (pamięć współdzielona) ────────────────────────────────────────────

HWINFO_HEADER = struct.Struct("<4sIIqIIIIII")
HWINFO_TYPES = {1: "temperature", 2: "voltage", 3: "fan", 4: "current", 5: "power", 6: "clock", 7: "load", 8: "other"}


class HWiNFOOff(Exception):
    """Pamięć współdzielona istnieje, ale HWiNFO ją wyłączył (wersja darmowa: co 12 godzin)."""


def _cstr(blob, encoding):
    return blob.split(b"\0", 1)[0].decode(encoding, "replace").strip()


def _field(element, utf_at, ansi_at, size):
    """Tekst w UTF-8 (wersja 2 struktury), a jeśli go brak — w stronie kodowej systemu."""
    if len(element) >= utf_at + size:
        text = _cstr(element[utf_at:utf_at + size], "utf-8")
        if text:
            return text
    return _cstr(element[ansi_at:ansi_at + size], ANSI)


def parse_hwinfo(data):
    """Grupy czujników z bloku HWiNFO_SENSORS_SHARED_MEM2 (układ z hwisenssm2.h, pack 1)."""
    sig, _version, _revision, _poll, s_off, s_size, s_num, r_off, r_size, r_num = HWINFO_HEADER.unpack_from(data)
    if sig in (b"DEAD", b"DAED"):  # 'DEAD' jako DWORD — kolejność bajtów zależna od zapisu
        raise HWiNFOOff()
    if sig != b"HWiS":
        return None
    groups = []
    for i in range(s_num):
        element = data[s_off + i * s_size:s_off + (i + 1) * s_size]
        name = _field(element, 264, 136, 128) or _cstr(element[8:136], ANSI)
        groups.append({"name": name, "kind": hardware_kind(name), "readings": []})
    for i in range(r_num):
        element = data[r_off + i * r_size:r_off + (i + 1) * r_size]
        type_id, sensor = struct.unpack_from("<II", element)
        type_ = HWINFO_TYPES.get(type_id)
        if type_ is None or sensor >= len(groups):
            continue
        label = _field(element, 316, 140, 128) or _cstr(element[12:140], ANSI)
        unit = _field(element, 444, 268, 16)
        value, low, high, _avg = struct.unpack_from("<dddd", element, 284)
        groups[sensor]["readings"].append(reading(type_, label, value, unit, low, high))
    return groups


_kernel32 = None


def read_hwinfo():
    global _kernel32
    if not IS_WINDOWS:
        return None
    if _kernel32 is None:
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)  # osobna instancja: własne argtypes
        k32.OpenFileMappingW.restype = ctypes.c_void_p
        k32.OpenFileMappingW.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_wchar_p]
        k32.MapViewOfFile.restype = ctypes.c_void_p
        k32.MapViewOfFile.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_size_t]
        k32.UnmapViewOfFile.argtypes = [ctypes.c_void_p]
        k32.CloseHandle.argtypes = [ctypes.c_void_p]
        _kernel32 = k32
    handle = _kernel32.OpenFileMappingW(FILE_MAP_READ, 0, HWINFO_MAP)
    if not handle:
        return None
    try:
        view = _kernel32.MapViewOfFile(handle, FILE_MAP_READ, 0, 0, 0)
        if not view:
            return None
        try:
            header = HWINFO_HEADER.unpack(ctypes.string_at(view, HWINFO_HEADER.size))
            size = max(header[4] + header[5] * header[6], header[7] + header[8] * header[9], HWINFO_HEADER.size)
            if size > 64 * 1024 ** 2:
                return None
            return parse_hwinfo(ctypes.string_at(view, size))
        finally:
            _kernel32.UnmapViewOfFile(view)
    finally:
        _kernel32.CloseHandle(handle)


# ─── LibreHardwareMonitor / OpenHardwareMonitor ───────────────────────────────

LHM_SENSOR_TYPES = {"temperature": "temperature", "fan": "fan", "voltage": "voltage", "power": "power",
                    "clock": "clock", "load": "load", "control": "control", "current": "current"}
LHM_GROUPS = {"temperatures": "temperature", "fans": "fan", "voltages": "voltage", "powers": "power",
              "clocks": "clock", "load": "load", "controls": "control", "currents": "current"}
LHM_ICONS = (("cpu", "cpu"), ("nvidia", "gpu"), ("ati", "gpu"), ("amd", "gpu"), ("intel", "gpu"),
             ("hdd", "drive"), ("ram", "memory"))


def lhm_kind(hardware_type):
    text = str(hardware_type).lower()
    if text.startswith("cpu"):
        return "cpu"
    if text.startswith("gpu"):
        return "gpu"
    if text in ("storage", "hdd"):
        return "drive"
    if text in ("memory", "ram"):
        return "memory"
    return "other"


_lhm_wmi = None


def read_lhm_wmi():
    """WMI publikowane przez działający LibreHardwareMonitor (wymaga pywin32)."""
    global _lhm_wmi
    if not IS_WINDOWS:
        return None
    import pythoncom
    import win32com.client
    pythoncom.CoInitialize()  # zawsze ten sam wątek (_EXECUTOR), więc obiekt COM można trzymać
    if _lhm_wmi is None:
        for namespace in LHM_NAMESPACES:
            try:
                _lhm_wmi = win32com.client.GetObject(f"winmgmts:\\\\.\\{namespace}")
                break
            except Exception:
                continue
        else:
            return None
    try:
        hardware = {h.Identifier: h for h in _lhm_wmi.ExecQuery("SELECT Identifier, Name, HardwareType FROM Hardware")}
        sensors = list(_lhm_wmi.ExecQuery("SELECT Name, SensorType, Value, Min, Max, Parent FROM Sensor"))
    except Exception:
        _lhm_wmi = None
        raise
    groups = {}
    for ident, h in hardware.items():
        groups[ident] = {"name": h.Name, "kind": lhm_kind(h.HardwareType), "readings": []}
    for s in sensors:
        type_ = LHM_SENSOR_TYPES.get(str(s.SensorType).lower())
        group = groups.get(s.Parent)
        if type_ is None or group is None or s.Value is None:
            continue
        group["readings"].append(reading(type_, s.Name, float(s.Value), None,
                                         _try(float, s.Min), _try(float, s.Max)))
    return list(groups.values())


def _number(text):
    match = re.search(r"-?\d+(?:[.,]\d+)?", str(text or ""))
    return float(match.group().replace(",", ".")) if match else None


def parse_lhm_json(tree):
    """Drzewo z /data.json serwera WWW LibreHardwareMonitor / OpenHardwareMonitor."""
    groups = []

    def walk(node):
        children = node.get("Children") or []
        if any(str(c.get("Text", "")).lower() in LHM_GROUPS for c in children):
            image = str(node.get("ImageURL", "")).lower()
            kind = next((k for word, k in LHM_ICONS if word in image.rsplit("/", 1)[-1]), "other")
            group = {"name": node.get("Text", ""), "kind": kind, "readings": []}
            groups.append(group)
            for child in children:
                type_ = LHM_GROUPS.get(str(child.get("Text", "")).lower())
                if type_ is None:
                    walk(child)  # podrzędny sprzęt, np. SuperIO pod płytą główną
                    continue
                for sensor in child.get("Children") or []:
                    value = _number(sensor.get("Value"))
                    if value is not None:
                        group["readings"].append(reading(type_, sensor.get("Text", ""), value, None,
                                                         _number(sensor.get("Min")), _number(sensor.get("Max"))))
        else:
            for child in children:
                walk(child)

    walk(tree)
    return groups


def read_lhm_http():
    with urllib.request.urlopen(LHM_URL, timeout=0.5) as response:
        return parse_lhm_json(json.loads(response.read().decode("utf-8", "replace")))


# ─── Linux (psutil) ───────────────────────────────────────────────────────────

def read_psutil():
    temps = _try(getattr(psutil, "sensors_temperatures", None)) or {}
    fans = _try(getattr(psutil, "sensors_fans", None)) or {}
    groups = {}

    def group(chip):
        return groups.setdefault(chip, {"name": chip, "kind": hardware_kind(chip), "readings": []})

    for chip, entries in temps.items():
        for i, t in enumerate(entries):
            group(chip)["readings"].append(reading("temperature", t.label or f"temp{i + 1}", t.current,
                                                   high=t.high or None))
    for chip, entries in fans.items():
        for i, f in enumerate(entries):
            group(chip)["readings"].append(reading("fan", f.label or f"fan{i + 1}", f.current))
    return list(groups.values())


# ─── źródło czujników ─────────────────────────────────────────────────────────

class Sensors:
    """Pierwsze źródło z danymi wygrywa; po porażce kolejne próby co RETRY_SECONDS."""

    def __init__(self):
        self.source = None
        self.retry_at = 0
        self.hint = None

    def sources(self):
        if IS_WINDOWS:
            return [("HWiNFO", read_hwinfo), ("LibreHardwareMonitor", read_lhm_wmi),
                    ("LibreHardwareMonitor (web)", read_lhm_http)]
        return [("lm-sensors", read_psutil)]

    def read(self):
        sources = dict(self.sources())
        if self.source in sources:
            groups = self._attempt(sources[self.source])
            if groups:
                return self.source, groups, None
            self.source = None
        if time.monotonic() < self.retry_at:
            return None, [], self.hint
        self.hint = NO_SENSORS_HINT if IS_WINDOWS else "No sensors found (install lm-sensors / load hwmon drivers)."
        for name, fn in sources.items():
            groups = self._attempt(fn)
            if groups:
                self.source = name
                return name, groups, None
        self.retry_at = time.monotonic() + RETRY_SECONDS
        return None, [], self.hint

    def _attempt(self, fn):
        try:
            return _sorted_groups(fn() or [])
        except HWiNFOOff:
            self.hint = ("HWiNFO is running, but its shared memory is off — enable Shared Memory Support "
                         "in HWiNFO settings (the free version turns it off every 12 hours).")
        except ImportError:
            pass
        except Exception as exc:
            logging.debug("[Szandor System] sensor source failed: %s", exc)
        return []


def _first(readings, patterns):
    for pattern in patterns:
        for r in readings:
            if re.search(pattern, r["label"], re.IGNORECASE):
                return r
    return None


def cpu_headline(groups):
    """Temperatura i moc procesora do kafelków: Tctl/Tdie (AMD), Package (Intel), inaczej najgorętszy czujnik CPU."""
    cpu = [r for g in groups if g["kind"] == "cpu" for r in g["readings"]]
    temps = [r for r in cpu if r["type"] == "temperature"]
    temp = _first(temps, (r"tctl/tdie", r"\btdie\b", r"\btctl\b", r"package", r"core max")) or \
        max(temps, key=lambda r: r["value"], default=None)
    if temp is None:  # czujnik "CPU" na płycie głównej
        board = [r for g in groups if g["kind"] == "other" for r in g["readings"] if r["type"] == "temperature"]
        temp = _first(board, (r"^cpu\b",))
    powers = [r for r in cpu if r["type"] == "power"]
    power = _first(powers, (r"package", r"\bppt\b", r"^cpu\b")) or (powers[0] if powers else None)
    return {
        "temp": temp["value"] if temp else None, "temp_label": temp["label"] if temp else None,
        "temp_max": temp["max"] if temp else None,
        "power": power["value"] if power else None, "power_label": power["label"] if power else None,
    }


# ─── API ──────────────────────────────────────────────────────────────────────

# Jeden wątek: liczniki PDH i obiekt COM (WMI) są przypisane do wątku, a odczyty nie nakładają się.
_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="szandor-sensors")
_state = {"cpu": None, "sensors": Sensors(), "cache": {}}


def system_stats(detail="basic"):
    cached = _state["cache"].get(detail)
    if cached and time.monotonic() - cached[0] < CACHE_SECONDS:  # kilka paneli naraz
        return cached[1]
    if _state["cpu"] is None:
        _state["cpu"] = CpuReader()
    cpu = _state["cpu"].read()
    source, groups, hint = _state["sensors"].read()
    cpu.update(cpu_headline(groups))
    types = None if detail == "all" else BASIC_TYPES
    shown = [{**g, "readings": [r for r in g["readings"] if types is None or r["type"] in types]} for g in groups]
    data = {"time": time.time(), "cpu": cpu,
            "sensors": {"source": source, "hint": hint, "groups": [g for g in shown if g["readings"]]}}
    _state["cache"][detail] = (time.monotonic(), data)
    return data


@PromptServer.instance.routes.get("/szandor/memory/system")
async def szandor_memory_system(request):
    detail = "all" if request.query.get("detail") == "all" else "basic"
    try:
        data = await asyncio.get_running_loop().run_in_executor(_EXECUTOR, system_stats, detail)
    except Exception as exc:
        logging.exception("[Szandor System] stats")
        return web.json_response({"error": f"{type(exc).__name__}: {exc}"}, status=500)
    return web.json_response(data)
