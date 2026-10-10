"""Memory Monitor / Memory Cleanup tests with ComfyUI stubbed out (no GPU needed).

Run with the ComfyUI venv (needs torch, psutil):
    python -m unittest discover -s tests -p "test_memory_monitor.py"
"""
import importlib.util
from pathlib import Path
import sys
import threading
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

import torch  # noqa: F401 — import before patch.dict so it is not unloaded between tests


class BaseModel:
    pass


def make_class(name, module, base=object):
    return type(name, (base,), {"__module__": module})


class FakePatcher:
    def __init__(self, inner, size=4 * 1024 ** 3, loaded=None, dtype=torch.bfloat16):
        self.model = inner
        self.size = size
        self.loaded = size if loaded is None else loaded
        self.dtype = dtype
        self.patches = {}

    def model_size(self):
        return self.size

    def loaded_size(self):
        return self.loaded

    def model_dtype(self):
        return self.dtype

    def current_loaded_device(self):
        return "cuda:0"

    def is_dynamic(self):
        return False


class FakeLoaded:
    def __init__(self, patcher):
        self._patcher = patcher
        self.device = "cuda:0"

    @property
    def model(self):
        return self._patcher

    def __eq__(self, other):
        return self.model is other.model


class FakeQueue:
    def __init__(self):
        self.mutex = threading.RLock()
        self.currently_running = {}
        self.flags = {}

    def set_flag(self, name, value):
        self.flags[name] = value


def load_module():
    sent = []
    server = SimpleNamespace(
        routes=SimpleNamespace(get=lambda _: lambda h: h, post=lambda _: lambda h: h),
        send_sync=lambda event, data, sid=None: sent.append((event, data)),
        prompt_queue=FakeQueue(),
    )
    mm = ModuleType("comfy.model_management")
    mm.current_loaded_models = []
    mm.free_calls = []
    mm.empty_calls = 0

    def free_memory(memory_required, device, keep_loaded=[]):
        mm.free_calls.append((device, list(keep_loaded)))
        mm.current_loaded_models[:] = [lm for lm in mm.current_loaded_models
                                       if lm.device != device or lm in keep_loaded]

    def soft_empty_cache(force=False):
        mm.empty_calls += 1

    mm.free_memory = free_memory
    mm.soft_empty_cache = soft_empty_cache
    mm.get_torch_device = lambda: torch.device("cpu")
    mm.vram_state = SimpleNamespace(name="HIGH_VRAM")
    mm.extra_reserved_memory = lambda: 600 * 1024 ** 2
    mm.TOTAL_PINNED_MEMORY = 123
    model_base = ModuleType("comfy.model_base")
    model_base.BaseModel = BaseModel
    cli_args = ModuleType("comfy.cli_args")
    cli_args.args = SimpleNamespace(highvram=True, reserve_vram=2.0, lowvram=False)
    comfy = ModuleType("comfy")
    comfy.model_management, comfy.model_base, comfy.cli_args = mm, model_base, cli_args
    modules = {
        "aiohttp": SimpleNamespace(web=SimpleNamespace()),
        "server": SimpleNamespace(PromptServer=SimpleNamespace(instance=server)),
        "comfy": comfy, "comfy.model_management": mm, "comfy.model_base": model_base, "comfy.cli_args": cli_args,
    }
    spec = importlib.util.spec_from_file_location("memory_monitor_under_test",
                                                  Path(__file__).parents[1] / "nodes/memory_monitor.py")
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, modules):
        spec.loader.exec_module(module)
    return module, mm, server, sent


def diffusion():
    cls = make_class("WAN21", "comfy.model_base", BaseModel)
    inner = cls()
    inner.model_config = make_class("WAN22_T2V", "comfy.supported_models")()
    return inner


class ModelTests(unittest.TestCase):
    def setUp(self):
        self.m, self.mm, self.server, self.sent = load_module()
        self.te = FakePatcher(make_class("WanT5Model", "comfy.text_encoders.wan")(), dtype=torch.float8_e4m3fn)
        self.vae = FakePatcher(make_class("WanVAE", "comfy.ldm.wan.vae")(), size=2 * 1024 ** 3)
        self.dit = FakePatcher(diffusion(), size=28 * 1024 ** 3, loaded=20 * 1024 ** 3)
        self.dit_lora = FakePatcher(self.dit.model)  # klon z LoRA — ten sam model bazowy
        self.dit_lora.patches = {"a": 1, "b": 2}
        self.cn = FakePatcher(make_class("ControlNet", "comfy.cldm.cldm")())
        self.vision = FakePatcher(make_class("CLIPVisionModelProjection", "comfy.clip_model")())
        self.mm.current_loaded_models[:] = [FakeLoaded(p) for p in
                                           (self.te, self.vae, self.dit, self.dit_lora, self.cn, self.vision)]

    def test_classify_and_list(self):
        kinds = [self.m.classify(p) for p in (self.te, self.vae, self.dit, self.cn, self.vision)]
        self.assertEqual(kinds, ["text_encoder", "vae", "diffusion", "controlnet", "other"])
        models = self.m.list_models()
        self.assertEqual([x["name"] for x in models][:3], ["WanT5Model", "WanVAE", "WAN22_T2V"])
        self.assertEqual((models[0]["dtype"], models[2]["loaded"], models[3]["patches"]),
                         ("float8_e4m3fn", 20 * 1024 ** 3, 2))
        self.assertEqual(models[0]["id"], str(id(self.te)))
        # Partially loaded (lowvram): the rest of the weights stays in RAM; a LoRA clone shares the base.
        self.assertEqual((models[2]["loaded"], models[2]["ram"]), (20 * 1024 ** 3, 8 * 1024 ** 3))
        self.assertEqual((models[0]["ram"], models[0]["pinned"]), (0, 0))
        self.assertEqual(models[2]["base"], models[3]["base"])
        self.assertNotEqual(models[0]["base"], models[1]["base"])

    def test_model_memory_cpu_and_dynamic_loading(self):
        cpu = FakePatcher(make_class("CLIP", "comfy.sd")(), size=6 * 1024 ** 3)
        self.assertEqual(self.m.model_memory(cpu, "cpu"), (0, 6 * 1024 ** 3, 0))
        dynamic = FakePatcher(make_class("Flux", "comfy.model_base")(), size=24 * 1024 ** 3, loaded=10 * 1024 ** 3)
        dynamic.is_dynamic = lambda: True
        dynamic.loaded_ram_size = lambda: 5 * 1024 ** 3
        dynamic.pinned_memory_size = lambda: 2 * 1024 ** 3
        # The remaining 9 GB is not resident: dynamic loading reads it from disk on demand.
        self.assertEqual(self.m.model_memory(dynamic, "cuda:0"), (10 * 1024 ** 3, 5 * 1024 ** 3, 2 * 1024 ** 3))

    def test_unload_kind_keeps_other_models(self):
        names = self.m.unload_models(lambda p: self.m.classify(p) == "text_encoder")
        self.assertEqual(names, ["WanT5Model"])
        left = [lm.model for lm in self.mm.current_loaded_models]
        self.assertNotIn(self.te, left)
        self.assertIn(self.vae, left)
        self.assertEqual(self.mm.empty_calls, 1)

    def test_unload_single_model_takes_its_clones(self):
        names = self.m.unload_models(lambda p: p is self.dit)
        self.assertEqual(names, ["WAN22_T2V", "WAN22_T2V"])
        left = [lm.model for lm in self.mm.current_loaded_models]
        self.assertEqual(left, [self.te, self.vae, self.cn, self.vision])

    def test_actions_refused_while_busy_and_allowed_when_idle(self):
        self.m.recorder.busy = True
        with self.assertRaises(self.m.Busy):
            self.m.perform_action("unload_all", {})
        self.assertEqual(len(self.mm.current_loaded_models), 6)
        self.assertIn("Peak", self.m.perform_action("reset_peak", {})["message"])
        self.m.recorder.busy = False
        self.server.prompt_queue.currently_running = {1: (0, "p", {}, {}, [])}
        with self.assertRaises(self.m.Busy):
            self.m.perform_action("empty_cache", {})
        self.server.prompt_queue.currently_running = {}
        result = self.m.perform_action("unload_model", {"id": str(id(self.vae))})
        self.assertIn("WanVAE", result["message"])
        self.assertIn("WanT5Model", self.m.perform_action("unload_kind", {"kind": "text_encoder"})["message"])
        self.assertIn("Nothing loaded", self.m.perform_action("unload_kind", {"kind": "text_encoder"})["message"])
        with self.assertRaises(ValueError):
            self.m.perform_action("unload_kind", {"kind": "nope"})
        with self.assertRaises(ValueError):
            self.m.perform_action("explode", {})
        self.m.perform_action("clear_cache", {})
        self.assertEqual(self.server.prompt_queue.flags, {"free_memory": True})

    def test_cleanup_node_unloads_selected_kinds_and_passes_value(self):
        node = self.m.SzandorMemoryCleanup()
        value = object()
        out = node.cleanup(value, text_encoders=True, vae=True, diffusion_models=False, controlnets=False,
                           other_models=False, empty_cache=True, gc_collect=True, clear_cache_after_run=True)
        self.assertIs(out["result"][0], value)
        report = out["result"][1]
        self.assertIn("WanT5Model", report)
        self.assertIn("WanVAE", report)
        self.assertIn("ComfyUI RAM", report)
        self.assertEqual([lm.model for lm in self.mm.current_loaded_models], [self.dit, self.dit_lora, self.cn, self.vision])
        self.assertEqual(self.server.prompt_queue.flags, {"free_memory": True})
        out = node.cleanup(value, False, False, False, False, False, False, False, False)
        self.assertIn("no models selected", out["result"][1])

    def test_policy(self):
        policy = self.m.memory_policy()
        self.assertEqual(policy["vram_state"], "HIGH_VRAM")
        self.assertEqual(policy["flags"], ["--highvram", "--reserve-vram 2.0"])
        self.assertEqual(self.m.ram_stats()["pinned"], 123)


class RecorderTests(unittest.TestCase):
    def setUp(self):
        self.m, self.mm, self.server, self.sent = load_module()

    def test_hook_records_nodes_and_passes_messages_through(self):
        self.server.prompt_queue.currently_running = {
            7: (0, "pid", {"3": {"class_type": "KSampler", "_meta": {"title": "Sampler"}},
                           "4": {"class_type": "VAEDecode"}}, {}, [])}
        self.m.install_hook(self.server)
        self.m.install_hook(self.server)  # drugi raz nie owija ponownie
        send = self.server.send_sync
        send("execution_start", {"prompt_id": "pid"}, "sid")
        self.assertTrue(self.m.recorder.busy)
        send("execution_cached", {"nodes": ["1", "2"], "prompt_id": "pid"}, "sid")
        send("executing", {"node": "3", "display_node": "3", "prompt_id": "pid"}, "sid")
        send("progress", {"value": 1}, "sid")
        send("executing", {"node": "4", "display_node": "4", "prompt_id": "pid"}, "sid")
        live = self.m.recorder.live()
        self.assertEqual(live["current"]["class_type"], "VAEDecode")
        history = self.m.recorder.history()
        self.assertEqual(history[0]["status"], "running")
        send("execution_success", {"prompt_id": "pid"}, "sid")
        send("executing", {"node": None, "prompt_id": "pid"}, "sid")
        self.assertFalse(self.m.recorder.busy)
        self.assertEqual(len(self.sent), 7)  # wszystkie komunikaty dotarły dalej

        runs = self.m.recorder.history()
        self.assertEqual(len(runs), 1)
        run = runs[0]
        self.assertEqual((run["status"], run["cached"]), ("success", ["1", "2"]))
        self.assertEqual([(n["node"], n["class_type"], n["title"]) for n in run["nodes"]],
                         [("3", "KSampler", "Sampler"), ("4", "VAEDecode", "")])
        for node in run["nodes"]:
            self.assertIsNotNone(node["t1"])
            self.assertGreaterEqual(node["t1"], node["t0"])
            self.assertGreater(node["end"]["rss"], 0)
        self.assertNotIn("titles", run)
        self.assertEqual(self.m.recorder.serial, 1)

    def test_error_and_history_limit(self):
        self.m.install_hook(self.server)
        for i in range(self.m.HISTORY_RUNS + 2):
            self.server.send_sync("execution_start", {"prompt_id": f"p{i}"})
            self.server.send_sync("executing", {"node": "1"})
            self.server.send_sync("execution_error" if i == 0 else "execution_interrupted", {})
        runs = self.m.recorder.history()
        self.assertEqual(len(runs), self.m.HISTORY_RUNS)
        self.assertEqual(runs[0]["prompt_id"], f"p{self.m.HISTORY_RUNS + 1}")
        self.assertEqual(runs[0]["status"], "interrupted")

    def test_recorder_failure_never_breaks_sending(self):
        self.m.install_hook(self.server)
        with patch.object(self.m.recorder, "on_message", side_effect=RuntimeError("boom")):
            with self.assertLogs(level="WARNING"):
                self.server.send_sync("execution_start", {"prompt_id": "x"})
        self.assertEqual(self.sent[-1][0], "execution_start")


if __name__ == "__main__":
    unittest.main()
