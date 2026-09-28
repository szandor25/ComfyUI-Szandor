"""Folder Media Loader: wczytuje obraz / wideo / audio z katalogu razem z promptem
(plik .txt lub .json o tej samej nazwie) i czasem trwania.

Pozycją w folderze steruje ``seed`` (indeks = seed mod liczba pozycji), więc
standardowe ``control_after_generate`` (fixed / increment / decrement / randomize)
przechodzi kolejno lub losowo po plikach.
"""
import hashlib
import io
import json
import math
import os
import re

import numpy as np
import torch
from PIL import Image, ImageOps
from aiohttp import web
from server import PromptServer

try:
    import folder_paths
except ImportError:  # testy bez ComfyUI
    folder_paths = None

try:
    import av
except ImportError:  # PyAV jest zależnością ComfyUI; bez niego działa tylko obraz i tekst.
    av = None

try:
    from comfy_api.latest import InputImpl
    VideoFromFile = InputImpl.VideoFromFile
except Exception:  # starsze ComfyUI
    try:
        from comfy_api.input_impl import VideoFromFile
    except Exception:
        VideoFromFile = None

IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff")
VIDEO_EXTENSIONS = (".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v", ".gifv")
AUDIO_EXTENSIONS = (".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".opus")
PROMPT_EXTENSIONS = (".txt", ".json")
MEDIA_EXTENSIONS = IMAGE_EXTENSIONS + VIDEO_EXTENSIONS + AUDIO_EXTENSIONS

FILTERS = ["wszystko", "obrazy", "wideo", "audio", "tylko z promptem"]
PREVIEW_MAX_SIDE = 768
SILENCE_SAMPLE_RATE = 44100

JSON_TIME_KEYS = ("time", "duration", "seconds", "czas")
JSON_START_KEYS = ("start_time", "start", "time_start")
JSON_END_KEYS = ("end_time", "end", "time_end")
JSON_PROMPT_KEYS = ("prompt", "text", "positive")

# Typ wyjść time / start_time / end_time zależy od przełącznika time_output: backend deklaruje
# typ łączony (pasuje do wejść FLOAT i STRING), a widżet w przeglądarce zawęża go do jednego.
TIME_OUTPUT_TYPE = "FLOAT,STRING"
TIME_OUTPUTS = ["liczba", "tekst: sekundy", "tekst: mm:ss.mmm", "tekst: hh:mm:ss.mmm"]

# Wyjścia (indeksy muszą zgadzać się z RETURN_TYPES).
OUT_IMAGE, OUT_VIDEO, OUT_AUDIO = 0, 1, 2


def _natural_key(name):
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", name)]


def _kind(filename):
    ext = os.path.splitext(filename)[1].lower()
    if ext in IMAGE_EXTENSIONS:
        return "image"
    if ext in VIDEO_EXTENSIONS:
        return "video"
    if ext in AUDIO_EXTENSIONS:
        return "audio"
    if ext == ".txt":
        return "txt"
    if ext == ".json":
        return "json"
    return None


def scan_directory(directory):
    """Grupuje pliki po nazwie bez rozszerzenia. Pozycją jest każda nazwa z plikiem mediów
    albo promptem; przy kilku plikach tego samego rodzaju wygrywa pierwszy alfabetycznie."""
    if not directory or not os.path.isdir(directory):
        return []
    try:
        names = sorted(os.listdir(directory), key=_natural_key)
    except OSError:
        return []
    groups = {}
    for filename in names:
        kind = _kind(filename)
        if kind is None or not os.path.isfile(os.path.join(directory, filename)):
            continue
        stem = os.path.splitext(filename)[0]
        groups.setdefault(stem, {"name": stem}).setdefault(kind, filename)
    return [groups[stem] for stem in sorted(groups, key=_natural_key)]


def filter_items(items, media_filter):
    if media_filter == "obrazy":
        return [i for i in items if "image" in i]
    if media_filter == "wideo":
        return [i for i in items if "video" in i]
    if media_filter == "audio":
        return [i for i in items if "audio" in i]
    if media_filter == "tylko z promptem":
        return [i for i in items if "txt" in i or "json" in i]
    return items


def items_signature(directory, items):
    h = hashlib.sha1()
    for item in items:
        for kind in ("image", "video", "audio", "txt", "json"):
            filename = item.get(kind)
            if not filename:
                continue
            try:
                stat = os.stat(os.path.join(directory, filename))
                stamp = f"{stat.st_mtime_ns}:{stat.st_size}"
            except OSError:
                stamp = "0"
            h.update(f"{filename}:{stamp};".encode("utf-8", "ignore"))
    return h.hexdigest()


def pick_index(seed, count):
    return int(seed) % count if count else -1


def parse_time(value):
    """Akceptuje liczbę sekund, "5", "5s", "5.5 sek", "00:05", "00:01:02.5". Zwraca float lub None."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) and value >= 0 else None
    if not isinstance(value, str):
        return None
    text = value.strip().lower().replace(",", ".")
    if not text:
        return None
    if ":" in text:
        try:
            seconds = 0.0
            for part in text.split(":"):
                seconds = seconds * 60 + float(part)
            return seconds if seconds >= 0 else None
        except ValueError:
            return None
    match = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(s|sec|sek|seconds|sekund[y]?)?", text)
    return float(match.group(1)) if match else None


def format_time(seconds, mode):
    """Wartość wyjścia czasu według przełącznika time_output: float albo tekst."""
    if mode not in TIME_OUTPUTS[1:]:
        return float(seconds)
    millis = int(round(float(seconds) * 1000))
    sign = "-" if millis < 0 else ""
    millis = abs(millis)
    if mode == "tekst: sekundy":
        text = f"{millis // 1000}.{millis % 1000:03d}".rstrip("0").rstrip(".")
        return sign + text
    whole, ms = divmod(millis, 1000)
    if mode == "tekst: mm:ss.mmm":
        minutes, secs = divmod(whole, 60)
        return f"{sign}{minutes:02d}:{secs:02d}.{ms:03d}"
    hours, rest = divmod(whole, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{sign}{hours:02d}:{minutes:02d}:{secs:02d}.{ms:03d}"


def _read_text(path):
    with open(path, "r", encoding="utf-8-sig") as f:
        return f.read()


def read_prompt(directory, item):
    """Zwraca (prompt, czasy_z_json, ostrzeżenie | None). Czasy to słownik z kluczami
    time / start_time / end_time; brak pola w JSON daje None. Prompt z JSON ma
    pierwszeństwo przed .txt; pusty prompt w JSON używa pliku .txt."""
    prompt = ""
    times = {"time": None, "start_time": None, "end_time": None}
    if "txt" in item:
        prompt = _read_text(os.path.join(directory, item["txt"]))
    if "json" not in item:
        return prompt, times, None
    try:
        data = json.loads(_read_text(os.path.join(directory, item["json"])))
    except (OSError, ValueError) as exc:
        return prompt, times, f"Niepoprawny JSON {item['json']}: {exc}"
    if not isinstance(data, dict):
        return prompt, times, f"{item['json']}: oczekiwano obiektu {{\"time\": …, \"prompt\": …}}"
    for key in JSON_PROMPT_KEYS:
        if isinstance(data.get(key), str) and data[key].strip():
            prompt = data[key]
            break
    warnings = []
    for field, keys in (("time", JSON_TIME_KEYS), ("start_time", JSON_START_KEYS), ("end_time", JSON_END_KEYS)):
        key = next((k for k in keys if k in data and data[k] is not None), None)
        if key is None:
            continue
        times[field] = parse_time(data[key])
        if times[field] is None:
            warnings.append(f"nie rozpoznano {key} {data[key]!r}")
    warning = f"{item['json']}: " + "; ".join(warnings) if warnings else None
    return prompt, times, warning


def media_duration(path):
    if av is None:
        return None
    try:
        with av.open(path) as container:
            if container.duration:
                return container.duration / 1_000_000
            for stream in list(container.streams.video) + list(container.streams.audio):
                if stream.duration and stream.time_base:
                    return float(stream.duration * stream.time_base)
    except Exception:
        return None
    return None


def resolve_item(directory, item, default_time):
    """Czas: JSON time → JSON end_time − start_time → długość wideo → długość audio → default_time.
    start_time / end_time są opcjonalne: brak start_time daje 0, brak end_time daje start_time + time."""
    prompt, times, warning = read_prompt(directory, item)
    start, end = times["start_time"], times["end_time"]
    time_value, source = times["time"], "json"
    if time_value is None and start is not None and end is not None and end >= start:
        time_value, source = end - start, "json end−start"
    if time_value is None:
        for kind in ("video", "audio"):
            if kind in item:
                time_value = media_duration(os.path.join(directory, item[kind]))
                if time_value is not None:
                    source = kind
                    break
    if time_value is None:
        time_value, source = float(default_time), "domyślny"
    time_value = float(time_value)
    start_time = float(start) if start is not None else 0.0
    end_time = float(end) if end is not None else start_time + time_value
    if end_time < start_time:
        note = f"end_time ({end_time}) jest mniejszy niż start_time ({start_time})"
        warning = f"{warning}; {note}" if warning else f"{item.get('json', item['name'])}: {note}"
    return {
        "prompt": prompt, "time": time_value, "time_source": source,
        "start_time": start_time, "end_time": end_time,
        "range_in_json": start is not None or end is not None,
        "warning": warning,
    }


def _pil_to_tensor(img):
    img = ImageOps.exif_transpose(img)
    if img.mode == "I":
        img = img.point(lambda i: i * (1 / 255))
    arr = np.array(img.convert("RGB")).astype(np.float32) / 255.0
    return torch.from_numpy(arr)[None,]


def first_video_frame(path):
    """Pierwsza klatka jako PIL.Image (z uwzględnieniem obrotu)."""
    if av is None:
        raise RuntimeError("Brak PyAV — nie można odczytać wideo.")
    with av.open(path) as container:
        if not container.streams.video:
            raise ValueError(f"Plik nie zawiera ścieżki wideo: {path}")
        for frame in container.decode(video=0):
            img = frame.to_image()
            rotation = getattr(frame, "rotation", 0) or 0
            if rotation:
                img = img.rotate(rotation, expand=True)
            return img
    raise ValueError(f"Nie udało się odczytać klatki z: {path}")


def load_audio(path):
    """Zwraca AUDIO ComfyUI albo None, jeśli plik nie ma ścieżki audio."""
    if av is None:
        raise RuntimeError("Brak PyAV — nie można odczytać audio.")
    with av.open(path) as container:
        if not container.streams.audio:
            return None
        stream = container.streams.audio[0]
        channels = stream.channels
        chunks = []
        for frame in container.decode(stream):
            buf = torch.from_numpy(frame.to_ndarray())
            if buf.shape[0] != channels:
                buf = buf.reshape(-1, channels).t()
            chunks.append(buf)
        if not chunks:
            return None
        wav = torch.cat(chunks, dim=1)
        if not wav.dtype.is_floating_point:
            wav = wav.float() / float(torch.iinfo(wav.dtype).max + 1)
        return {"waveform": wav.float().unsqueeze(0), "sample_rate": stream.codec_context.sample_rate}


def silence(seconds):
    samples = max(1, int(round(seconds * SILENCE_SAMPLE_RATE)))
    return {"waveform": torch.zeros((1, 1, samples)), "sample_rate": SILENCE_SAMPLE_RATE}


def connected_outputs(prompt, unique_id):
    """Indeksy wyjść tego noda, które są do czegoś podłączone w bieżącym zadaniu."""
    used = set()
    if not isinstance(prompt, dict) or unique_id is None:
        return used
    uid = str(unique_id)
    for node in prompt.values():
        for value in (node.get("inputs") or {}).values() if isinstance(node, dict) else ():
            if isinstance(value, list) and len(value) == 2 and str(value[0]) == uid:
                used.add(value[1])
    return used


def _resolve_file(directory, filename, extensions):
    """Bezpieczna ścieżka do pliku bezpośrednio w katalogu (bez podkatalogów)."""
    if not directory or not filename or not filename.lower().endswith(extensions):
        return None
    base = os.path.abspath(directory)
    candidate = os.path.abspath(os.path.join(base, filename))
    if os.path.dirname(candidate) != base or not os.path.isfile(candidate):
        return None
    return candidate


def _find_item(directory, name):
    return next((i for i in scan_directory(directory) if i["name"] == name), None)


# ─── API dla widżetu ──────────────────────────────────────────────────────────

@PromptServer.instance.routes.get("/szandor/folder-media/list")
async def szandor_folder_media_list(request):
    directory = (request.query.get("directory") or "").strip()
    media_filter = request.query.get("filter") or FILTERS[0]
    exists = bool(directory) and os.path.isdir(directory)
    items = filter_items(scan_directory(directory), media_filter) if exists else []
    return web.json_response({
        "exists": exists,
        "items": items,
        "signature": items_signature(directory, items) if exists else "",
    })


@PromptServer.instance.routes.get("/szandor/folder-media/info")
async def szandor_folder_media_info(request):
    directory = (request.query.get("directory") or "").strip()
    name = request.query.get("name") or ""
    try:
        default_time = float(request.query.get("default_time") or 5)
    except ValueError:
        default_time = 5.0
    item = _find_item(directory, name)
    if item is None:
        raise web.HTTPNotFound(text="Nie znaleziono pozycji w katalogu.")
    try:
        info = resolve_item(directory, item, default_time)
    except (OSError, UnicodeDecodeError) as exc:
        info = {"prompt": "", "time": default_time, "time_source": "domyślny", "start_time": 0.0,
                "end_time": default_time, "range_in_json": False, "warning": str(exc)}
    return web.json_response({**info, "item": item})


@PromptServer.instance.routes.get("/szandor/folder-media/preview")
async def szandor_folder_media_preview(request):
    """JPEG z obrazem lub pierwszą klatką wideo, pomniejszony do PREVIEW_MAX_SIDE."""
    directory = (request.query.get("directory") or "").strip()
    item = _find_item(directory, request.query.get("name") or "")
    if item is None or not ("image" in item or "video" in item):
        raise web.HTTPNotFound(text="Brak obrazu do podglądu.")
    try:
        if "image" in item:
            with Image.open(os.path.join(directory, item["image"])) as src:
                img = ImageOps.exif_transpose(src)
                img.load()
        else:
            img = first_video_frame(os.path.join(directory, item["video"]))
        width, height = img.size
        img = img.convert("RGB")
        img.thumbnail((PREVIEW_MAX_SIDE, PREVIEW_MAX_SIDE))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
    except Exception as exc:
        raise web.HTTPUnprocessableEntity(text=f"Nie udało się utworzyć podglądu: {exc}")
    return web.Response(body=buf.getvalue(), content_type="image/jpeg", headers={
        "Cache-Control": "no-cache",
        "X-Source-Width": str(width),
        "X-Source-Height": str(height),
    })


@PromptServer.instance.routes.get("/szandor/folder-media/file")
async def szandor_folder_media_file(request):
    """Surowy plik audio (do odsłuchu w nodzie). Tylko pliki mediów z tego katalogu."""
    directory = (request.query.get("directory") or "").strip()
    path = _resolve_file(directory, request.query.get("filename") or "", MEDIA_EXTENSIONS)
    if path is None:
        raise web.HTTPNotFound(text="Nie znaleziono pliku w katalogu.")
    return web.FileResponse(path=path, headers={"Cache-Control": "no-cache"})


# ─── node ─────────────────────────────────────────────────────────────────────

class SzandorFolderMediaLoader:
    """Wczytuje obraz / wideo / audio + prompt (.txt / .json) i czas z wybranego katalogu."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "directory": ("STRING", {"default": ""}),
                "seed": ("INT", {
                    "default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF, "control_after_generate": True,
                    "tooltip": "Wybiera pozycję w folderze: indeks = seed mod liczba pozycji. "
                               "increment/decrement przechodzi po kolei, randomize losuje.",
                }),
                "media_filter": (FILTERS, {"default": FILTERS[0], "tooltip": "Które pozycje brać pod uwagę."}),
                "default_time": ("FLOAT", {
                    "default": 5.0, "min": 0.0, "max": 3600.0, "step": 0.1,
                    "tooltip": "Czas, gdy brak JSON z polem time oraz wideo/audio z długością.",
                }),
                "fps": ("FLOAT", {
                    "default": 24.0, "min": 1.0, "max": 240.0, "step": 1.0,
                    "tooltip": "Służy tylko do wyliczenia wyjścia frames = round(time × fps).",
                }),
                "time_output": (TIME_OUTPUTS, {
                    "default": TIME_OUTPUTS[0],
                    "tooltip": "Typ wyjść time, start_time i end_time: liczba (FLOAT, sekundy) albo tekst "
                               "(STRING): \"5.5\", \"00:05.500\" lub \"00:00:05.500\".",
                }),
            },
            "hidden": {"prompt": "PROMPT", "unique_id": "UNIQUE_ID"},
        }

    # Nowe wyjścia dopisujemy na końcu, żeby nie przesuwać połączeń w zapisanych workflow.
    RETURN_TYPES = ("IMAGE", "VIDEO", "AUDIO", "STRING", TIME_OUTPUT_TYPE, "INT", "INT", "STRING", "INT", "INT",
                    TIME_OUTPUT_TYPE, TIME_OUTPUT_TYPE)
    RETURN_NAMES = ("image", "video", "audio", "prompt", "time", "frames", "seed", "filename", "index", "count",
                    "start_time", "end_time")
    OUTPUT_TOOLTIPS = (
        "Obraz lub pierwsza klatka wideo (czarny 64×64, gdy pozycja ma tylko audio/prompt).",
        "Wideo z pliku; błąd, jeśli podłączone, a pozycja nie ma wideo.",
        "Plik audio o tej samej nazwie, w przeciwnym razie ścieżka audio z wideo, a na końcu cisza o długości time.",
        "Prompt z .json (pole prompt) lub z .txt.",
        "Czas (liczba lub tekst wg time_output): JSON time → JSON end_time − start_time → długość wideo → długość audio → default_time.",
        "round(time × fps).",
        "Użyty seed.",
        "Nazwa pozycji (bez rozszerzenia).",
        "Indeks pozycji (od 0).",
        "Liczba pozycji po filtrze.",
        "start_time z JSON (opcjonalny); gdy brak — 0. Liczba lub tekst wg time_output.",
        "end_time z JSON (opcjonalny); gdy brak — start_time + time. Liczba lub tekst wg time_output.",
    )
    FUNCTION = "load"
    CATEGORY = "Moje Nody/Image"

    def load(self, directory, seed, media_filter, default_time, fps, time_output=TIME_OUTPUTS[0],
             prompt=None, unique_id=None):
        directory = (directory or "").strip()
        items = filter_items(scan_directory(directory), media_filter)
        if not items:
            raise FileNotFoundError(f"Brak pasujących plików ({media_filter}) w katalogu: {directory}")
        index = pick_index(seed, len(items))
        item = items[index]
        info = resolve_item(directory, item, default_time)
        if info["warning"]:
            print(f"[Szandor Folder Media] {info['warning']}")
        used = connected_outputs(prompt, unique_id)
        path = {k: os.path.join(directory, item[k]) for k in ("image", "video", "audio") if k in item}

        if "image" in path:
            with Image.open(path["image"]) as img:
                image = _pil_to_tensor(img)
        elif "video" in path and (OUT_IMAGE in used or not used):
            image = _pil_to_tensor(first_video_frame(path["video"]))
        else:
            image = torch.zeros((1, 64, 64, 3), dtype=torch.float32)

        video = None
        if "video" in path:
            if VideoFromFile is None:
                raise RuntimeError("Ta wersja ComfyUI nie obsługuje typu VIDEO.")
            video = VideoFromFile(path["video"])
        elif OUT_VIDEO in used:
            raise ValueError(f"Pozycja '{item['name']}' nie ma pliku wideo, a wyjście video jest podłączone. "
                             "Ustaw media_filter = wideo albo odłącz wyjście.")

        audio = None
        if OUT_AUDIO in used:
            source = path.get("audio") or path.get("video")
            audio = load_audio(source) if source else None
            if audio is None:
                audio = silence(info["time"])

        time_value = info["time"]
        frames = int(round(time_value * fps))
        ui = {"szandor_loaded": [{"name": item["name"], "index": index, "count": len(items),
                                  "time": time_value, "time_source": info["time_source"],
                                  "start_time": info["start_time"], "end_time": info["end_time"]}]}
        return {"ui": ui, "result": (image, video, audio, info["prompt"], format_time(time_value, time_output),
                                     frames, int(seed), item["name"], index, len(items),
                                     format_time(info["start_time"], time_output),
                                     format_time(info["end_time"], time_output))}

    @classmethod
    def IS_CHANGED(cls, directory, seed, media_filter, default_time, fps, **_):
        directory = (directory or "").strip()
        items = filter_items(scan_directory(directory), media_filter)
        if not items:
            return ""
        item = items[pick_index(seed, len(items))]
        return f"{seed}:{item['name']}:{items_signature(directory, [item])}"

    @classmethod
    def VALIDATE_INPUTS(cls, directory, media_filter):
        directory = (directory or "").strip()
        if not directory:
            return "Nie podano katalogu."
        if not os.path.isdir(directory):
            return f"Katalog nie istnieje: {directory}"
        if not filter_items(scan_directory(directory), media_filter):
            return f"Brak pasujących plików ({media_filter}) w katalogu: {directory}"
        return True


# ─── zapis wyniku pod nazwą źródła ──────────────────────────────────────────

ON_EXISTS = ["numeruj", "nadpisz", "pomiń"]
IMAGE_FORMATS = ["png", "jpg", "webp"]
DEFAULT_OUTPUT_SUBDIR = "szandor_folder_media"


def safe_basename(name):
    """Sama nazwa pliku, bez katalogów i znaków niedozwolonych w nazwach."""
    name = os.path.basename(str(name or "").replace("\\", "/")).strip()
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .")
    return name


def resolve_output_directory(output_directory):
    """Pusty → <output>/szandor_folder_media; względny → względem katalogu output ComfyUI."""
    output_directory = (output_directory or "").strip()
    base = folder_paths.get_output_directory() if folder_paths else os.getcwd()
    if not output_directory:
        return os.path.join(base, DEFAULT_OUTPUT_SUBDIR)
    return output_directory if os.path.isabs(output_directory) else os.path.join(base, output_directory)


def choose_stem(directory, stem, extensions, on_exists):
    """Zwraca nazwę bazową, dla której żaden z plików (stem + ext) nie koliduje,
    tak by komplet (obraz / wideo / audio / prompt) miał zawsze tę samą nazwę.
    None oznacza pominięcie zapisu."""
    def taken(candidate):
        return any(os.path.exists(os.path.join(directory, candidate + ext)) for ext in extensions)

    if on_exists == "nadpisz" or not taken(stem):
        return stem
    if on_exists == "pomiń":
        return None
    counter = 2
    while taken(f"{stem}_{counter}"):
        counter += 1
    return f"{stem}_{counter}"


def save_audio_wav(audio, path):
    """AUDIO ComfyUI → 16-bit WAV (mono lub stereo; więcej kanałów przycinane do dwóch)."""
    waveform = audio["waveform"]
    if waveform.dim() == 3:
        waveform = waveform[0]
    waveform = waveform[:2]
    rate = int(audio["sample_rate"])
    samples = (waveform.clamp(-1, 1) * 32767).to(torch.int16).cpu().numpy()
    layout = "stereo" if samples.shape[0] == 2 else "mono"
    with av.open(path, "w", format="wav") as container:
        stream = container.add_stream("pcm_s16le", rate=rate, layout=layout)
        # Format "s16" jest przeplatany: jeden wiersz z próbkami L R L R …
        frame = av.AudioFrame.from_ndarray(samples.T.reshape(1, -1), format="s16", layout=layout)
        frame.sample_rate = rate
        for packet in stream.encode(frame):
            container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


class SzandorSaveAsSource:
    """Zapisuje wynik pod nazwą pozycji z Folder Media Loadera (np. ujecie01.png / .mp4 / .wav / .txt)."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "filename": ("STRING", {"forceInput": True,
                                        "tooltip": "Podłącz wyjście filename z Folder Media + Prompt Loader."}),
                "enabled": ("BOOLEAN", {"default": True, "label_on": "zapisuj", "label_off": "wyłączony",
                                        "tooltip": "Wyłączony node niczego nie zapisuje."}),
                "output_directory": ("STRING", {"default": "",
                                                "tooltip": "Pusty: ComfyUI/output/szandor_folder_media. "
                                                           "Ścieżka względna liczona od ComfyUI/output."}),
                "suffix": ("STRING", {"default": "", "tooltip": "Dopisywany do nazwy, np. _gen → ujecie01_gen.png"}),
                "on_exists": (ON_EXISTS, {"default": "numeruj",
                                          "tooltip": "Gdy plik istnieje: numeruj (_2, _3…), nadpisz lub pomiń zapis."}),
                "image_format": (IMAGE_FORMATS, {"default": "png"}),
            },
            "optional": {
                "image": ("IMAGE",),
                "video": ("VIDEO",),
                "audio": ("AUDIO",),
                "prompt": ("STRING", {"forceInput": True, "tooltip": "Zapisywany jako .txt (lub .json z time)."}),
                "time": (TIME_OUTPUT_TYPE, {"forceInput": True, "tooltip": "Z promptem daje .json {time, prompt}. Liczba sekund albo tekst (np. 00:05.5)."}),
                "start_time": (TIME_OUTPUT_TYPE, {"forceInput": True, "tooltip": "Opcjonalnie dopisywany do .json. Liczba sekund albo tekst (np. 00:05.5)."}),
                "end_time": (TIME_OUTPUT_TYPE, {"forceInput": True, "tooltip": "Opcjonalnie dopisywany do .json. Liczba sekund albo tekst (np. 00:05.5)."}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("saved_paths",)
    OUTPUT_NODE = True
    FUNCTION = "save"
    CATEGORY = "Moje Nody/Image"

    def save(self, filename, enabled, output_directory, suffix, on_exists, image_format,
             image=None, video=None, audio=None, prompt=None, time=None, start_time=None, end_time=None):
        timing = {}
        for key, value in (("time", time), ("start_time", start_time), ("end_time", end_time)):
            if value is None:
                continue
            seconds = parse_time(value)
            if seconds is None:
                raise ValueError(f"Nie rozpoznano wartości {key}: {value!r}")
            timing[key] = seconds
        if not enabled:
            return {"ui": {"text": ["Zapis wyłączony"]}, "result": ("",)}
        stem = safe_basename(filename)
        if stem.lower().endswith(MEDIA_EXTENSIONS + PROMPT_EXTENSIONS):
            stem = os.path.splitext(stem)[0]
        stem = safe_basename(stem + (suffix or ""))
        if not stem:
            raise ValueError("Brak nazwy pliku do zapisu — podłącz wyjście filename z loadera.")
        if all(x is None for x in (image, video, audio, prompt)):
            raise ValueError("Nic do zapisania — podłącz image, video, audio lub prompt.")

        directory = resolve_output_directory(output_directory)
        os.makedirs(directory, exist_ok=True)

        batch = image.shape[0] if image is not None else 0
        ext_image = "." + image_format
        extensions = []
        if batch == 1:
            extensions.append(ext_image)
        elif batch > 1:
            extensions += [f"_{i + 1:04d}{ext_image}" for i in range(batch)]
        if video is not None:
            extensions.append(".mp4")
        if audio is not None:
            extensions.append(".wav")
        if prompt is not None:
            extensions.append(".json" if timing else ".txt")

        final = choose_stem(directory, stem, extensions, on_exists)
        if final is None:
            message = f"Pominięto — {stem} już istnieje w {directory}"
            print(f"[Szandor Save As Source] {message}")
            return {"ui": {"text": [message]}, "result": ("",)}

        saved = []
        if batch:
            for i in range(batch):
                arr = np.clip(image[i].cpu().numpy() * 255.0, 0, 255).astype(np.uint8)
                name = final + (ext_image if batch == 1 else f"_{i + 1:04d}{ext_image}")
                path = os.path.join(directory, name)
                img = Image.fromarray(arr)
                if image_format == "png":
                    img.save(path, compress_level=4)
                else:
                    img.save(path, quality=95)
                saved.append(path)
        if video is not None:
            path = os.path.join(directory, final + ".mp4")
            video.save_to(path)
            saved.append(path)
        if audio is not None:
            path = os.path.join(directory, final + ".wav")
            save_audio_wav(audio, path)
            saved.append(path)
        if prompt is not None:
            if timing:
                path = os.path.join(directory, final + ".json")
                with open(path, "w", encoding="utf-8") as f:
                    json.dump({**timing, "prompt": prompt}, f, ensure_ascii=False, indent=2)
            else:
                path = os.path.join(directory, final + ".txt")
                with open(path, "w", encoding="utf-8") as f:
                    f.write(prompt)
            saved.append(path)

        return {"ui": {"text": [f"Zapisano: {os.path.basename(p)}" for p in saved]}, "result": ("\n".join(saved),)}


NODE_CLASS_MAPPINGS = {
    "SzandorFolderMediaLoader": SzandorFolderMediaLoader,
    "SzandorSaveAsSource": SzandorSaveAsSource,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "SzandorFolderMediaLoader": "Folder Media + Prompt Loader (Szandor)",
    "SzandorSaveAsSource": "Save As Source Name (Szandor)",
}
