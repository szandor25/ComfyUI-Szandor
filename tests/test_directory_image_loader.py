"""Folder navigation API tests, without loading ComfyUI or torch."""
import asyncio
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


def load_node():
    routes = SimpleNamespace(get=lambda _: lambda handler: handler)
    modules = {
        "numpy": SimpleNamespace(), "torch": SimpleNamespace(),
        "PIL": SimpleNamespace(Image=None, ImageOps=None),
        "aiohttp": SimpleNamespace(web=SimpleNamespace(json_response=lambda data, status=200: (status, data))),
        "server": SimpleNamespace(PromptServer=SimpleNamespace(instance=SimpleNamespace(routes=routes))),
    }
    spec = importlib.util.spec_from_file_location(
        "directory_image_under_test", Path(__file__).parents[1] / "nodes/directory_image_loader.py"
    )
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, modules):
        spec.loader.exec_module(module)
    return module


class DirectoryBrowserTests(unittest.TestCase):
    def setUp(self):
        self.node = load_node()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_parent_children_images_and_natural_order(self):
        for name in ["folder10", "folder2", "zażółć & #"]:
            (self.root / name).mkdir()
        for name in ["image10.PNG", "image2.jpg", "notes.txt"]:
            (self.root / name).touch()
        (self.root / "folder2" / "nested.png").touch()
        result = self.node._browse_directory(str(self.root))
        self.assertEqual([item["name"] for item in result["directories"]], ["folder2", "folder10", "zażółć & #"])
        self.assertEqual(result["images"], ["image2.jpg", "image10.PNG"])
        child = self.node._browse_directory(result["directories"][0]["path"])
        self.assertEqual(child["parent"], result["directory"])
        self.assertEqual(child["images"], ["nested.png"])
        self.assertEqual(self.node._list_images(str(self.root)), result["images"])

    def test_empty_directory_and_roots(self):
        result = self.node._browse_directory(str(self.root))
        self.assertEqual((result["directories"], result["images"]), ([], []))
        roots = self.node._browse_directory("")
        self.assertIsNone(roots["parent"])
        self.assertTrue(roots["directories"])
        root = self.node._browse_directory(self.root.anchor)
        self.assertEqual(root["parent"], "")
        self.assertEqual(root["directory"], os.path.abspath(self.root.anchor))

    def test_api_distinguishes_missing_and_unreadable_folder(self):
        request = SimpleNamespace(query={"directory": str(self.root / "missing")})
        status, data = asyncio.run(self.node.szandor_browse_directory(request))
        self.assertEqual(status, 404)
        self.assertIn("error", data)
        request.query["directory"] = str(self.root)
        with patch.object(self.node.os, "scandir", side_effect=PermissionError):
            self.assertEqual(asyncio.run(self.node.szandor_browse_directory(request))[0], 403)
        self.assertEqual(asyncio.run(self.node.szandor_browse_directory(request))[0], 200)


if __name__ == "__main__":
    unittest.main()
