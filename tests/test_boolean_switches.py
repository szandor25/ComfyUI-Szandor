import importlib.util
from pathlib import Path
import unittest


def load_node():
    spec = importlib.util.spec_from_file_location(
        "boolean_switches_under_test", Path(__file__).parents[1] / "nodes/boolean_switches.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BooleanSwitchesTest(unittest.TestCase):
    def test_outputs_follow_switches_in_order(self):
        node = load_node().BooleanSwitches()
        values = {"switch_1": True, "switch_2": False, "switch_3": True, "switch_4": False, "switch_5": True}
        self.assertEqual(node.switches(**values), (True, False, True, False, True))

    def test_declares_five_boolean_inputs_and_outputs(self):
        cls = load_node().BooleanSwitches
        required = cls.INPUT_TYPES()["required"]
        self.assertEqual(list(required), [f"switch_{i}" for i in range(1, 6)])
        self.assertTrue(all(spec[0] == "BOOLEAN" for spec in required.values()))
        self.assertEqual(cls.RETURN_TYPES, ("BOOLEAN",) * 5)


if __name__ == "__main__":
    unittest.main()
