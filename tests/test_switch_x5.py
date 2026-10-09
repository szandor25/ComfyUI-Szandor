"""Switch x5 tests with the ComfyUI node API stubbed out."""
import importlib.util
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch


class _Stub:
    def __init__(self, *args, **kwargs):
        self.args, self.kwargs = args, kwargs


def load_node():
    io = SimpleNamespace(
        ComfyNode=object, Schema=_Stub, NodeOutput=lambda *values: values,
        MatchType=SimpleNamespace(Template=_Stub, Input=_Stub, Output=_Stub),
        Boolean=SimpleNamespace(Input=_Stub),
    )
    latest = ModuleType("comfy_api.latest")
    latest.io = io
    modules = {"comfy_api": ModuleType("comfy_api"), "comfy_api.latest": latest}
    spec = importlib.util.spec_from_file_location(
        "switch_x5_under_test", Path(__file__).parents[1] / "nodes/switch_x5.py"
    )
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, modules):
        spec.loader.exec_module(module)
    return module


class SwitchX5Test(unittest.TestCase):
    def setUp(self):
        self.node = load_node().SwitchX5

    def test_each_output_takes_the_selected_input(self):
        values = {f"on_true_{i}": f"t{i}" for i in range(1, 6)}
        values |= {f"on_false_{i}": f"f{i}" for i in range(1, 6)}
        values |= {"switch_1": True, "switch_2": False, "switch_3": True, "switch_4": False, "switch_5": False}
        self.assertEqual(self.node.execute(**values), ("t1", "f2", "t3", "f4", "f5"))

    def test_unconnected_selected_input_gives_none(self):
        self.assertEqual(self.node.execute(switch_1=True, on_false_1="f1"), (None,) * 5)

    def test_only_selected_lazy_inputs_are_requested(self):
        values = {"switch_1": True, "on_true_1": None, "on_false_1": None,
                  "switch_2": False, "on_true_2": None, "on_false_2": None,
                  "switch_3": True, "on_true_3": "ready"}
        self.assertEqual(self.node.check_lazy_status(**values), ["on_true_1", "on_false_2"])

    def test_schema_declares_five_switches(self):
        schema = self.node.define_schema().kwargs
        names = [spec.args[0] for spec in schema["inputs"]]
        self.assertEqual(names[:3], ["on_true_1", "on_false_1", "switch_1"])
        self.assertEqual(len(names), 15)
        self.assertEqual([out.kwargs["id"] for out in schema["outputs"]], [f"out_{i}" for i in range(1, 6)])


if __name__ == "__main__":
    unittest.main()
