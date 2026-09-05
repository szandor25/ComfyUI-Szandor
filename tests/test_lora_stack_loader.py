"""Trigger integration tests with ComfyUI model loading stubbed out."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch


def load_node():
    comfy = ModuleType("comfy")
    comfy.sd = SimpleNamespace(load_lora_for_models=Mock(side_effect=lambda m, c, *_: (m, c)))
    comfy.utils = SimpleNamespace(load_torch_file=Mock(return_value={}))
    paths = SimpleNamespace(get_filename_list=Mock(), get_full_path=Mock())
    routes = SimpleNamespace(get=lambda _: lambda handler: handler)
    modules = {
        "comfy": comfy, "comfy.sd": comfy.sd, "comfy.utils": comfy.utils,
        "folder_paths": paths, "aiohttp": SimpleNamespace(web=SimpleNamespace()),
        "server": SimpleNamespace(PromptServer=SimpleNamespace(instance=SimpleNamespace(routes=routes))),
    }
    spec = importlib.util.spec_from_file_location(
        "lora_stack_under_test", Path(__file__).parents[1] / "nodes/lora_stack_loader.py"
    )
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, modules):
        spec.loader.exec_module(module)
    return module


class TriggerTests(unittest.TestCase):
    def setUp(self):
        self.node = load_node()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "style.safetensors"
        self.path.write_bytes(b"")
        self.node.folder_paths.get_filename_list.return_value = [self.path.name]
        self.node.folder_paths.get_full_path.return_value = str(self.path)

    def metadata(self, data):
        header = json.dumps({"__metadata__": data}).encode()
        self.path.write_bytes(len(header).to_bytes(8, "little") + header)

    def read(self):
        return self.node._triggers_for_lora(self.path.name)["trigger"]

    def test_sidecar_precedence_and_nested_metadata(self):
        self.metadata({"trigger_words": "embedded"})
        self.path.with_suffix(".civitai.info").write_text(json.dumps({
            "modelVersion": {"trainedWords": [" magic style ", "second", "magic style"]}
        }))
        self.assertEqual(self.read(), "magic style, second")
        self.path.with_suffix(".trigger.txt").write_text("local trigger\n")
        self.assertEqual(self.read(), "local trigger")

    def test_broken_sidecar_falls_back_to_safetensors(self):
        self.path.with_suffix(".json").write_text("broken json")
        self.metadata({"ss_trigger_words": '["first", "second"]'})
        self.assertEqual(self.read(), "first, second")

    def test_training_tags_are_not_guessed_as_triggers(self):
        self.metadata({"ss_tag_frequency": '{"set": {"a woman": 500}}'})
        self.assertEqual(self.read(), "")

    def test_private_model_offers_class_tokens_and_training_tags(self):
        self.metadata({
            "ss_datasets": json.dumps([
                {"subsets": [{"class_tokens": "my_person"}, {"class_tokens": "my_style"}]},
                {"subsets": [{"class_tokens": "my_person"}]},
            ]),
            "ss_tag_frequency": json.dumps({
                "set1": {"my_person": 100, "portrait": 80, "blue eyes": 20},
                "set2": {"portrait": 30},
            }),
        })
        result = self.node._triggers_for_lora(self.path.name)
        self.assertEqual(result["trigger"], "")
        self.assertEqual(result["suggestions"], [
            {"text": "my_person", "source": "class_tokens"},
            {"text": "my_style", "source": "class_tokens"},
            {"text": "portrait", "source": "ss_tag_frequency", "count": 110},
            {"text": "blue eyes", "source": "ss_tag_frequency", "count": 20},
        ])
        self.assertEqual(self.apply([self.row(trigger=None)])[2], "")
        self.assertEqual(self.apply([self.row(trigger="my_person")])[2], "my_person")

    def test_lora_manager_sidecar_with_local_words_and_training_suggestions(self):
        self.metadata({"ss_tag_frequency": '{"set": {"portrait": 20}}'})
        sidecar = self.path.with_suffix(".metadata.json")
        for data in ({"civitai": {"trainedWords": ["private_trigger"]}, "from_civitai": False},
                     {"trainedWords": ["private_trigger"]}):
            sidecar.write_text(json.dumps(data))
            result = self.node._triggers_for_lora(self.path.name)
            self.assertEqual(result["trigger"], "private_trigger")
            self.assertEqual(result["source"], sidecar.name)
            self.assertEqual(result["suggestions"][0]["text"], "portrait")

    def test_malformed_training_data_does_not_hide_valid_words(self):
        result = self.node._training_suggestions({
            "ss_datasets": '[null, {"subsets": [false, {"class_tokens": "valid"}]}]',
            "ss_tag_frequency": '{"bad": [], "good": {"tag": 3, "bad": "x", "no": -2, "nan": NaN}}',
        })
        self.assertEqual([item["text"] for item in result], ["valid", "tag"])
        self.assertEqual(self.node._training_suggestions({"ss_datasets": "broken"}), [])

    def test_invalid_headers_and_unregistered_paths(self):
        for raw in (b"", b"bad", (2**63).to_bytes(8, "little"), b"\x04\0\0\0\0\0\0\0nope"):
            self.path.write_bytes(raw)
            self.assertEqual(self.read(), "")
        self.node.folder_paths.get_full_path.reset_mock()
        self.assertEqual(self.node._triggers_for_lora("../secret")["trigger"], "")
        self.node.folder_paths.get_full_path.assert_not_called()

    def apply(self, rows, prompt="portrait"):
        return self.node.SzandorLoraStackLoader().apply_loras("model", "clip", json.dumps(rows), prompt)

    def row(self, **changes):
        return {"name": self.path.name, "strength": 1, "enabled": True,
                "trigger": "magic style", "use_trigger": True, **changes}

    def test_only_active_selected_rows_contribute(self):
        rows = [self.row(enabled=False, trigger="disabled"),
                self.row(strength=0, trigger="zero"),
                self.row(use_trigger=False, trigger="unchecked"), self.row(),
                self.row(), self.row(trigger="next")]
        self.assertEqual(self.apply(rows), ("model", "clip", "magic style, next", "magic style, next, portrait"))
        self.assertEqual(self.node.comfy.sd.load_lora_for_models.call_count, 4)

    def test_legacy_workflow_keeps_prompt_unchanged(self):
        result = self.apply([{"name": self.path.name, "strength": 0.7}])
        self.assertEqual(result, ("model", "clip", "", "portrait"))

    def test_pending_metadata_manual_override_and_explicit_empty(self):
        self.metadata({"trigger_words": "embedded"})
        self.assertEqual(self.apply([self.row(trigger=None)])[2], "embedded")
        self.assertEqual(self.apply([self.row(trigger="manual")])[2], "manual")
        self.assertEqual(self.apply([self.row(trigger="")])[2], "")
        self.assertEqual(self.apply([self.row()], prompt="")[3], "magic style")


if __name__ == "__main__":
    unittest.main()
