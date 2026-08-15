import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_TYPE = "SzandorMusicVideoDirector";
const MAX_KEYFRAMES = 40;
const MIN_GAP = 5;
const MAX_GAP = 15;
const MIN_WIDTH = 460;

const TIMELINE_HEIGHT = 160;
const TRANSPORT_H = 24;
const SCROLL_H = 8;
const HINT_H = 14;
const WAVE_H = TIMELINE_HEIGHT - TRANSPORT_H - SCROLL_H - HINT_H;
const MARKER_HIT_PX = 9;
const PROMPT_ROW_H = 44;

const pad = i => String(i).padStart(2, "0");
const imageInputName = i => `image_${pad(i)}`;
const promptWidgetName = i => `prompt_${pad(i)}`;
const segmentOutputName = i => `segment_${pad(i)}`;
const videoInName = i => `video_in_${pad(i)}`;

const BACKEND_LOCAL = "Lokalny workflow (bez API)";
const isLocalBackend = node => (node.widgets?.find(w => w.name === "backend")?.value ?? "") === BACKEND_LOCAL;

function inRect(x, y, rect) {
    return rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

// ─── audio decode helpers ───────────────────────────────────────────────────

let sharedAudioCtx = null;
function getAudioCtx() {
    if (!sharedAudioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        sharedAudioCtx = new Ctx();
    }
    return sharedAudioCtx;
}

const audioBufferCache = new Map(); // filename -> AudioBuffer | null

async function decodeAudioFile(filename) {
    if (audioBufferCache.has(filename)) return audioBufferCache.get(filename);
    try {
        const url = api.apiURL(`/view?filename=${encodeURIComponent(filename)}&type=input&subfolder=`);
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const arrayBuf = await resp.arrayBuffer();
        const buffer = await getAudioCtx().decodeAudioData(arrayBuf);
        audioBufferCache.set(filename, buffer);
        return buffer;
    } catch (error) {
        console.error("[MusicVideoDirector] Nie udało się zdekodować audio:", error);
        audioBufferCache.set(filename, null);
        return null;
    }
}

// ComfyUI's built-in "audio_upload" combo widget (Comfy.UploadAudio /
// Comfy.AudioWidget core extensions) assumes a companion "audioUI" preview
// widget exists, which core only auto-creates for a hardcoded list of node
// names (LoadAudio, SaveAudio, ...). For any other node it throws when
// creating the node ("can't access property 'element', e is undefined").
// We deliberately don't set upload=audio_upload in the Python schema and
// instead upload through the same generic endpoint multi_image_loader.js
// uses, avoiding that core code path entirely.
async function uploadAudioFile(file) {
    const body = new FormData();
    body.append("image", file);
    body.append("type", "input");
    body.append("overwrite", "false");
    try {
        const r = await api.fetchApi("/upload/image", { method: "POST", body });
        if (!r.ok) return null;
        return (await r.json()).name ?? null;
    } catch (error) {
        console.error("[MusicVideoDirector] Nie udało się wgrać audio:", error);
        return null;
    }
}

function computePeaks(audioBuffer, numBuckets) {
    const channels = [];
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) channels.push(audioBuffer.getChannelData(c));
    const length = audioBuffer.length;
    const bucketSize = Math.max(1, Math.floor(length / numBuckets));
    const peaks = new Float32Array(numBuckets * 2);
    for (let b = 0; b < numBuckets; b++) {
        const start = b * bucketSize;
        const end = Math.min(length, start + bucketSize);
        let min = 0, max = 0;
        for (let i = start; i < end; i++) {
            let sample = 0;
            for (const ch of channels) sample += ch[i];
            sample /= channels.length;
            if (sample < min) min = sample;
            if (sample > max) max = sample;
        }
        peaks[b * 2] = min;
        peaks[b * 2 + 1] = max;
    }
    return peaks;
}

function safeKeyframes(value) {
    try {
        const arr = JSON.parse(value || "[]");
        if (!Array.isArray(arr)) return [0, 5];
        const times = arr.map(Number).filter(t => Number.isFinite(t) && t >= 0);
        times.sort((a, b) => a - b);
        return times.length >= 2 ? times : [0, 5];
    } catch {
        return [0, 5];
    }
}

function fmtTime(s) {
    s = Math.max(0, s | 0);
    const m = Math.floor(s / 60), sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
}

// ─── graph-link helpers (input side; mirrors the output-side helpers proven
//     out in web/multi_image_loader.js) ────────────────────────────────────

function getGraphLink(graph, linkId) {
    const links = graph?.links;
    if (!links || linkId == null) return null;
    if (links instanceof Map) return links.get(linkId) ?? links.get(String(linkId)) ?? null;
    return links[linkId] ?? links[String(linkId)] ?? null;
}

function getGraphLinks(graph) {
    const links = graph?.links;
    if (!links) return [];
    return links instanceof Map ? [...links.values()] : Object.values(links);
}

function reindexInputLinksAfterRemoval(node, removedIndex) {
    for (const link of getGraphLinks(node.graph)) {
        if (!link) continue;
        const targetId = link.target_id ?? link.targetId;
        const targetSlot = link.target_slot ?? link.targetSlot;
        if (String(targetId) === String(node.id) && Number.isInteger(targetSlot) && targetSlot > removedIndex) {
            if ("target_slot" in link) link.target_slot = targetSlot - 1;
            if ("targetSlot" in link) link.targetSlot = targetSlot - 1;
        }
    }
}

function safeRemoveInput(node, index) {
    const input = node.inputs?.[index];
    if (!input) return true;
    if (input.link != null) {
        try {
            node.disconnectInput(index);
        } catch (error) {
            console.warn(`[MusicVideoDirector] Nie udało się odłączyć wejścia ${index}:`, error);
        }
    }
    try {
        node.removeInput(index);
        return true;
    } catch (error) {
        console.warn(`[MusicVideoDirector] Nie udało się bezpiecznie usunąć wejścia ${index}:`, error);
        node.inputs.splice(index, 1);
        reindexInputLinksAfterRemoval(node, index);
        node.setDirtyCanvas(true, true);
        return true;
    }
}

function getOutputLinkIds(output) {
    if (!output?.links) return [];
    try {
        return [...output.links];
    } catch {
        return [];
    }
}

function reindexOutputLinksAfterRemoval(node, removedIndex) {
    for (const link of getGraphLinks(node.graph)) {
        if (!link) continue;
        const originId = link.origin_id ?? link.originId;
        const originSlot = link.origin_slot ?? link.originSlot;
        if (String(originId) === String(node.id) && Number.isInteger(originSlot) && originSlot > removedIndex) {
            if ("origin_slot" in link) link.origin_slot = originSlot - 1;
            if ("originSlot" in link) link.originSlot = originSlot - 1;
        }
    }
}

function safeRemoveOutput(node, index) {
    const output = node.outputs?.[index];
    if (!output) return true;
    const linkIds = getOutputLinkIds(output);
    if (linkIds.length && !node.graph?.links) return false;
    const validLinkIds = linkIds.filter(linkId => getGraphLink(node.graph, linkId) != null);
    output.links = validLinkIds.length ? validLinkIds : null;
    try {
        node.removeOutput(index);
        return true;
    } catch (error) {
        console.warn(`[MusicVideoDirector] Nie udało się bezpiecznie usunąć wyjścia ${index}:`, error);
        const liveLinks = getOutputLinkIds(output).filter(linkId => getGraphLink(node.graph, linkId) != null);
        if (liveLinks.length) return false;
        node.outputs.splice(index, 1);
        reindexOutputLinksAfterRemoval(node, index);
        node.setDirtyCanvas(true, true);
        return true;
    }
}

// ─── dynamic slot synchronisation ───────────────────────────────────────────

function syncKeyframeSlots(node, count) {
    const n = Math.max(2, Math.min(MAX_KEYFRAMES, count | 0));
    const activeSegments = n - 1;
    const local = isLocalBackend(node);

    // image_XX sockets: only in API mode, one per keyframe.
    for (let i = 1; i <= (local ? 0 : n); i++) {
        const idx = node.inputs?.findIndex(inp => inp.name === imageInputName(i)) ?? -1;
        if (idx < 0) node.addInput(imageInputName(i), "IMAGE");
    }
    for (let i = MAX_KEYFRAMES; i > (local ? 0 : n); i--) {
        const idx = node.inputs?.findIndex(inp => inp.name === imageInputName(i)) ?? -1;
        if (idx >= 0) safeRemoveInput(node, idx);
    }

    // prompt_XX widgets: only in API mode, one per keyframe (last one unused).
    for (let i = 1; i <= MAX_KEYFRAMES; i++) {
        const w = node.widgets?.find(w => w.name === promptWidgetName(i));
        if (!w) continue;
        if (!local && i <= n) {
            w.show();
            w._disabledNote = i === n ? "— tylko last_frame, prompt nieużywany —" : null;
        } else {
            w.hide();
        }
    }

    // video_in_XX sockets: only in local mode, one per segment (same count as outputs).
    for (let i = 1; i <= (local ? activeSegments : 0); i++) {
        const idx = node.inputs?.findIndex(inp => inp.name === videoInName(i)) ?? -1;
        if (idx < 0) node.addInput(videoInName(i), "VIDEO");
    }
    for (let i = MAX_KEYFRAMES - 1; i > (local ? activeSegments : 0); i--) {
        const idx = node.inputs?.findIndex(inp => inp.name === videoInName(i)) ?? -1;
        if (idx >= 0) safeRemoveInput(node, idx);
    }

    for (let i = 1; i <= activeSegments; i++) {
        const idx = node.outputs?.findIndex(o => o.name === segmentOutputName(i)) ?? -1;
        if (idx < 0) node.addOutput(segmentOutputName(i), "VIDEO");
    }
    for (let i = MAX_KEYFRAMES - 1; i > activeSegments; i--) {
        const idx = node.outputs?.findIndex(o => o.name === segmentOutputName(i)) ?? -1;
        if (idx >= 0) safeRemoveOutput(node, idx);
    }

    growToFit(node);
    node.setDirtyCanvas(true, true);
}

// Only ever GROWS the node to fit required content / MIN_WIDTH — never shrinks
// it back down. A manual resize by the user must survive widget/socket churn.
function growToFit(node) {
    const required = node.computeSize();
    node.setSize([
        Math.max(node.size[0], required[0], MIN_WIDTH),
        Math.max(node.size[1], required[1]),
    ]);
}

function scheduleMvdSync(node) {
    if (node._szandorMvdSyncFrame != null) cancelAnimationFrame(node._szandorMvdSyncFrame);
    node._szandorMvdSyncFrame = requestAnimationFrame(() => {
        node._szandorMvdSyncFrame = null;
        const tw = node._szandorTimelineWidget;
        if (!tw) return;
        try {
            syncKeyframeSlots(node, tw.times.length);
        } catch (error) {
            console.error("[MusicVideoDirector] Błąd synchronizacji gniazd:", error);
        }
    });
}

// ─── prompt-per-keyframe widget (compact row + popup editor) ───────────────

function openPromptEditor(node, widget) {
    const backdrop = document.createElement("div");
    Object.assign(backdrop.style, {
        position: "fixed", inset: "0", zIndex: "99999",
        background: "rgba(0,0,0,.55)", display: "grid", placeItems: "center",
    });
    const panel = document.createElement("div");
    Object.assign(panel.style, {
        width: "min(560px, 90vw)", display: "flex", flexDirection: "column", gap: "8px",
        padding: "14px", border: "1px solid #666", borderRadius: "10px",
        background: "#242424", boxShadow: "0 18px 55px rgba(0,0,0,.75)",
    });
    const label = document.createElement("div");
    label.textContent = `Prompt segmentu — ${widget.name}`;
    label.style.cssText = "color:#ccc;font-size:12px;font-weight:bold;";
    const textarea = document.createElement("textarea");
    textarea.value = widget.value || "";
    Object.assign(textarea.style, {
        width: "100%", minHeight: "140px", resize: "vertical", boxSizing: "border-box",
        padding: "10px", color: "#eee", background: "#171717", border: "1px solid #666",
        borderRadius: "6px", fontSize: "13px", fontFamily: "inherit",
    });
    const hint = document.createElement("div");
    hint.textContent = "Ctrl/Cmd+Enter = zapisz • Esc = anuluj • klik poza oknem = zapisz";
    hint.style.cssText = "color:#777;font-size:10px;";

    const finish = save => {
        if (save) {
            widget.value = textarea.value;
            node.setDirtyCanvas(true, true);
        }
        backdrop.remove();
    };
    textarea.onkeydown = event => {
        if (event.key === "Escape") { event.preventDefault(); finish(false); }
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); finish(true); }
    };
    backdrop.onpointerdown = event => { if (event.target === backdrop) finish(true); };
    panel.append(label, textarea, hint);
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
    textarea.focus();
    textarea.select();
}

function makePromptWidget(node, idx) {
    const w = {
        type: "SZANDOR_MVD_PROMPT",
        name: promptWidgetName(idx),
        value: "",
        _hidden: false,
        _disabledNote: null,

        hide() { this._hidden = true; },
        show() { this._hidden = false; },

        computeSize(width) {
            if (this._hidden) return [0, -4];
            return [width, PROMPT_ROW_H];
        },

        draw(ctx, _node, width, y, height) {
            if (this._hidden) return;
            ctx.fillStyle = "#232323";
            ctx.strokeStyle = "#444";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(4, y + 3, width - 8, height - 6, 5);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = "#8fa5d2";
            ctx.font = "10px monospace";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(`K${idx} prompt:`, 12, y + 15);

            ctx.font = "12px sans-serif";
            if (this._disabledNote) {
                ctx.fillStyle = "#666";
                ctx.fillText(this._disabledNote, 12, y + height / 2 + 9);
            } else {
                const text = (this.value || "").replace(/\s+/g, " ").trim();
                ctx.fillStyle = text ? "#ddd" : "#666";
                const shownSrc = text || "(kliknij, aby dodać prompt segmentu)";
                const maxW = width - 24;
                let shown = shownSrc;
                while (ctx.measureText(shown).width > maxW && shown.length > 3) shown = shown.slice(0, -1);
                if (shown !== shownSrc) shown += "…";
                ctx.fillText(shown, 12, y + height / 2 + 9);
            }
        },

        mouse(event) {
            if (this._hidden || this._disabledNote) return false;
            if (event.type !== "pointerdown") return false;
            openPromptEditor(node, this);
            return true;
        },

        serializeValue() { return this.value; },
    };
    return w;
}

// ─── waveform + keyframe timeline widget ────────────────────────────────────

function makeTimelineWidget(node) {
    const w = {
        type: "SZANDOR_MVD_TIMELINE",
        name: "keyframes_json",
        value: "[0.0, 5.0]",
        times: [0, 5],

        audioFilename: null,
        audioEl: null,
        audioBuffer: null,
        peaks: null,
        loadError: null,
        viewStart: 0,
        viewDuration: 10,

        _dragIndex: -1,
        _flashUntil: 0,
        _lastClickIndex: -1,
        _lastClickTime: 0,
        _destroyed: false,

        computeSize(width) {
            return [width, TIMELINE_HEIGHT];
        },

        setTimesFromValue() {
            this.times = safeKeyframes(this.value);
        },

        pushValue() {
            this.value = JSON.stringify(this.times.map(t => Math.round(t * 100) / 100));
            scheduleMvdSync(node);
            node.setDirtyCanvas(true, true);
        },

        setAudioFile(filename) {
            if (!filename || filename === this.audioFilename) return;
            this.audioFilename = filename;
            this.audioBuffer = null;
            this.peaks = null;
            this.loadError = null;
            if (this.audioEl) {
                try { this.audioEl.pause(); } catch { /* ignore */ }
            }
            const url = api.apiURL(`/view?filename=${encodeURIComponent(filename)}&type=input&subfolder=`);
            this.audioEl = new Audio(url);
            this.audioEl.preload = "auto";
            node.setDirtyCanvas(true, true);

            decodeAudioFile(filename).then(buffer => {
                if (this._destroyed || filename !== this.audioFilename) return;
                this.audioBuffer = buffer;
                if (!buffer) {
                    this.loadError = "Nie można zdekodować tego pliku audio w przeglądarce.";
                } else {
                    this.peaks = computePeaks(buffer, 4000);
                    this.viewStart = 0;
                    this.viewDuration = buffer.duration;
                    const clamped = this.times.filter(t => t <= buffer.duration);
                    this.times = clamped.length >= 2 ? clamped : [0, Math.min(MIN_GAP, buffer.duration)];
                    this.pushValue();
                }
                node.setDirtyCanvas(true, true);
            });
        },

        _flash() {
            this._flashUntil = Date.now() + 300;
            node.setDirtyCanvas(true, true);
            setTimeout(() => node.setDirtyCanvas(true, true), 320);
        },

        _uploadAudio() {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "audio/*";
            input.onchange = async event => {
                const file = event.target.files?.[0];
                if (!file) return;
                const name = await uploadAudioFile(file);
                if (!name) return;

                const audioW = node.widgets.find(w => w.name === "audio");
                if (audioW) {
                    if (audioW.options && Array.isArray(audioW.options.values) && !audioW.options.values.includes(name)) {
                        audioW.options.values.push(name);
                    }
                    audioW.value = name;
                    if (typeof audioW.callback === "function") audioW.callback(name);
                    else this.setAudioFile(name);
                } else {
                    this.setAudioFile(name);
                }
                node.setDirtyCanvas(true, true);
            };
            input.click();
        },

        _tryAddKeyframe(t) {
            const dur = this.audioBuffer?.duration ?? Infinity;
            t = Math.max(0, Math.min(dur, t));
            if (this.times.length >= MAX_KEYFRAMES) { this._flash(); return false; }

            let idx = 0;
            while (idx < this.times.length && this.times[idx] < t) idx++;
            const prev = idx > 0 ? this.times[idx - 1] : null;
            const next = idx < this.times.length ? this.times[idx] : null;

            if (prev != null && (t - prev) < MIN_GAP) { this._flash(); return false; }
            if (prev != null && (t - prev) > MAX_GAP) { this._flash(); return false; }
            if (next != null && (next - t) < MIN_GAP) { this._flash(); return false; }
            if (next != null && (next - t) > MAX_GAP) { this._flash(); return false; }

            this.times.splice(idx, 0, Math.round(t * 100) / 100);
            this.pushValue();
            return true;
        },

        _togglePlay() {
            if (!this.audioEl) return;
            if (this.audioEl.paused) {
                this.audioEl.play().catch(() => {});
                this._runPlaybackLoop();
            } else {
                this.audioEl.pause();
            }
            node.setDirtyCanvas(true, true);
        },

        _runPlaybackLoop() {
            if (this._destroyed || !this.audioEl || this.audioEl.paused) {
                node.setDirtyCanvas(true, true);
                return;
            }
            const t = this.audioEl.currentTime;
            if (t < this.viewStart || t > this.viewStart + this.viewDuration) {
                this.viewStart = Math.max(0, t - this.viewDuration * 0.1);
            }
            node.setDirtyCanvas(true, true);
            requestAnimationFrame(() => this._runPlaybackLoop());
        },

        _setZoom(newDuration) {
            const dur = this.audioBuffer?.duration ?? this.viewDuration;
            newDuration = Math.max(2, Math.min(dur, newDuration));
            const centerT = this.viewStart + this.viewDuration / 2;
            this.viewStart = Math.max(0, Math.min(dur - newDuration, centerT - newDuration / 2));
            this.viewDuration = newDuration;
            node.setDirtyCanvas(true, true);
        },

        _pan(fraction) {
            const dur = this.audioBuffer?.duration ?? this.viewDuration;
            this.viewStart = Math.max(0, Math.min(Math.max(0, dur - this.viewDuration), this.viewStart + this.viewDuration * fraction));
            node.setDirtyCanvas(true, true);
        },

        // ── drawing ──────────────────────────────────────────────────────────
        draw(ctx, _node, width, y, height) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, y, width, height);
            ctx.clip();

            ctx.fillStyle = "#161616";
            ctx.fillRect(0, y, width, height);

            if (this._flashUntil && Date.now() < this._flashUntil) {
                ctx.strokeStyle = "rgba(220,60,60,0.9)";
                ctx.lineWidth = 2;
                ctx.strokeRect(1, y + 1, width - 2, height - 2);
            }

            this._drawTransport(ctx, width, y);

            const waveTop = y + TRANSPORT_H;
            ctx.fillStyle = "#0d0d0d";
            ctx.fillRect(0, waveTop, width, WAVE_H);

            if (!this.audioFilename) {
                ctx.fillStyle = "#555";
                ctx.font = "12px sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("Kliknij ⬆ powyżej, aby wgrać audio, albo wybierz je z listy", width / 2, waveTop + WAVE_H / 2);
            } else if (this.loadError) {
                ctx.fillStyle = "#a55";
                ctx.font = "11px sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(this.loadError, width / 2, waveTop + WAVE_H / 2);
            } else if (!this.peaks) {
                ctx.fillStyle = "#555";
                ctx.font = "12px sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("Dekodowanie audio…", width / 2, waveTop + WAVE_H / 2);
            } else {
                try {
                    this._drawWaveform(ctx, width, waveTop);
                    this._drawKeyframes(ctx, width, waveTop);
                    this._drawPositionBar(ctx, width, waveTop + WAVE_H);
                } catch (error) {
                    if (!this._loggedDrawError) {
                        console.error("[MusicVideoDirector] Błąd rysowania oscylogramu:", error);
                        this._loggedDrawError = true;
                    }
                    ctx.fillStyle = "#a55";
                    ctx.font = "11px sans-serif";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText("Błąd rysowania — zobacz konsolę (F12)", width / 2, waveTop + WAVE_H / 2);
                }
            }

            ctx.fillStyle = "#5a5a5a";
            ctx.font = "9px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(
                "klik = dodaj klatkę • przeciągnij znacznik = przesuń • 2×klik = usuń • Alt+klik = przewiń audio",
                width / 2,
                y + TRANSPORT_H + WAVE_H + SCROLL_H + HINT_H / 2
            );

            ctx.restore();
        },

        _drawTransport(ctx, width, y) {
            this._playBtnRect = { x: 6, y: 3, w: 22, h: 18 };
            this._uploadBtnRect = { x: 30, y: 3, w: 22, h: 18 };
            this._panLeftRect = { x: width - 148, y: 3, w: 20, h: 18 };
            this._panRightRect = { x: width - 126, y: 3, w: 20, h: 18 };
            this._zoomOutRect = { x: width - 96, y: 3, w: 20, h: 18 };
            this._zoomInRect = { x: width - 74, y: 3, w: 20, h: 18 };
            this._zoomFitRect = { x: width - 52, y: 3, w: 46, h: 18 };

            const playing = this.audioEl && !this.audioEl.paused;
            const buttons = [
                [this._playBtnRect, playing ? "⏸" : "▶"],
                [this._uploadBtnRect, "⬆"],
                [this._panLeftRect, "◀"],
                [this._panRightRect, "▶"],
                [this._zoomOutRect, "−"],
                [this._zoomInRect, "+"],
                [this._zoomFitRect, "dopasuj"],
            ];
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            for (const [rect, label] of buttons) {
                ctx.fillStyle = "#333";
                ctx.beginPath();
                ctx.roundRect(rect.x, y + rect.y, rect.w, rect.h, 4);
                ctx.fill();
                ctx.fillStyle = "#ddd";
                ctx.font = label.length > 1 && label !== "dopasuj" ? "11px sans-serif" : "10px sans-serif";
                ctx.fillText(label, rect.x + rect.w / 2, y + rect.y + rect.h / 2 + 1);
            }

            ctx.fillStyle = "#999";
            ctx.font = "10px monospace";
            ctx.textAlign = "left";
            const dur = this.audioBuffer?.duration ?? 0;
            const cur = this.audioEl?.currentTime ?? 0;
            const label = this.audioFilename ? `${fmtTime(cur)} / ${fmtTime(dur)}` : "brak audio — kliknij ⬆";
            ctx.fillText(label, 58, y + 13);
        },

        _drawWaveform(ctx, width, top) {
            const dur = this.audioBuffer.duration;
            const mid = top + WAVE_H / 2;
            const bucketCount = this.peaks.length / 2;
            ctx.strokeStyle = "#5a8fd6";
            ctx.lineWidth = 1;
            for (let x = 0; x < width; x++) {
                const t = this.viewStart + (x / width) * this.viewDuration;
                if (t < 0 || t > dur) continue;
                const bIdx = Math.min(bucketCount - 1, Math.max(0, Math.floor((t / dur) * bucketCount)));
                const min = this.peaks[bIdx * 2], max = this.peaks[bIdx * 2 + 1];
                const y1 = mid - max * (WAVE_H / 2 - 2);
                const y2 = mid - min * (WAVE_H / 2 - 2);
                ctx.beginPath();
                ctx.moveTo(x + 0.5, y1);
                ctx.lineTo(x + 0.5, y2);
                ctx.stroke();
            }
            if (this.audioEl) {
                const t = this.audioEl.currentTime;
                if (t >= this.viewStart && t <= this.viewStart + this.viewDuration) {
                    const x = ((t - this.viewStart) / this.viewDuration) * width;
                    ctx.strokeStyle = "#eee";
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(x, top);
                    ctx.lineTo(x, top + WAVE_H);
                    ctx.stroke();
                }
            }
        },

        _drawKeyframes(ctx, width, top) {
            this._markerHitboxes = [];
            const px = t => ((t - this.viewStart) / this.viewDuration) * width;
            for (let i = 0; i < this.times.length; i++) {
                const t = this.times[i];
                const x = px(t);
                if (x < -20 || x > width + 20) continue;
                const isLast = i === this.times.length - 1;
                const active = i === this._dragIndex;
                ctx.strokeStyle = active ? "#ffd54a" : (isLast ? "#8899aa" : "#7ad17a");
                ctx.lineWidth = active ? 2 : 1.5;
                ctx.beginPath();
                ctx.moveTo(x, top);
                ctx.lineTo(x, top + WAVE_H);
                ctx.stroke();

                ctx.fillStyle = ctx.strokeStyle;
                ctx.beginPath();
                ctx.moveTo(x - 5, top);
                ctx.lineTo(x + 5, top);
                ctx.lineTo(x, top + 8);
                ctx.closePath();
                ctx.fill();

                ctx.fillStyle = "#ccc";
                ctx.font = "9px monospace";
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.fillText(`K${i + 1}`, x, top + WAVE_H - 12);

                this._markerHitboxes.push({ index: i, x });
            }
        },

        _drawPositionBar(ctx, width, top) {
            const dur = this.audioBuffer.duration || 1;
            ctx.fillStyle = "#1a1a1a";
            ctx.fillRect(0, top, width, SCROLL_H);
            const thumbW = Math.max(6, (this.viewDuration / dur) * width);
            const thumbX = (this.viewStart / dur) * width;
            ctx.fillStyle = "#444";
            ctx.fillRect(thumbX, top + 1, thumbW, SCROLL_H - 2);
        },

        // ── mouse events ────────────────────────────────────────────────────
        mouse(event, pos) {
            const x = pos[0];
            const localY = pos[1] - (this.last_y ?? 0);

            if (event.type === "pointermove" && this._dragIndex >= 0) {
                this._dragMarker(x);
                return true;
            }
            if (event.type === "pointerup" && this._dragIndex >= 0) {
                this._dragIndex = -1;
                return true;
            }
            if (event.type !== "pointerdown") return false;

            if (localY >= 0 && localY < TRANSPORT_H) {
                const localX = x;
                if (inRect(localX, localY, this._playBtnRect)) { this._togglePlay(); return true; }
                if (inRect(localX, localY, this._uploadBtnRect)) { this._uploadAudio(); return true; }
                if (inRect(localX, localY, this._panLeftRect)) { this._pan(-0.3); return true; }
                if (inRect(localX, localY, this._panRightRect)) { this._pan(0.3); return true; }
                if (inRect(localX, localY, this._zoomOutRect)) { this._setZoom(this.viewDuration / 0.6); return true; }
                if (inRect(localX, localY, this._zoomInRect)) { this._setZoom(this.viewDuration * 0.6); return true; }
                if (inRect(localX, localY, this._zoomFitRect)) {
                    this.viewStart = 0;
                    this.viewDuration = this.audioBuffer?.duration || this.viewDuration;
                    node.setDirtyCanvas(true, true);
                    return true;
                }
                return true;
            }

            const waveLocalY = localY - TRANSPORT_H;
            if (waveLocalY >= 0 && waveLocalY < WAVE_H && this.audioBuffer) {
                const hit = this._markerHitboxes?.find(m => Math.abs(m.x - x) <= MARKER_HIT_PX);
                if (hit) {
                    const now = Date.now();
                    const isDouble = this._lastClickIndex === hit.index && (now - this._lastClickTime) < 350;
                    this._lastClickIndex = hit.index;
                    this._lastClickTime = now;
                    if (isDouble) {
                        if (this.times.length > 2) {
                            this.times.splice(hit.index, 1);
                            this.pushValue();
                        }
                        return true;
                    }
                    this._dragIndex = hit.index;
                    return true;
                }

                const t = this.viewStart + (x / (node.size?.[0] || 1)) * this.viewDuration;
                if (event.altKey) {
                    if (this.audioEl) this.audioEl.currentTime = Math.max(0, Math.min(this.audioBuffer.duration, t));
                    node.setDirtyCanvas(true, true);
                } else {
                    this._tryAddKeyframe(t);
                }
                return true;
            }

            return false;
        },

        _dragMarker(x) {
            const i = this._dragIndex;
            const dur = this.audioBuffer?.duration ?? Infinity;
            let t = this.viewStart + (x / (node.size?.[0] || 1)) * this.viewDuration;
            const prev = i > 0 ? this.times[i - 1] : null;
            const next = i < this.times.length - 1 ? this.times[i + 1] : null;
            let lo = 0, hi = dur;
            if (prev != null) { lo = Math.max(lo, prev + MIN_GAP); hi = Math.min(hi, prev + MAX_GAP); }
            if (next != null) { lo = Math.max(lo, next - MAX_GAP); hi = Math.min(hi, next - MIN_GAP); }
            t = Math.max(lo, Math.min(hi, t));
            this.times[i] = Math.round(t * 100) / 100;
            this.pushValue();
        },

        serializeValue() { return this.value; },

        destroy() {
            this._destroyed = true;
            if (this.audioEl) {
                try { this.audioEl.pause(); } catch { /* ignore */ }
            }
        },
    };
    return w;
}

// ─── extension registration ─────────────────────────────────────────────────

app.registerExtension({
    name: "Szandor.MusicVideoDirector",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;

        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            originalCreated?.apply(this, arguments);
            const node = this;

            const timelineWidget = makeTimelineWidget(node);
            const kfIndex = node.widgets?.findIndex(w => w.name === "keyframes_json") ?? -1;
            if (kfIndex >= 0) node.widgets.splice(kfIndex, 1, timelineWidget);
            else node.widgets.push(timelineWidget);
            node._szandorTimelineWidget = timelineWidget;

            for (let i = MAX_KEYFRAMES; i >= 1; i--) {
                const idx = node.widgets?.findIndex(w => w.name === promptWidgetName(i)) ?? -1;
                if (idx >= 0) node.widgets.splice(idx, 1);
            }
            for (let i = 1; i <= MAX_KEYFRAMES; i++) {
                node.widgets.push(makePromptWidget(node, i));
            }

            const audioW = node.widgets.find(w => w.name === "audio");
            if (audioW) {
                const originalCallback = audioW.callback;
                audioW.callback = function (value) {
                    try { originalCallback?.apply(this, arguments); } catch { /* ignore */ }
                    timelineWidget.setAudioFile(value);
                };
            }

            const backendW = node.widgets.find(w => w.name === "backend");
            if (backendW) {
                const originalCallback = backendW.callback;
                backendW.callback = function () {
                    try { originalCallback?.apply(this, arguments); } catch { /* ignore */ }
                    scheduleMvdSync(node);
                };
            }

            requestAnimationFrame(() => {
                if (node._szandorMvdSynced) return;
                if (audioW?.value) timelineWidget.setAudioFile(audioW.value);
                scheduleMvdSync(node);
            });
        };

        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            originalConfigure?.apply(this, arguments);
            const node = this;
            node._szandorMvdSynced = true;

            node._szandorTimelineWidget?.setTimesFromValue();
            const audioW = node.widgets?.find(w => w.name === "audio");
            if (audioW?.value) node._szandorTimelineWidget?.setAudioFile(audioW.value);

            scheduleMvdSync(node);
        };

        const originalRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            this._szandorTimelineWidget?.destroy();
            originalRemoved?.apply(this, arguments);
        };
    },
});
