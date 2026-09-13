"""Local H3 template snapshots with independent copies of source images."""

import copy
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import tempfile
import uuid

from PIL import Image


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff", ".avif"}
MAX_IMAGE_BYTES = 128 * 1024 * 1024
MAX_TOTAL_BYTES = 512 * 1024 * 1024


class TemplateStore:
    def __init__(self, root, input_dir, output_dir, temp_dir):
        self.root = Path(root)
        self.input_dir = Path(input_dir)
        self.sources = {"input": self.input_dir, "output": Path(output_dir), "temp": Path(temp_dir)}

    def directory(self, template_id):
        if not isinstance(template_id, str) or not re.fullmatch(r"[0-9a-f]{32}", template_id):
            raise ValueError("Nieprawidłowy identyfikator szablonu.")
        return self.root / template_id

    def read(self, template_id):
        data = json.loads((self.directory(template_id) / "template.json").read_text(encoding="utf-8"))
        if data.get("version") != 1:
            raise ValueError("Nieobsługiwana wersja szablonu.")
        return data

    def delete(self, template_id):
        directory = self.directory(template_id)
        if directory.is_symlink():
            raise ValueError("Katalog szablonu nie może być dowiązaniem symbolicznym.")
        self.read(template_id)
        # Keep original sources and restored input copies: existing workflows
        # may still use them after the library entry has been removed.
        shutil.rmtree(directory)
        return {"deleted": template_id}

    @staticmethod
    def summary(data):
        return {key: data[key] for key in ("id", "name", "created_at", "duration", "notes", "images")}

    def list(self):
        if not self.root.exists():
            return []
        result = []
        for folder in self.root.iterdir():
            if not re.fullmatch(r"[0-9a-f]{32}", folder.name):
                continue
            try:
                result.append(self.summary(self.read(folder.name)))
            except (OSError, ValueError, KeyError):
                continue
        return sorted(result, key=lambda item: item["created_at"], reverse=True)

    @staticmethod
    def target(workflow, ref):
        node = next((node for node in workflow["nodes"] if str(node["id"]) == str(ref["node_id"])), None)
        index = ref["widget_index"]
        if node is None or type(index) is not int or not 0 <= index < len(node.get("widgets_values", [])):
            raise ValueError("Nie można odnaleźć pola obrazu w workflow.")
        return node, index

    def source(self, workflow, ref):
        node, index = self.target(workflow, ref)
        value = node["widgets_values"][index]
        if not isinstance(value, str) or not value:
            raise ValueError("Puste pole obrazu w workflow.")
        if node["type"] == "SzandorDirectoryImageLoader":
            directory_index = ref.get("directory_index")
            if type(directory_index) is not int or not 0 <= directory_index < len(node["widgets_values"]):
                raise ValueError("Nieprawidłowe pole katalogu obrazu.")
            base = Path(node["widgets_values"][directory_index]).expanduser().resolve()
            filename = value
        else:
            filename = value
            kind = "input"
            match = re.search(r"\s*\[(input|output|temp)\]$", filename)
            if match:
                kind = match[1]
                filename = filename[:match.start()]
            base = self.sources[kind].resolve()
        path = (base / filename).resolve()
        if not path.is_relative_to(base) or path.suffix.lower() not in IMAGE_EXTENSIONS:
            raise ValueError(f"Nieobsługiwana ścieżka obrazu: {value}")
        return path

    def save(self, payload):
        name = payload.get("name", "")
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 160:
            raise ValueError("Podaj nazwę szablonu (do 160 znaków).")
        name = name.strip()
        prompt = payload.get("prompt")
        workflow = payload.get("workflow")
        if not isinstance(prompt, str) or not isinstance(workflow, dict) or not isinstance(workflow.get("nodes"), list):
            raise ValueError("Brakuje promptu lub pełnego workflow.")
        duration = payload.get("duration")
        if duration is not None and (type(duration) not in (int, float) or not math.isfinite(duration) or duration <= 0):
            raise ValueError("Czas trwania musi być dodatnią liczbą sekund lub pustym polem.")
        notes = payload.get("notes", "")
        if not isinstance(notes, str) or len(notes) > 10000:
            raise ValueError("Notatka jest zbyt długa.")
        refs = payload.get("images", [])
        if not isinstance(refs, list) or len(refs) > 512:
            raise ValueError("Zbyt wiele obrazów w szablonie.")
        editor_id = payload.get("editor_id")
        editor = next((n for n in workflow["nodes"] if str(n["id"]) == str(editor_id)), None)
        if not editor or editor.get("type") != "SzandorMiniMaxH3Prompt" or prompt not in editor.get("widgets_values", []):
            raise ValueError("Prompt szablonu nie zgadza się z edytorem w workflow.")

        self.root.mkdir(parents=True, exist_ok=True)
        template_id = uuid.uuid4().hex
        stage = Path(tempfile.mkdtemp(prefix=".saving-", dir=self.root))
        try:
            (stage / "images").mkdir()
            images = []
            total = 0
            for ref in refs:
                path = self.source(workflow, ref)
                with path.open("rb") as stream:
                    raw = stream.read(MAX_IMAGE_BYTES + 1)
                total += len(raw)
                if len(raw) > MAX_IMAGE_BYTES or total > MAX_TOTAL_BYTES:
                    raise ValueError("Przekroczono limit: 128 MB na obraz lub 512 MB na szablon.")
                digest = hashlib.sha256(raw).hexdigest()
                filename = digest + path.suffix.lower()
                dest = stage / "images" / filename
                dest.write_bytes(raw)
                with Image.open(dest) as image:
                    image.verify()
                images.append({
                    "node_id": ref["node_id"], "widget_index": ref["widget_index"],
                    "directory_index": ref.get("directory_index"), "file": filename,
                    "original_name": path.name, "sha256": digest,
                    "label": str(ref.get("label", path.name))[:300],
                })
            data = {
                "version": 1, "id": template_id, "name": name,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "prompt": prompt, "editor_id": editor_id, "workflow": workflow,
                "duration": duration, "notes": notes, "images": images,
            }
            (stage / "template.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            stage.rename(self.directory(template_id))
            return self.summary(data)
        finally:
            if stage.exists():
                shutil.rmtree(stage)

    def image_path(self, template_id, filename):
        data = self.read(template_id)
        if not any(image["file"] == filename for image in data["images"]):
            raise ValueError("Obraz nie należy do tego szablonu.")
        if Path(filename).name != filename:
            raise ValueError("Nieprawidłowa nazwa pliku.")
        return self.directory(template_id) / "images" / filename

    def restore(self, template_id):
        data = self.read(template_id)
        workflow = copy.deepcopy(data["workflow"])
        # Check all copies before touching the input directory or workflow.
        for ref in data["images"]:
            source = self.image_path(template_id, ref["file"])
            if hashlib.sha256(source.read_bytes()).hexdigest() != ref["sha256"]:
                raise ValueError(f"Uszkodzona kopia obrazu: {ref['original_name']}")
            self.target(workflow, ref)
        relative = Path("szandor_h3_templates") / template_id
        target = self.input_dir / relative
        if data["images"]:
            target.mkdir(parents=True, exist_ok=True)
        for ref in data["images"]:
            source = self.image_path(template_id, ref["file"])
            dest = target / ref["file"]
            # These content-addressed filenames belong to the template only.
            with tempfile.NamedTemporaryFile(dir=target, delete=False) as stream:
                stage = Path(stream.name)
                try:
                    stream.write(source.read_bytes())
                    stream.flush()
                    stage.replace(dest)
                finally:
                    stage.unlink(missing_ok=True)
            node, index = self.target(workflow, ref)
            if node["type"] == "SzandorDirectoryImageLoader":
                node["widgets_values"][ref["directory_index"]] = str(target.resolve())
                node["widgets_values"][index] = ref["file"]
            else:
                node["widgets_values"][index] = (relative / ref["file"]).as_posix()
        return {"workflow": workflow, "prompt": data["prompt"], "duration": data["duration"]}
