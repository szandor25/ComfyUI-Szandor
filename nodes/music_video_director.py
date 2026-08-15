import hashlib
import json
import logging
import os
from fractions import Fraction

import torch

import folder_paths
from comfy_api.latest import IO, InputImpl, VideoComponents
from comfy_api_nodes.apis.minimax import (
    Hailuo03ImageContent,
    Hailuo03ImageContentUrl,
    Hailuo03TaskCreationRequest,
    Hailuo03TaskCreationResponse,
    Hailuo03TaskQueryResponse,
    Hailuo03TextContent,
)
from comfy_api_nodes.util import (
    ApiEndpoint,
    poll_op,
    sync_op,
    upload_images_to_comfyapi,
    validate_image_aspect_ratio,
    validate_image_dimensions,
    validate_string,
    download_url_to_video_output,
)
from comfy_extras.nodes_audio import load as _load_audio_file

HAILUO_H3_MODEL_ID = "MiniMax-H3"
HAILUO_H3_CREATE_ENDPOINT = "/proxy/minimax/v2/video_generation"
HAILUO_H3_QUERY_ENDPOINT = "/proxy/minimax/v2/query/video_generation"
HAILUO_H3_FAILED_STATUSES = ["failed", "cancelled", "expired"]

# 768P/2K USD-per-second rates, matching MiniMax H3's official price_badge in
# comfy_api_nodes/nodes_minimax.py.
HAILUO_H3_RATE_USD_PER_S = {"768P": 0.1287, "2K": 0.1859}

BACKEND_API = "MiniMax H3 (płatne API)"
BACKEND_LOCAL = "Lokalny workflow (bez API)"


def _video_in_name(i: int) -> str:
    return f"video_in_{i:02d}"


# ─── helpers ───────────────────────────────────────────────────────────────

def _cache_dir() -> str:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    d = os.path.join(root, ".cache", "music_video_director")
    os.makedirs(d, exist_ok=True)
    return d


def _parse_keyframes(raw: str) -> list:
    try:
        data = json.loads(raw) if raw else []
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Nieprawidłowy JSON w keyframes_json: {exc}") from exc

    if not isinstance(data, list) or len(data) < 2:
        raise ValueError(
            "Potrzeba co najmniej 2 klatek kluczowych (czyli 1 segmentu), aby wygenerować wideo."
        )

    times = sorted(float(t) for t in data)
    for i in range(len(times) - 1):
        gap = times[i + 1] - times[i]
        if gap < 4.5 or gap > 15.5:
            raise ValueError(
                f"Odstęp między klatką {i + 1} ({times[i]:.2f}s) a klatką {i + 2} "
                f"({times[i + 1]:.2f}s) wynosi {gap:.2f}s. MiniMax H3 wymaga 5-15s na segment."
            )
    return times


def _segment_cache_key(img1, img2, prompt: str, resolution: str, duration: int, seed: int, watermark: bool) -> str:
    h = hashlib.sha256()
    for img in (img1, img2):
        frame = img[0] if img.dim() == 4 else img
        h.update(frame.detach().cpu().numpy().tobytes())
    h.update(prompt.encode("utf-8"))
    h.update(f"|{resolution}|{duration}|{seed}|{watermark}|{HAILUO_H3_MODEL_ID}".encode("utf-8"))
    return h.hexdigest()


def _blank_video() -> "InputImpl.VideoFromComponents":
    frame = torch.zeros(1, 64, 64, 3)
    return InputImpl.VideoFromComponents(VideoComponents(images=frame, frame_rate=Fraction(24, 1)))


async def _generate_segment(cls, first_frame, last_frame, prompt: str, resolution: str, duration: int, seed: int, watermark: bool):
    first_url = (await upload_images_to_comfyapi(
        cls, first_frame, max_images=1, wait_label="Wysyłanie pierwszej klatki"
    ))[0]
    last_url = (await upload_images_to_comfyapi(
        cls, last_frame, max_images=1, wait_label="Wysyłanie ostatniej klatki"
    ))[0]

    content = [
        Hailuo03TextContent(text=prompt),
        Hailuo03ImageContent(image_url=Hailuo03ImageContentUrl(url=first_url), role="first_frame"),
        Hailuo03ImageContent(image_url=Hailuo03ImageContentUrl(url=last_url), role="last_frame"),
    ]

    response = await sync_op(
        cls,
        ApiEndpoint(path=HAILUO_H3_CREATE_ENDPOINT, method="POST"),
        response_model=Hailuo03TaskCreationResponse,
        data=Hailuo03TaskCreationRequest(
            model=HAILUO_H3_MODEL_ID,
            content=content,
            resolution=resolution,
            duration=duration,
            ratio=None,
            seed=seed,
            aigc_watermark=watermark,
        ),
    )

    task_result = await poll_op(
        cls,
        ApiEndpoint(path=f"{HAILUO_H3_QUERY_ENDPOINT}/{response.task_id}"),
        response_model=Hailuo03TaskQueryResponse,
        status_extractor=lambda r: r.task.status,
        failed_statuses=HAILUO_H3_FAILED_STATUSES,
        poll_interval=15,
    )

    video_url = task_result.task.content.url if task_result.task.content else None
    if not video_url:
        raise Exception(f"MiniMax H3 nie zwrócił adresu wideo: {task_result.model_dump()}")

    return await download_url_to_video_output(video_url, cls=cls)


# ─── node ──────────────────────────────────────────────────────────────────

class MusicVideoDirector(IO.ComfyNode):
    MAX_KEYFRAMES = 40

    @classmethod
    def define_schema(cls) -> IO.Schema:
        input_dir = folder_paths.get_input_directory()
        os.makedirs(input_dir, exist_ok=True)
        audio_files = folder_paths.filter_files_content_types(os.listdir(input_dir), ["audio"])

        inputs = [
            # Celowo BEZ upload=IO.UploadType.audio: wbudowany w ComfyUI mechanizm uploadu audio
            # (rozszerzenia "Comfy.AudioWidget"/"Comfy.UploadAudio") zakłada istnienie widgetu
            # podglądu "audioUI", który ComfyUI dodaje tylko dla zahardkodowanej listy nazw nodów
            # (LoadAudio, SaveAudio, ...) — dla innych nodów powoduje to wyjątek przy tworzeniu noda.
            # Upload obsługujemy własnym przyciskiem w web/music_video_director.js.
            IO.Combo.Input(
                "audio",
                options=sorted(audio_files),
                tooltip="Utwór, na podstawie którego rysowany jest oscylogram i rozstawiane klatki kluczowe.",
            ),
            IO.Combo.Input(
                "backend",
                options=[BACKEND_API, BACKEND_LOCAL],
                default=BACKEND_API,
                tooltip="MiniMax H3: node sam generuje każdy segment (płatne). Lokalny workflow: podłączasz "
                "gotowe klipy VIDEO z własnego lokalnego generatora do gniazd video_in_XX — bez API, bez kosztu.",
            ),
            IO.String.Input(
                "keyframes_json",
                multiline=False,
                default="[0.0, 5.0]",
                tooltip="Wewnętrzny stan edytora oscylogramu (JSON z czasami klatek kluczowych w sekundach). "
                "Edytowany przez widget na canvasie, nie ręcznie.",
            ),
            IO.Combo.Input("resolution", options=["768P", "2K"], default="768P"),
            IO.Int.Input(
                "seed",
                default=42,
                min=0,
                max=4294967295,
                step=1,
                control_after_generate=True,
                tooltip="Ten sam seed dla wszystkich segmentów w tym uruchomieniu.",
            ),
            IO.Boolean.Input(
                "watermark",
                default=False,
                advanced=True,
                tooltip="Dodaje znak wodny AIGC do generowanych segmentów.",
            ),
            IO.Boolean.Input(
                "use_cache",
                default=True,
                tooltip="Pomija (płatne) ponowne generowanie segmentu, jeśli jego obrazy/prompt/ustawienia się nie zmieniły.",
            ),
            IO.Boolean.Input(
                "dry_run",
                default=False,
                tooltip="Sprawdza walidacje i liczy szacowany koszt BEZ wywoływania płatnego API MiniMax.",
            ),
            IO.String.Input(
                "default_prompt",
                multiline=True,
                default="",
                optional=True,
                tooltip="Używany dla klatek, których własne pole prompt jest puste.",
            ),
        ]
        for i in range(1, cls.MAX_KEYFRAMES + 1):
            inputs.append(IO.Image.Input(f"image_{i:02d}", optional=True))
            inputs.append(IO.String.Input(f"prompt_{i:02d}", multiline=True, default="", optional=True))
        for i in range(1, cls.MAX_KEYFRAMES):
            inputs.append(IO.Video.Input(
                _video_in_name(i),
                optional=True,
                tooltip=f"Tryb lokalny: gotowy klip wideo dla segmentu {i} (od klatki {i} do klatki {i + 1}), "
                "wygenerowany we własnym workflow. Długość powinna odpowiadać rozstawowi klatek kluczowych, "
                "inaczej dźwięk rozjedzie się z obrazem w finalnym wideo.",
            ))

        outputs = [
            IO.Video.Output(display_name="wideo_koncowe"),
            IO.Float.Output(display_name="koszt_szacowany_usd"),
            IO.String.Output(display_name="manifest_json"),
        ]
        for i in range(1, cls.MAX_KEYFRAMES):
            outputs.append(IO.Video.Output(display_name=f"segment_{i:02d}"))

        return IO.Schema(
            node_id="SzandorMusicVideoDirector",
            display_name="Reżyser Teledysku (MiniMax H3)",
            category="Moje Nody/Wideo",
            description="Rozstaw klatki kluczowe na oscylogramie utworu i wygeneruj teledysk segment po "
            "segmencie modelem MiniMax H3 (first-frame/last-frame), ze sklejonym finalnym wideo i audio.",
            inputs=inputs,
            outputs=outputs,
            hidden=[IO.Hidden.auth_token_comfy_org, IO.Hidden.api_key_comfy_org, IO.Hidden.unique_id],
            is_api_node=True,
        )

    @classmethod
    async def execute(
        cls,
        audio,
        backend,
        keyframes_json,
        resolution,
        seed,
        watermark,
        use_cache,
        dry_run,
        default_prompt="",
        **kwargs,
    ) -> IO.NodeOutput:
        times = _parse_keyframes(keyframes_json)
        n_segments = len(times) - 1
        is_local = backend == BACKEND_LOCAL

        audio_path = folder_paths.get_annotated_filepath(audio)
        waveform, sample_rate = _load_audio_file(audio_path)
        waveform = waveform.unsqueeze(0)

        rate = HAILUO_H3_RATE_USD_PER_S.get(resolution, HAILUO_H3_RATE_USD_PER_S["768P"])
        cache_dir = _cache_dir()

        manifest = {
            "backend": backend,
            "keyframes_sec": times,
            "resolution": resolution,
            "seed": seed,
            "watermark": watermark,
            "dry_run": dry_run,
            "segments": [],
        }
        total_cost = 0.0
        segment_videos = []

        for i in range(n_segments):
            expected_duration = times[i + 1] - times[i]

            if is_local:
                video = kwargs.get(_video_in_name(i + 1))
                cost = 0.0
                warning = None
                if video is None:
                    if dry_run:
                        video = _blank_video()
                        status = "dry_run"
                    else:
                        raise ValueError(
                            f"Tryb lokalny: brak podłączonego wideo w gnieździe "
                            f"{_video_in_name(i + 1)} (segment {i + 1})."
                        )
                else:
                    status = "local"
                    try:
                        actual_duration = video.get_duration()
                        if abs(actual_duration - expected_duration) > 0.5:
                            warning = (
                                f"długość klipu ({actual_duration:.2f}s) różni się od rozstawu klatek "
                                f"({expected_duration:.2f}s) — audio może się rozjechać z obrazem"
                            )
                    except Exception:
                        pass

                segment_videos.append(video)
                manifest["segments"].append({
                    "index": i + 1,
                    "start_s": times[i],
                    "end_s": times[i + 1],
                    "duration_s": expected_duration,
                    "cache": status,
                    "cost_usd": 0.0,
                    "warning": warning,
                })
                continue

            img1 = kwargs.get(f"image_{i + 1:02d}")
            img2 = kwargs.get(f"image_{i + 2:02d}")
            if img1 is None:
                raise ValueError(f"Brak obrazu w gnieździe image_{i + 1:02d} (klatka kluczowa {i + 1}).")
            if img2 is None:
                raise ValueError(f"Brak obrazu w gnieździe image_{i + 2:02d} (klatka kluczowa {i + 2}).")

            prompt_raw = kwargs.get(f"prompt_{i + 1:02d}") or default_prompt or ""
            prompt = prompt_raw.strip()
            validate_string(prompt, field_name=f"prompt_{i + 1:02d}", min_length=1)

            for img in (img1, img2):
                validate_image_aspect_ratio(img, (2, 5), (5, 2), strict=False)
                validate_image_dimensions(img, min_width=256, min_height=256)

            duration = max(5, min(15, round(expected_duration)))
            cache_key = _segment_cache_key(img1, img2, prompt, resolution, duration, seed, watermark)
            cache_path = os.path.join(cache_dir, f"{cache_key}.mp4")
            cost = duration * rate
            total_cost += cost

            if use_cache and os.path.isfile(cache_path):
                video = InputImpl.VideoFromFile(cache_path)
                status = "hit"
            elif dry_run:
                video = _blank_video()
                status = "dry_run"
            else:
                video = await _generate_segment(cls, img1, img2, prompt, resolution, duration, seed, watermark)
                try:
                    video.save_to(cache_path)
                    video = InputImpl.VideoFromFile(cache_path)
                except Exception as exc:
                    logging.warning(
                        "[MusicVideoDirector] Nie udało się zapisać cache segmentu %s: %s", i + 1, exc
                    )
                status = "miss"

            segment_videos.append(video)
            manifest["segments"].append({
                "index": i + 1,
                "start_s": times[i],
                "end_s": times[i + 1],
                "duration_s": duration,
                "prompt": prompt,
                "cache": status,
                "cost_usd": round(cost, 4),
            })

        manifest["estimated_cost_usd"] = round(total_cost, 4)

        if segment_videos:
            images = torch.cat([v.get_components().images for v in segment_videos], dim=0)
            frame_rate = segment_videos[0].get_components().frame_rate
        else:
            images = torch.zeros(1, 64, 64, 3)
            frame_rate = Fraction(24, 1)

        start_sample = max(0, int(times[0] * sample_rate))
        end_sample = min(waveform.shape[-1], int(times[-1] * sample_rate))
        trimmed_audio = {"waveform": waveform[..., start_sample:end_sample], "sample_rate": sample_rate}

        final_video = InputImpl.VideoFromComponents(
            VideoComponents(images=images, audio=trimmed_audio, frame_rate=frame_rate)
        )

        outputs = [final_video, float(total_cost), json.dumps(manifest, ensure_ascii=False)]
        for i in range(cls.MAX_KEYFRAMES - 1):
            outputs.append(segment_videos[i] if i < n_segments else _blank_video())

        return IO.NodeOutput(*outputs)


NODE_CLASS_MAPPINGS = {"SzandorMusicVideoDirector": MusicVideoDirector}
NODE_DISPLAY_NAME_MAPPINGS = {"SzandorMusicVideoDirector": "Reżyser Teledysku (MiniMax H3)"}
