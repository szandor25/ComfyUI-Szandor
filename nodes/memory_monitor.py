"""Memory Monitor + Memory Cleanup: podgląd VRAM / RAM i załadowanych modeli na żywo,
pomiar pamięci każdego węzła podczas wykonywania oraz zwalnianie wybranych modeli.

Pomiar węzłów opiera się na komunikatach, które ComfyUI i tak wysyła do przeglądarki
(``execution_start`` → ``executing`` dla każdego węzła → ``execution_success`` / błąd), więc
nie wymaga zmian w ComfyUI. Dokładne są liczniki PyTorcha (allocated / reserved / peak);
zajętość całej karty pochodzi ze sterownika (``torch.cuda.mem_get_info``), także na Windows,
gdzie NVML zwykle nie podaje pamięci pojedynczego procesu.
"""
import asyncio
import gc
import logging
import threading
import time
from collections import deque

import psutil
import torch
from aiohttp import web
from server import PromptServer

try:
    import comfy.model_management as mm
except Exception:  # testy bez ComfyUI
    mm = None

try:
    import comfy.model_base as model_base
except Exception:
    model_base = None

try:
    from comfy.cli_args import args as cli_args
except Exception:
    cli_args = None

HISTORY_RUNS = 5
SAMPLE_INTERVAL = 0.25
MAX_SAMPLES = 4000
REFRESH_CHOICES = ["0.5 s", "1 s", "2 s", "5 s"]
WATCHED_EVENTS = {"execution_start", "execution_cached", "executing",
                  "execution_success", "execution_error", "execution_interrupted"}
KIND_LABELS = {
    "diffusion": "diffusion model",
    "text_encoder": "text encoder",
    "vae": "VAE",
    "controlnet": "ControlNet",
    "other": "other",
}
POLICY_FLAGS = ("gpu_only", "highvram", "normalvram", "lowvram", "novram", "cpu",
                "disable_smart_memory", "reserve_vram", "cache_none", "cache_lru", "cache_ram")

_PROCESS = psutil.Process()


class AnyType(str):
    """Typ "*" zgodny z każdym połączeniem (wejście / wyjście przelotowe)."""

    def __ne__(self, other):
        return False


ANY = AnyType("*")


def _try(fn, *args, default=None):
    try:
        return fn(*args)
    except Exception:
        return default


# ─── odczyty pamięci ─────────────────────────────────────────────────────────

def gpu_device():
    """Bieżące urządzenie ComfyUI, jeśli to GPU CUDA / ROCm; inaczej None (pokazujemy tylko RAM)."""
    if not torch.cuda.is_available():
        return None
    device = _try(mm.get_torch_device) if mm is not None else torch.device("cuda")
    return device if getattr(device, "type", None) == "cuda" else None


def snapshot(device):
    """Szybki odczyt do pomiarów węzłów i wykresu (bez synchronizacji GPU)."""
    snap = {"t": time.time(), "rss": _try(lambda: _PROCESS.memory_info().rss, default=0)}
    if device is not None:
        free, total = torch.cuda.mem_get_info(device)
        snap.update(device=total - free, allocated=torch.cuda.memory_allocated(device),
                    reserved=torch.cuda.memory_reserved(device))
    return snap


def gpu_stats(device):
    if device is None:
        return None
    free, total = torch.cuda.mem_get_info(device)
    return {
        "name": _try(torch.cuda.get_device_name, device, default="GPU"),
        "total": total,
        "used": total - free,
        "free": free,
        "allocated": torch.cuda.memory_allocated(device),
        "reserved": torch.cuda.memory_reserved(device),
        "peak_allocated": torch.cuda.max_memory_allocated(device),
        "peak_reserved": torch.cuda.max_memory_reserved(device),
        # Wymagają pynvml / amdsmi; bez nich po prostu ich nie pokazujemy.
        "utilization": _try(torch.cuda.utilization, device),
        "temperature": _try(getattr(torch.cuda, "temperature", None), device),
    }


def ram_stats():
    vm = psutil.virtual_memory()
    swap = _try(psutil.swap_memory)
    return {
        "total": vm.total,
        "used": vm.total - vm.available,
        "available": vm.available,
        "process": _try(lambda: _PROCESS.memory_info().rss, default=0),
        "swap_used": swap.used if swap else None,
        "swap_total": swap.total if swap else None,
        "pinned": getattr(mm, "TOTAL_PINNED_MEMORY", None) if mm is not None else None,
    }


def memory_policy():
    if mm is None:
        return {"vram_state": "?", "flags": []}
    flags = []
    for name in POLICY_FLAGS:
        value = getattr(cli_args, name, None) if cli_args is not None else None
        if value is True:
            flags.append(f"--{name.replace('_', '-')}")
        elif value and not isinstance(value, bool):  # puste listy / 0 = ustawienie domyślne
            flags.append(f"--{name.replace('_', '-')} {value}")
    return {
        "vram_state": getattr(getattr(mm, "vram_state", None), "name", "?"),
        "extra_reserved": _try(mm.extra_reserved_memory),
        "smart_memory": not getattr(mm, "DISABLE_SMART_MEMORY", False),
        "flags": flags,
    }


# ─── modele ──────────────────────────────────────────────────────────────────

def classify(patcher):
    inner = getattr(patcher, "model", None)
    if model_base is not None and isinstance(inner, model_base.BaseModel):
        return "diffusion"
    cls = type(inner)
    path = f"{cls.__module__}.{cls.__name__}".lower()
    if "controlnet" in path or "cldm" in path or "t2i_adapter" in path:
        return "controlnet"
    if "vae" in path or "autoencoder" in path:
        return "vae"
    if "vision" in path:
        return "other"
    if "text_encoder" in path or "clip" in path or "t5" in path:
        return "text_encoder"
    return "other"


def model_name(patcher, kind):
    inner = getattr(patcher, "model", None)
    config = getattr(inner, "model_config", None)
    if kind == "diffusion" and config is not None:
        return type(config).__name__
    return type(inner).__name__


def model_dtype(patcher):
    dtype = _try(patcher.model_dtype)
    if dtype is None:
        dtype = _try(lambda: next(patcher.model.parameters()).dtype)
    return str(dtype).replace("torch.", "") if dtype is not None else ""


def _loaded_models():
    if mm is None:
        return []
    return [lm for lm in list(mm.current_loaded_models) if lm.model is not None]


def list_models():
    models = []
    for lm in _loaded_models():
        patcher = lm.model
        try:
            kind = classify(patcher)
            models.append({
                "id": str(id(patcher)),
                "name": model_name(patcher, kind),
                "kind": kind,
                "kind_label": KIND_LABELS[kind],
                "device": str(_try(patcher.current_loaded_device, default=lm.device)),
                "load_device": str(lm.device),
                "dtype": model_dtype(patcher),
                "size": _try(patcher.model_size, default=0),
                "loaded": _try(patcher.loaded_size, default=0),
                "patches": len(getattr(patcher, "patches", None) or {}),
                "dynamic": bool(_try(patcher.is_dynamic, default=False)),
            })
        except Exception as exc:  # model w trakcie ładowania / nietypowy patcher
            logging.debug("[Szandor Memory] skipped a model: %s", exc)
    return models


def unload_models(predicate):
    """Wyładowuje z VRAM modele spełniające warunek (pozostają w RAM, dopóki trzyma je cache ComfyUI).
    Klony tego samego modelu (np. z LoRA) wyładowywane są razem. Zwraca nazwy wyładowanych modeli."""
    loaded = _loaded_models()
    chosen = [lm for lm in loaded if predicate(lm.model)]
    inner = {id(lm.model.model) for lm in chosen}
    targets = [lm for lm in loaded if id(lm.model.model) in inner]
    if not targets:
        return []
    keep = [lm for lm in loaded if not any(lm is t for t in targets)]
    names = [model_name(lm.model, classify(lm.model)) for lm in targets]
    devices = {str(lm.device): lm.device for lm in targets}
    for device in devices.values():
        mm.free_memory(1e30, device, keep)
    mm.soft_empty_cache()
    return names


# ─── rejestrator wykonania ───────────────────────────────────────────────────

def _summary(snap):
    return {k: snap.get(k) for k in ("device", "allocated", "reserved", "rss")}


class Recorder:
    """Zapisuje pamięć każdego węzła na podstawie komunikatów wykonania oraz próbki do wykresu."""

    def __init__(self):
        self.lock = threading.RLock()
        # Akcje z panelu (wyładowanie, czyszczenie) i start zadania nie mogą się przeplatać.
        self.action_lock = threading.Lock()
        self.runs = deque(maxlen=HISTORY_RUNS)
        self.current = None
        self.segment = None
        self.serial = 0
        self.busy = False
        self.global_peak = 0
        self.device = None
        self._stop = threading.Event()

    # wywoływane z wątku wykonującego zadania
    def on_message(self, event, data):
        if event == "execution_start":
            with self.action_lock:
                self.busy = True
            self.start_run(data.get("prompt_id"))
        elif event == "execution_cached":
            with self.lock:
                if self.current is not None:
                    self.current["cached"] = [str(n) for n in data.get("nodes") or []]
        elif event == "executing":
            node = data.get("node")
            if node is None:
                self.finish_run("success")
            else:
                self.start_segment(str(node), data.get("display_node"))
        elif event == "execution_success":
            self.finish_run("success")
        elif event == "execution_error":
            self.finish_run("error")
        elif event == "execution_interrupted":
            self.finish_run("interrupted")

    def start_run(self, prompt_id):
        self.finish_run("unknown")
        self.device = gpu_device()
        start = snapshot(self.device)
        with self.lock:
            self.current = {
                "prompt_id": prompt_id, "started": start["t"], "finished": None, "status": "running",
                "total": torch.cuda.mem_get_info(self.device)[1] if self.device is not None else None,
                "ram_total": psutil.virtual_memory().total,
                "nodes": [], "cached": [], "samples": [], "start": _summary(start),
                "titles": self._titles(prompt_id), "interval": SAMPLE_INTERVAL,
            }
        # Każde zadanie ma własny sygnał stopu, żeby próbkowanie poprzedniego nie trafiło do nowego.
        self._stop = threading.Event()
        threading.Thread(target=self._sample_loop, args=(self._stop,), name="szandor-memory-sampler",
                         daemon=True).start()

    def _titles(self, prompt_id):
        """class_type i tytuł węzłów z zadania w kolejce (bez nich tabela pokazuje same identyfikatory)."""
        queue = getattr(PromptServer.instance, "prompt_queue", None)
        try:
            with queue.mutex:
                items = list(queue.currently_running.values())
            prompt = next(item[2] for item in items if item[1] == prompt_id)
            return {str(nid): {"class_type": node.get("class_type", ""),
                               "title": (node.get("_meta") or {}).get("title", "")}
                    for nid, node in prompt.items()}
        except Exception:
            return {}

    def _close_segment(self, end):
        segment, self.segment = self.segment, None
        if segment is None:
            return
        segment["end"] = _summary(end)
        segment["t1"] = end["t"]
        if self.device is not None:
            segment["peak_allocated"] = max(torch.cuda.max_memory_allocated(self.device), end["allocated"])
            segment["peak_reserved"] = max(torch.cuda.max_memory_reserved(self.device), end["reserved"])
            segment["peak_device"] = max(segment["peak_device"] or 0, end["device"])
            self.global_peak = max(self.global_peak, segment["peak_allocated"])
        segment["peak_rss"] = max(segment["peak_rss"], end["rss"])

    def start_segment(self, node, display_node):
        if self.current is None:
            return
        snap = snapshot(self.device)
        with self.lock:
            self._close_segment(snap)
            if self.device is not None:
                torch.cuda.reset_peak_memory_stats(self.device)
            info = self.current["titles"].get(node) or self.current["titles"].get(str(display_node)) or {}
            self.segment = {
                "node": node, "display_node": str(display_node) if display_node is not None else node,
                "class_type": info.get("class_type", ""), "title": info.get("title", ""),
                "t0": snap["t"], "t1": None, "start": _summary(snap), "end": None,
                "peak_allocated": snap.get("allocated"), "peak_reserved": snap.get("reserved"),
                "peak_device": snap.get("device"), "peak_rss": snap["rss"],
            }
            self.current["nodes"].append(self.segment)

    def finish_run(self, status):
        with self.lock:
            run = self.current
            if run is None:
                return
            self._stop.set()
            end = snapshot(self.device)
            self._close_segment(end)
            run["finished"] = end["t"]
            run["status"] = status
            run["end"] = _summary(end)
            self.current = None
            self.runs.appendleft(run)
            self.serial += 1
        self.busy = False

    def _sample_loop(self, stop):
        interval = SAMPLE_INTERVAL
        while not stop.wait(interval):
            try:
                snap = snapshot(self.device)
            except Exception:
                continue
            with self.lock:
                run = self.current
                if run is None or stop.is_set():
                    return
                samples = run["samples"]
                samples.append([round(snap["t"] - run["started"], 3), snap.get("device"),
                                snap.get("allocated"), snap.get("reserved"), snap["rss"]])
                if len(samples) > MAX_SAMPLES:
                    # Długie zadanie: co druga próbka i dwa razy rzadsze odczyty.
                    del samples[1::2]
                    interval *= 2
                    run["interval"] = interval
                segment = self.segment
                if segment is not None:
                    if snap.get("device") is not None:
                        segment["peak_device"] = max(segment["peak_device"] or 0, snap["device"])
                    segment["peak_rss"] = max(segment["peak_rss"], snap["rss"])

    # dla panelu
    def live(self):
        with self.lock:
            segment = self.segment
            current = None
            if segment is not None:
                current = {k: segment[k] for k in ("node", "display_node", "class_type", "title", "t0", "start")}
                current["elapsed"] = time.time() - segment["t0"]
                if self.device is not None:
                    current["peak_allocated"] = torch.cuda.max_memory_allocated(self.device)
            return {"busy": self.busy, "serial": self.serial, "current": current}

    def history(self):
        with self.lock:
            runs = list(self.runs)
            if self.current is not None:
                runs.insert(0, {**self.current, "nodes": list(self.current["nodes"]),
                                "samples": list(self.current["samples"])})
            return [{k: v for k, v in run.items() if k != "titles"} for run in runs]

    def reset_peak(self, device):
        self.global_peak = 0
        if device is not None and not self.busy:
            torch.cuda.reset_peak_memory_stats(device)


recorder = Recorder()


def install_hook(server=None):
    """Podpina rejestrator pod PromptServer.send_sync (raz, także po przeładowaniu modułu)."""
    server = server or PromptServer.instance
    original = server.send_sync
    if getattr(original, "_szandor_memory", False):
        original = original._szandor_original

    def send_sync(event, data, sid=None):
        if event in WATCHED_EVENTS:
            try:
                recorder.on_message(event, data if isinstance(data, dict) else {})
            except Exception as exc:
                logging.warning("[Szandor Memory] recording error (%s): %s", event, exc)
        return original(event, data, sid)

    send_sync._szandor_memory = True
    send_sync._szandor_original = original
    server.send_sync = send_sync


try:
    install_hook()
except Exception as exc:
    logging.warning("[Szandor Memory] could not hook node recording: %s", exc)


# ─── akcje ────────────────────────────────────────────────────────────────────

class Busy(Exception):
    pass


def _queue_running():
    queue = getattr(PromptServer.instance, "prompt_queue", None)
    if queue is None:
        return False
    with queue.mutex:
        return len(queue.currently_running) > 0


def perform_action(action, payload):
    """Akcja z panelu. Wyładowanie / czyszczenie tylko przy bezczynnej kolejce — w trakcie zadania
    służy do tego węzeł Memory Cleanup wpięty w workflow."""
    device = gpu_device()
    if action == "reset_peak":
        recorder.reset_peak(device)
        return {"message": "Peak reset."}
    if action == "clear_cache":
        PromptServer.instance.prompt_queue.set_flag("free_memory", True)
        return {"message": "The ComfyUI cache will be cleared once the queue is empty "
                           "(models will load again on the next run)."}
    with recorder.action_lock:
        if recorder.busy or _queue_running():
            raise Busy("A job is running — use the Memory Cleanup node in the workflow, or wait.")
        before = snapshot(device)
        if action == "unload_model":
            target = str(payload.get("id") or "")
            names = unload_models(lambda p: str(id(p)) == target)
            message = f"Unloaded from VRAM: {', '.join(names)}" if names else "The model is no longer loaded."
        elif action == "unload_kind":
            kind = payload.get("kind")
            if kind not in KIND_LABELS:
                raise ValueError(f"Unknown model kind: {kind}")
            names = unload_models(lambda p: classify(p) == kind)
            message = f"Unloaded from VRAM: {', '.join(names)}" if names else f"Nothing loaded: {KIND_LABELS[kind]}."
        elif action == "unload_all":
            names = unload_models(lambda p: True)
            message = f"Unloaded from VRAM: {', '.join(names)}" if names else "No model was loaded."
        elif action == "empty_cache":
            if mm is not None:
                mm.soft_empty_cache()
            message = "Emptied the CUDA cache."
        elif action == "gc":
            collected = gc.collect()
            if mm is not None:
                mm.soft_empty_cache()
            message = f"gc.collect(): {collected} objects, emptied the CUDA cache."
        else:
            raise ValueError(f"Unknown action: {action}")
        after = snapshot(device)
    freed = (before.get("device") or 0) - (after.get("device") or 0)
    return {"message": message, "freed": freed}


# ─── API dla panelu ──────────────────────────────────────────────────────────

@PromptServer.instance.routes.get("/szandor/memory/stats")
async def szandor_memory_stats(request):
    device = gpu_device()
    gpu = _try(gpu_stats, device)
    if gpu is not None:
        gpu["peak"] = max(recorder.global_peak, gpu["peak_allocated"])
    return web.json_response({
        "gpu": gpu, "ram": ram_stats(), "policy": memory_policy(),
        "models": list_models(), "time": time.time(), **recorder.live(),
    })


@PromptServer.instance.routes.get("/szandor/memory/history")
async def szandor_memory_history(request):
    return web.json_response({"runs": recorder.history(), "serial": recorder.serial})


@PromptServer.instance.routes.post("/szandor/memory/action")
async def szandor_memory_action(request):
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    action = payload.get("action") or ""
    loop = asyncio.get_running_loop()
    try:
        # Wyładowanie może trwać kilka sekund — poza pętlą zdarzeń, żeby nie blokować interfejsu.
        result = await loop.run_in_executor(None, perform_action, action, payload)
    except Busy as exc:
        return web.json_response({"error": str(exc)}, status=409)
    except ValueError as exc:
        return web.json_response({"error": str(exc)}, status=400)
    except Exception as exc:
        logging.exception("[Szandor Memory] action %s", action)
        return web.json_response({"error": f"{type(exc).__name__}: {exc}"}, status=500)
    return web.json_response(result)


# ─── nody ─────────────────────────────────────────────────────────────────────

class SzandorMemoryMonitor:
    """Panel z pamięcią na żywo; sam nic nie wykonuje i nie trzeba go podłączać."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "refresh": (REFRESH_CHOICES, {"default": "1 s", "tooltip": "How often the panel refreshes."}),
        }}

    RETURN_TYPES = ()
    FUNCTION = "noop"
    CATEGORY = "Szandor/Utils"
    DESCRIPTION = "Live VRAM / RAM panel with loaded models and per-node memory of recent runs. Needs no connections."

    def noop(self, refresh):
        return ()


def _gb(value):
    return f"{value / 1024 ** 3:.2f} GB"


class SzandorMemoryCleanup:
    """Przelotowy węzeł: po obliczeniu wejścia zwalnia zaznaczone modele / pamięć i oddaje dane dalej."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "value": (ANY, {"tooltip": "Any data (e.g. CONDITIONING, LATENT, IMAGE) — passed through unchanged. "
                                           "Cleanup runs once it is ready."}),
                "text_encoders": ("BOOLEAN", {"default": True, "tooltip": "Unload text encoders (CLIP / T5 / Qwen…) from VRAM."}),
                "vae": ("BOOLEAN", {"default": False, "tooltip": "Unload VAE models from VRAM."}),
                "diffusion_models": ("BOOLEAN", {"default": False, "tooltip": "Unload diffusion models (UNet / DiT) from VRAM."}),
                "controlnets": ("BOOLEAN", {"default": False, "tooltip": "Unload ControlNets from VRAM."}),
                "other_models": ("BOOLEAN", {"default": False, "tooltip": "Unload other models (e.g. CLIP Vision, upscalers)."}),
                "empty_cache": ("BOOLEAN", {"default": True, "tooltip": "Return unused memory from the PyTorch cache (torch.cuda.empty_cache)."}),
                "gc_collect": ("BOOLEAN", {"default": False, "tooltip": "Run gc.collect() before emptying the cache."}),
                "clear_cache_after_run": ("BOOLEAN", {"default": False, "tooltip": "After the whole job finishes, clear the ComfyUI "
                                                                                    "cache and unload models (also frees RAM; "
                                                                                    "the next run loads models again)."}),
            },
        }

    RETURN_TYPES = (ANY, "STRING")
    RETURN_NAMES = ("value", "report")
    OUTPUT_TOOLTIPS = ("The input, unchanged.", "What was freed.")
    FUNCTION = "cleanup"
    CATEGORY = "Szandor/Utils"
    DESCRIPTION = "Pass-through node: once its input is ready, unloads the selected models and frees memory."

    def cleanup(self, value, text_encoders, vae, diffusion_models, controlnets, other_models,
                empty_cache, gc_collect, clear_cache_after_run):
        kinds = {kind for kind, on in (("text_encoder", text_encoders), ("vae", vae), ("diffusion", diffusion_models),
                                       ("controlnet", controlnets), ("other", other_models)) if on}
        device = gpu_device()
        before = snapshot(device)
        names = unload_models(lambda p: classify(p) in kinds) if kinds and mm is not None else []
        if gc_collect:
            gc.collect()
        if (empty_cache or gc_collect) and mm is not None:
            mm.soft_empty_cache()
        if clear_cache_after_run:
            PromptServer.instance.prompt_queue.set_flag("free_memory", True)
        after = snapshot(device)

        lines = [f"Unloaded: {', '.join(names)}" if names else
                 ("Unloaded: nothing (no selected model was in VRAM)" if kinds else "Unloaded: nothing (no models selected)")]
        if device is not None:
            lines.append(f"Device VRAM: {_gb(before['device'])} → {_gb(after['device'])} "
                         f"(freed {_gb(before['device'] - after['device'])})")
            lines.append(f"PyTorch allocated: {_gb(before['allocated'])} → {_gb(after['allocated'])}, "
                         f"reserved: {_gb(before['reserved'])} → {_gb(after['reserved'])}")
        lines.append(f"ComfyUI RAM: {_gb(before['rss'])} → {_gb(after['rss'])}")
        if clear_cache_after_run:
            lines.append("After the job: clearing the ComfyUI cache.")
        report = "\n".join(lines)
        logging.info("[Szandor Memory Cleanup] %s", report.replace("→", "->"))
        return {"ui": {"szandor_memory": [report]}, "result": (value, report)}


NODE_CLASS_MAPPINGS = {
    "SzandorMemoryMonitor": SzandorMemoryMonitor,
    "SzandorMemoryCleanup": SzandorMemoryCleanup,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "SzandorMemoryMonitor": "Memory Monitor (Szandor)",
    "SzandorMemoryCleanup": "Memory Cleanup (Szandor)",
}
