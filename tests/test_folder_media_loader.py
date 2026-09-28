"""Folder Media Loader tests with the ComfyUI server stubbed out.

Run with the ComfyUI venv (needs torch, Pillow, PyAV):
    python -m unittest tests/test_folder_media_loader.py
"""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
import torch  # noqa: F401 — import before patch.dict so it is not unloaded between tests
from PIL import Image

try:
    import av
except ImportError:
    av = None


def load_node():
    routes = SimpleNamespace(get=lambda _: lambda handler: handler)
    modules = {
        "aiohttp": SimpleNamespace(web=SimpleNamespace()),
        "server": SimpleNamespace(PromptServer=SimpleNamespace(instance=SimpleNamespace(routes=routes))),
    }
    spec = importlib.util.spec_from_file_location(
        "folder_media_under_test", Path(__file__).parents[1] / "nodes/folder_media_loader.py"
    )
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, modules):
        spec.loader.exec_module(module)
    return module


def write_video(path, seconds=1, fps=8, with_audio=False):
    with av.open(str(path), "w") as container:
        stream = container.add_stream("mpeg4", rate=fps)
        stream.width, stream.height, stream.pix_fmt = 64, 48, "yuv420p"
        audio_stream = container.add_stream("aac", rate=16000) if with_audio else None
        for i in range(seconds * fps):
            frame = av.VideoFrame.from_ndarray(np.full((48, 64, 3), 200 if i == 0 else 10, np.uint8), format="rgb24")
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
        if audio_stream:
            samples = np.zeros((1, 16000 * seconds), np.float32)
            frame = av.AudioFrame.from_ndarray(samples, format="flt", layout="mono")
            frame.sample_rate = 16000
            for packet in audio_stream.encode(frame):
                container.mux(packet)
            for packet in audio_stream.encode():
                container.mux(packet)


def write_wav(path, seconds=2, rate=8000):
    with av.open(str(path), "w") as container:
        stream = container.add_stream("pcm_s16le", rate=rate)
        frame = av.AudioFrame.from_ndarray(np.zeros((1, rate * seconds), np.int16), format="s16", layout="mono")
        frame.sample_rate = rate
        for packet in stream.encode(frame):
            container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


class ScanAndPromptTests(unittest.TestCase):
    def setUp(self):
        self.m = load_node()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.dir = Path(self.temp.name)

    def test_groups_by_name_and_sorts_naturally(self):
        for name in ["shot10.png", "shot2.png", "shot2.txt", "shot2.json", "notes.md", "voice.mp3"]:
            (self.dir / name).write_bytes(b"")
        items = self.m.scan_directory(str(self.dir))
        self.assertEqual([i["name"] for i in items], ["shot2", "shot10", "voice"])
        self.assertEqual(items[0], {"name": "shot2", "image": "shot2.png", "txt": "shot2.txt", "json": "shot2.json"})
        self.assertEqual([i["name"] for i in self.m.filter_items(items, "audio")], ["voice"])
        self.assertEqual([i["name"] for i in self.m.filter_items(items, "tylko z promptem")], ["shot2"])

    def test_json_prompt_and_time_win_over_txt(self):
        (self.dir / "a.txt").write_text("from txt", encoding="utf-8")
        (self.dir / "a.json").write_text(json.dumps({"time": "00:07.5", "prompt": "from json"}), encoding="utf-8")
        info = self.m.resolve_item(str(self.dir), {"name": "a", "txt": "a.txt", "json": "a.json"}, 5)
        self.assertEqual((info["prompt"], info["time"], info["time_source"]), ("from json", 7.5, "json"))

    def test_start_end_are_optional_and_default_consistently(self):
        (self.dir / "a.json").write_text(json.dumps({"time": 4, "prompt": "p"}), encoding="utf-8")
        info = self.m.resolve_item(str(self.dir), {"name": "a", "json": "a.json"}, 5)
        self.assertEqual((info["start_time"], info["end_time"], info["range_in_json"]), (0.0, 4.0, False))
        self.assertIsNone(info["warning"])

    def test_start_end_from_json(self):
        (self.dir / "b.json").write_text(json.dumps({"start_time": "00:02", "end_time": 7.5, "prompt": "p"}))
        info = self.m.resolve_item(str(self.dir), {"name": "b", "json": "b.json"}, 5)
        self.assertEqual((info["start_time"], info["end_time"], info["time"], info["time_source"]),
                         (2.0, 7.5, 5.5, "json end−start"))
        (self.dir / "c.json").write_text(json.dumps({"time": 3, "start_time": 10}))
        info = self.m.resolve_item(str(self.dir), {"name": "c", "json": "c.json"}, 5)
        self.assertEqual((info["start_time"], info["end_time"], info["time"]), (10.0, 13.0, 3.0))

    def test_bad_or_reversed_range_warns_without_failing(self):
        (self.dir / "d.json").write_text(json.dumps({"time": 2, "start_time": "abc", "end_time": 1}))
        info = self.m.resolve_item(str(self.dir), {"name": "d", "json": "d.json"}, 5)
        self.assertEqual((info["start_time"], info["end_time"], info["time"]), (0.0, 1.0, 2.0))
        self.assertIn("start_time", info["warning"])
        (self.dir / "e.json").write_text(json.dumps({"start_time": 8, "end_time": 3}))
        info = self.m.resolve_item(str(self.dir), {"name": "e", "json": "e.json"}, 5)
        self.assertEqual((info["time"], info["time_source"]), (5.0, "domyślny"))
        self.assertIn("mniejszy", info["warning"])

    def test_txt_with_bom_and_default_time(self):
        (self.dir / "b.txt").write_bytes("﻿Zażółć\nlinia 2".encode("utf-8"))
        info = self.m.resolve_item(str(self.dir), {"name": "b", "txt": "b.txt"}, 3.5)
        self.assertEqual((info["prompt"], info["time"], info["time_source"]), ("Zażółć\nlinia 2", 3.5, "domyślny"))

    def test_bad_json_reports_warning_and_keeps_txt(self):
        (self.dir / "c.txt").write_text("txt prompt", encoding="utf-8")
        (self.dir / "c.json").write_text("{nope", encoding="utf-8")
        info = self.m.resolve_item(str(self.dir), {"name": "c", "txt": "c.txt", "json": "c.json"}, 5)
        self.assertEqual(info["prompt"], "txt prompt")
        self.assertIn("Niepoprawny JSON", info["warning"])

    def test_parse_time(self):
        p = self.m.parse_time
        self.assertEqual([p(5), p("5"), p("5s"), p("2,5 sek"), p("01:02"), p("0:01:00.5")], [5.0, 5.0, 5.0, 2.5, 62.0, 60.5])
        self.assertEqual([p(True), p("abc"), p(-1), p("")], [None, None, None, None])

    def test_format_time(self):
        f = self.m.format_time
        self.assertEqual(f(5.5, "liczba"), 5.5)
        self.assertIsInstance(f(5, "liczba"), float)
        self.assertEqual([f(5.5, "tekst: sekundy"), f(5, "tekst: sekundy"), f(0.125, "tekst: sekundy")], ["5.5", "5", "0.125"])
        self.assertEqual(f(65.25, "tekst: mm:ss.mmm"), "01:05.250")
        self.assertEqual(f(3725.5, "tekst: hh:mm:ss.mmm"), "01:02:05.500")
        for mode in self.m.TIME_OUTPUTS[1:]:
            self.assertAlmostEqual(self.m.parse_time(f(3725.5, mode)), 3725.5)

    def test_seed_index_wraps(self):
        self.assertEqual([self.m.pick_index(s, 3) for s in (0, 1, 3, 7)], [0, 1, 0, 1])

    def test_connected_outputs(self):
        prompt = {"5": {"inputs": {"image": ["3", 0], "x": ["9", 1]}}, "6": {"inputs": {"a": ["3", 3]}}}
        self.assertEqual(self.m.connected_outputs(prompt, "3"), {0, 3})

    def test_file_endpoint_rejects_traversal_and_non_media(self):
        (self.dir / "a.png").write_bytes(b"")
        (self.dir / "secret.txt").write_bytes(b"")
        self.assertIsNotNone(self.m._resolve_file(str(self.dir), "a.png", self.m.MEDIA_EXTENSIONS))
        self.assertIsNone(self.m._resolve_file(str(self.dir), "secret.txt", self.m.MEDIA_EXTENSIONS))
        self.assertIsNone(self.m._resolve_file(str(self.dir), "../a.png", self.m.MEDIA_EXTENSIONS))


@unittest.skipIf(av is None, "PyAV not installed")
class LoadTests(unittest.TestCase):
    def setUp(self):
        self.m = load_node()
        self.m.VideoFromFile = lambda path: ("VIDEO", path)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.dir = Path(self.temp.name)
        Image.new("RGB", (32, 16), (255, 0, 0)).save(self.dir / "01_img.png")
        (self.dir / "01_img.txt").write_text("image prompt", encoding="utf-8")
        write_video(self.dir / "02_vid.mp4", with_audio=True)
        (self.dir / "02_vid.json").write_text(json.dumps({"time": 4, "prompt": "video prompt"}), encoding="utf-8")
        write_wav(self.dir / "03_aud.wav")
        self.node = self.m.SzandorFolderMediaLoader()

    def run_node(self, seed, used=(0, 1, 2, 3, 4), media_filter="wszystko"):
        prompt = {"9": {"inputs": {f"in{i}": ["1", i] for i in used}}}
        return self.node.load(str(self.dir), seed, media_filter, 5.0, 24.0, prompt=prompt, unique_id="1")["result"]

    def test_image_item(self):
        result = self.run_node(0, used=(0, 2, 3))
        self.assertEqual(len(result), len(self.m.SzandorFolderMediaLoader.RETURN_TYPES))
        image, video, audio, prompt, time, frames, seed, name, index, count, start, end = result
        self.assertEqual(tuple(image.shape), (1, 16, 32, 3))
        self.assertIsNone(video)
        self.assertEqual(audio["sample_rate"], self.m.SILENCE_SAMPLE_RATE)
        self.assertAlmostEqual(audio["waveform"].shape[-1] / audio["sample_rate"], 5.0)
        self.assertEqual((prompt, time, frames, seed, name, index, count), ("image prompt", 5.0, 120, 0, "01_img", 0, 3))
        self.assertEqual((start, end), (0.0, 5.0))

    def test_video_item_first_frame_audio_track_and_json_time(self):
        image, video, audio, prompt, time, frames, *_ = self.run_node(4)
        self.assertEqual(tuple(image.shape), (1, 48, 64, 3))
        self.assertGreater(float(image.mean()), 0.6)  # jasna pierwsza klatka
        self.assertEqual(video[0], "VIDEO")
        self.assertEqual(audio["sample_rate"], 16000)
        self.assertEqual((prompt, time, frames), ("video prompt", 4.0, 96))

    def test_audio_item_time_from_duration(self):
        image, _, audio, prompt, time, *_ = self.run_node(2, used=(0, 2, 4))
        self.assertEqual(tuple(image.shape), (1, 64, 64, 3))
        self.assertEqual(audio["sample_rate"], 8000)
        self.assertAlmostEqual(time, 2.0, places=2)
        self.assertEqual(prompt, "")

    def test_connected_video_without_file_raises(self):
        with self.assertRaisesRegex(ValueError, "nie ma pliku wideo"):
            self.run_node(0)

    def test_time_output_as_text(self):
        (self.dir / "01_img.json").write_text(json.dumps({"start_time": 2, "end_time": 7.5}), encoding="utf-8")
        result = self.node.load(str(self.dir), 0, "wszystko", 5.0, 24.0, "tekst: mm:ss.mmm",
                                prompt={}, unique_id="1")["result"]
        self.assertEqual((result[4], result[5], result[10], result[11]), ("00:05.500", 132, "00:02.000", "00:07.500"))
        self.assertIn("STRING", self.m.SzandorFolderMediaLoader.RETURN_TYPES[4].split(","))

    def test_filter_changes_count(self):
        *_, name, index, count, _start, _end = self.run_node(0, media_filter="wideo")
        self.assertEqual((name, index, count), ("02_vid", 0, 1))

    def test_validate_and_is_changed(self):
        cls = self.m.SzandorFolderMediaLoader
        self.assertTrue(cls.VALIDATE_INPUTS(str(self.dir), "wszystko"))
        self.assertIn("nie istnieje", cls.VALIDATE_INPUTS(str(self.dir / "missing"), "wszystko"))
        a = cls.IS_CHANGED(str(self.dir), 0, "wszystko", 5.0, 24.0)
        self.assertNotEqual(a, cls.IS_CHANGED(str(self.dir), 1, "wszystko", 5.0, 24.0))
        self.assertEqual(a, cls.IS_CHANGED(str(self.dir), 0, "wszystko", 5.0, 24.0))


@unittest.skipIf(av is None, "PyAV not installed")
class SaveAsSourceTests(unittest.TestCase):
    def setUp(self):
        self.m = load_node()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name)
        self.node = self.m.SzandorSaveAsSource()

    def save(self, name="ujecie01", on_exists="numeruj", **kw):
        return self.node.save(name, kw.pop("enabled", True), str(self.out), kw.pop("suffix", ""),
                              on_exists, kw.pop("image_format", "png"), **kw)["result"][0]

    def test_disabled_writes_nothing(self):
        self.assertEqual(self.save(enabled=False, prompt="x"), "")
        self.assertEqual(list(self.out.iterdir()), [])

    def test_image_audio_and_json_share_name(self):
        image = torch.rand((1, 8, 12, 3))
        audio = {"waveform": torch.zeros((1, 2, 800)), "sample_rate": 8000}
        paths = self.save(image=image, audio=audio, prompt="p", time=4.5).splitlines()
        self.assertEqual(sorted(Path(p).name for p in paths), ["ujecie01.json", "ujecie01.png", "ujecie01.wav"])
        self.assertEqual(json.loads((self.out / "ujecie01.json").read_text()), {"time": 4.5, "prompt": "p"})
        loaded = self.m.load_audio(str(self.out / "ujecie01.wav"))
        self.assertEqual((loaded["sample_rate"], tuple(loaded["waveform"].shape)), (8000, (1, 2, 800)))
        with Image.open(self.out / "ujecie01.png") as img:
            self.assertEqual(img.size, (12, 8))

    def test_json_includes_only_connected_times(self):
        self.save("r", prompt="p", start_time=1.0, end_time=3.5)
        self.assertEqual(json.loads((self.out / "r.json").read_text()),
                         {"start_time": 1.0, "end_time": 3.5, "prompt": "p"})

    def test_json_accepts_text_times(self):
        self.save("t", prompt="p", time="00:05.500", start_time="2")
        self.assertEqual(json.loads((self.out / "t.json").read_text()), {"time": 5.5, "start_time": 2.0, "prompt": "p"})
        with self.assertRaisesRegex(ValueError, "end_time"):
            self.save("u", prompt="p", end_time="abc")

    def test_collisions_number_the_whole_set_or_skip(self):
        (self.out / "a.txt").write_text("old")
        image = torch.rand((1, 4, 4, 3))
        paths = self.save("a", image=image, prompt="new").splitlines()
        self.assertEqual(sorted(Path(p).name for p in paths), ["a_2.png", "a_2.txt"])
        self.assertEqual(self.save("a", on_exists="pomiń", prompt="x"), "")
        self.save("a", on_exists="nadpisz", prompt="over")
        self.assertEqual((self.out / "a.txt").read_text(), "over")

    def test_batch_suffix_and_unsafe_name(self):
        paths = self.save("../x.png", suffix="_gen", image=torch.rand((2, 4, 4, 3)), image_format="jpg")
        self.assertEqual(sorted(Path(p).name for p in paths.splitlines()), ["x_gen_0001.jpg", "x_gen_0002.jpg"])
        self.assertTrue(all(Path(p).parent == self.out for p in paths.splitlines()))

    def test_video_uses_save_to(self):
        saved = []
        video = SimpleNamespace(save_to=lambda path: (saved.append(path), Path(path).write_bytes(b"v")))
        self.save("clip", video=video)
        self.assertEqual([Path(p).name for p in saved], ["clip.mp4"])


if __name__ == "__main__":
    unittest.main()
