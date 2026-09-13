import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest

from PIL import Image


spec = importlib.util.spec_from_file_location("h3_template_store", Path(__file__).parents[1] / "nodes/h3_template_store.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TemplateStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for kind in ("input", "output", "temp", "photos"):
            (self.root / kind).mkdir()
        self.store = module.TemplateStore(self.root / "library", self.root / "input", self.root / "output", self.root / "temp")
        self.image = self.root / "input" / "żółw.png"
        Image.new("RGBA", (4, 3), (20, 40, 60, 128)).save(self.image)
        self.original = self.image.read_bytes()
        self.payload = {
            "name": "Scena / pierwszy plan", "prompt": "  [Shot 1]\n<d>[Polish] Cześć!</d>\n", "duration": 5.2,
            "editor_id": 1, "notes": "Obraz 1 = postać",
            "images": [{"node_id": 2, "widget_index": 0, "label": "Pierwsza klatka"}],
            "workflow": {"nodes": [
                {"id": 1, "type": "SzandorMiniMaxH3Prompt", "widgets_values": ["  [Shot 1]\n<d>[Polish] Cześć!</d>\n"]},
                {"id": 2, "type": "LoadImage", "widgets_values": ["żółw.png", "image"]},
                {"id": 3, "type": "Sampler", "widgets_values": [123456, "fixed", 25]},
            ], "links": [[1, 2, 0, 3, 0, "IMAGE"]], "extra": {"example": True}},
        }

    def test_round_trip_preserves_prompt_settings_links_and_original_image_bytes(self):
        saved = self.store.save(self.payload)
        self.image.unlink()
        self.assertEqual(len(self.store.list()), 1)
        self.assertEqual(saved["duration"], 5.2)
        result = self.store.restore(saved["id"])
        self.assertEqual(result["prompt"], self.payload["prompt"])
        workflow = result["workflow"]
        self.assertEqual(workflow["links"], self.payload["workflow"]["links"])
        self.assertEqual(workflow["nodes"][2], self.payload["workflow"]["nodes"][2])
        new_path = self.root / "input" / workflow["nodes"][1]["widgets_values"][0]
        self.assertEqual(new_path.read_bytes(), self.original)
        self.assertEqual(workflow["nodes"][1]["widgets_values"][1], "image")
        self.assertEqual(self.store.read(saved["id"])["workflow"], self.payload["workflow"])

    def test_directory_and_multi_image_slots_retain_order_and_copies(self):
        directory = self.root / "photos"
        Image.new("RGB", (2, 2), "red").save(directory / "second.png")
        nodes = self.payload["workflow"]["nodes"]
        nodes += [{"id": 4, "type": "SzandorDirectoryImageLoader", "widgets_values": [str(directory), "second.png"]},
                  {"id": 5, "type": "MultiImageLoader", "widgets_values": [2, "żółw.png", "żółw.png"]}]
        self.payload["images"] += [{"node_id": 4, "widget_index": 1, "directory_index": 0},
                                   {"node_id": 5, "widget_index": 1}, {"node_id": 5, "widget_index": 2}]
        saved = self.store.save(self.payload)
        self.image.write_bytes(b"original replaced")
        (directory / "second.png").unlink()
        restored = self.store.restore(saved["id"])["workflow"]["nodes"]
        dir_values = restored[3]["widgets_values"]
        self.assertTrue((Path(dir_values[0]) / dir_values[1]).is_file())
        self.assertEqual(restored[4]["widgets_values"][1], restored[4]["widgets_values"][2])
        self.assertEqual(len(saved["images"]), 4)
        self.assertEqual(len(list((self.store.directory(saved["id"]) / "images").iterdir())), 2)

    def test_annotated_output_image_is_copied_to_input(self):
        path = self.root / "output" / "frame.png"
        path.write_bytes(self.original)
        self.payload["workflow"]["nodes"][1]["widgets_values"][0] = "frame.png [output]"
        saved = self.store.save(self.payload)
        restored = self.store.restore(saved["id"])
        value = restored["workflow"]["nodes"][1]["widgets_values"][0]
        self.assertEqual((self.root / "input" / value).read_bytes(), self.original)

    def test_save_is_atomic_if_any_image_is_missing(self):
        self.payload["workflow"]["nodes"].append({"id": 4, "type": "LoadImage", "widgets_values": ["missing.png"]})
        self.payload["images"].append({"node_id": 4, "widget_index": 0})
        with self.assertRaises(FileNotFoundError):
            self.store.save(self.payload)
        self.assertEqual(self.store.list(), [])
        self.assertEqual(list(self.store.root.iterdir()), [])

    def test_invalid_image_or_escaping_path_cannot_be_archived(self):
        values = self.payload["workflow"]["nodes"][1]["widgets_values"]
        for value in ("../output/frame.png", "/etc/passwd", "fake.png"):
            values[0] = value
            (self.root / "input" / "fake.png").write_text("not an image")
            with self.assertRaises((ValueError, OSError)):
                self.store.save(self.payload)
            self.assertEqual(self.store.list(), [])

    def test_corrupted_copy_is_reported_before_restore(self):
        saved = self.store.save(self.payload)
        self.store.image_path(saved["id"], saved["images"][0]["file"]).write_bytes(b"corrupted")
        with self.assertRaisesRegex(ValueError, "Uszkodzona"):
            self.store.restore(saved["id"])
        self.assertFalse((self.root / "input" / "szandor_h3_templates").exists())

    def test_empty_prompt_no_images_and_duplicate_names(self):
        self.payload["prompt"] = ""
        self.payload["workflow"]["nodes"][0]["widgets_values"] = [""]
        self.payload["images"] = []
        self.payload["duration"] = None
        first = self.store.save(self.payload)
        second = self.store.save(self.payload)
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(self.store.restore(first["id"])["prompt"], "")
        self.assertEqual(len(self.store.list()), 2)

    def test_invalid_duration_prompt_and_template_id(self):
        for duration in (-1, 0, float("nan"), True, "five"):
            payload = copy.deepcopy(self.payload)
            payload["duration"] = duration
            with self.assertRaises(ValueError):
                self.store.save(payload)
        self.payload["prompt"] = "different text"
        with self.assertRaises(ValueError):
            self.store.save(self.payload)
        with self.assertRaises(ValueError):
            self.store.read("../../secrets")

    def test_delete_removes_only_selected_archive_and_preserves_workflow_images(self):
        first = self.store.save(self.payload)
        second = self.store.save(self.payload)
        restored = self.store.restore(first["id"])
        restored_path = self.root / "input" / restored["workflow"]["nodes"][1]["widgets_values"][0]
        self.assertEqual(self.store.delete(first["id"]), {"deleted": first["id"]})
        self.assertFalse(self.store.directory(first["id"]).exists())
        self.assertEqual([item["id"] for item in self.store.list()], [second["id"]])
        self.assertEqual(self.image.read_bytes(), self.original)
        self.assertEqual(restored_path.read_bytes(), self.original)
        self.assertEqual(self.store.restore(second["id"])["prompt"], self.payload["prompt"])
        with self.assertRaises(FileNotFoundError):
            self.store.delete(first["id"])

    def test_delete_rejects_paths_and_directory_symlinks(self):
        saved = self.store.save(self.payload)
        with self.assertRaises(ValueError):
            self.store.delete("../input")
        alias = "b" * 32
        self.store.directory(alias).symlink_to(self.store.directory(saved["id"]), target_is_directory=True)
        with self.assertRaises(ValueError):
            self.store.delete(alias)
        self.assertTrue(self.store.directory(saved["id"]).exists())


if __name__ == "__main__":
    unittest.main()
