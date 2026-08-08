import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_TYPE = "SzandorDirectoryImageLoader";
const MIN_WIDTH = 280;
const DIR_ROW_H = 30;
const ARROW_ROW_H = 26;
const INFO_ROW_H = 34;
const DEFAULT_PREVIEW_H = 220;
const PAD = 8;
const POLL_MS = 5000;
const HISTORY_KEY = "szandor.dirImageLoader.recentDirs";
const HISTORY_MAX = 10;

// ─── historia ostatnio wybieranych katalogów (localStorage, wspólna dla node'a) ─

function loadHistory() {
    try {
        const arr = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
        return Array.isArray(arr) ? arr.filter(x => typeof x === "string" && x) : [];
    } catch {
        return [];
    }
}

function saveHistory(list) {
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
    } catch {
        // localStorage niedostępny (np. tryb prywatny) — po prostu bez historii
    }
}

function pushHistory(directory) {
    const normalized = (directory || "").trim();
    if (!normalized) return;
    const list = loadHistory().filter(x => x.toLowerCase() !== normalized.toLowerCase());
    list.unshift(normalized);
    saveHistory(list);
}

function removeFromHistory(directory) {
    saveHistory(loadHistory().filter(x => x.toLowerCase() !== directory.toLowerCase()));
}

// ─── konwersja współrzędnych grafu → ekranu (dla pozycjonowania dropdownu) ─────

function graphToClient(gx, gy) {
    const rect = app.canvasEl.getBoundingClientRect();
    const scale = app.canvas.ds.scale ?? 1;
    const offset = app.canvas.ds.offset ?? [0, 0];
    return [rect.left + (gx + offset[0]) * scale, rect.top + (gy + offset[1]) * scale];
}

let historyDropdownEl = null;
let historyDropdownCloseHandler = null;

function closeHistoryDropdown() {
    historyDropdownEl?.remove();
    historyDropdownEl = null;
    if (historyDropdownCloseHandler) {
        document.removeEventListener("pointerdown", historyDropdownCloseHandler, true);
        historyDropdownCloseHandler = null;
    }
}

function showHistoryDropdown(node, widget, onChange, clientX, clientY) {
    closeHistoryDropdown();
    const history = loadHistory();

    const panel = document.createElement("div");
    Object.assign(panel.style, {
        position: "fixed",
        zIndex: "100000",
        left: `${clientX}px`,
        top: `${clientY}px`,
        minWidth: "260px",
        maxWidth: "480px",
        maxHeight: "260px",
        overflowY: "auto",
        background: "#242424",
        border: "1px solid #666",
        borderRadius: "6px",
        boxShadow: "0 12px 36px rgba(0,0,0,.6)",
        padding: "4px",
    });

    if (!history.length) {
        const empty = document.createElement("div");
        empty.textContent = "Brak historii katalogów";
        empty.style.cssText = "padding:10px 14px;color:#888;font-size:12px;text-align:center;font-family:sans-serif";
        panel.appendChild(empty);
    } else {
        for (const dir of history) {
            const row = document.createElement("div");
            Object.assign(row.style, {
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 8px",
                cursor: "pointer",
                borderRadius: "4px",
                fontSize: "12px",
                color: "#ddd",
                fontFamily: "monospace",
            });
            row.onmouseenter = () => { row.style.background = "#3a3550"; };
            row.onmouseleave = () => { row.style.background = "transparent"; };

            const label = document.createElement("span");
            label.textContent = dir;
            Object.assign(label.style, {
                flex: "1",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
            });
            label.onclick = () => {
                onChange(dir);
                node.setDirtyCanvas(true, true);
                closeHistoryDropdown();
            };

            const removeBtn = document.createElement("span");
            removeBtn.textContent = "✕";
            Object.assign(removeBtn.style, { color: "#a55", cursor: "pointer", padding: "0 4px" });
            removeBtn.onclick = event => {
                event.stopPropagation();
                removeFromHistory(dir);
                showHistoryDropdown(node, widget, onChange, clientX, clientY);
            };

            row.append(label, removeBtn);
            panel.appendChild(row);
        }
    }

    document.body.appendChild(panel);
    historyDropdownEl = panel;

    historyDropdownCloseHandler = event => {
        if (!panel.contains(event.target)) closeHistoryDropdown();
    };
    setTimeout(() => document.addEventListener("pointerdown", historyDropdownCloseHandler, true), 0);
}

// ─── thumbnail cache ──────────────────────────────────────────────────────────

const thumbCache = new Map();

function thumbKey(directory, name) {
    return `${directory} ${name}`;
}

function fetchThumb(directory, name) {
    if (!directory || !name) return Promise.resolve(null);
    const key = thumbKey(directory, name);
    if (thumbCache.has(key)) return Promise.resolve(thumbCache.get(key));
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => { thumbCache.set(key, img); resolve(img); };
        img.onerror = () => { thumbCache.set(key, null); resolve(null); };
        img.src = api.apiURL(
            `/szandor/dir-image-view?directory=${encodeURIComponent(directory)}&filename=${encodeURIComponent(name)}`
        );
    });
}

async function listImages(directory) {
    if (!directory) return { images: [], signature: "" };
    try {
        const res = await api.fetchApi(`/szandor/dir-images?directory=${encodeURIComponent(directory)}`);
        if (!res.ok) return { images: [], signature: "" };
        return await res.json();
    } catch {
        return { images: [], signature: "" };
    }
}

// ─── directory widget (w pełni własny, stała wysokość) ────────────────────────

function makeDirectoryWidget(node, initialValue, onChange) {
    const HIST_BTN_W = 22;

    const widget = {
        type: "SZANDOR_DIR_ROW",
        name: "directory",
        value: initialValue || "",
        _historyRect: null,

        computeSize(width) {
            return [width, DIR_ROW_H];
        },

        draw(ctx, _node, width, y) {
            const height = DIR_ROW_H;
            const top = y;

            ctx.fillStyle = "#222";
            ctx.strokeStyle = "#555";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(PAD, top + 2, width - PAD * 2, height - 4, 6);
            ctx.fill();
            ctx.stroke();

            ctx.textBaseline = "middle";
            ctx.fillStyle = "#888";
            ctx.font = "10px sans-serif";
            ctx.textAlign = "left";
            ctx.fillText("katalog:", PAD + 8, top + height / 2);

            // przycisk historii (lokalne współrzędne, bez "top" — patrz mouse())
            const histBtnX = width - PAD - 4 - HIST_BTN_W;
            const histBtnYLocal = 4;
            const histBtnH = height - 8;
            this._historyRect = { x: histBtnX, y: histBtnYLocal, w: HIST_BTN_W, h: histBtnH };
            ctx.fillStyle = "#333";
            ctx.beginPath();
            ctx.roundRect(histBtnX, top + histBtnYLocal, HIST_BTN_W, histBtnH, 4);
            ctx.fill();
            ctx.fillStyle = "#aaa";
            ctx.font = "11px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("🕘", histBtnX + HIST_BTN_W / 2, top + height / 2);

            ctx.fillStyle = this.value ? "#ddd" : "#666";
            ctx.font = "11px monospace";
            const label = this.value || "(kliknij, aby wskazać katalog)";
            const maxTextWidth = width - PAD * 2 - 66 - HIST_BTN_W;
            let shown = label;
            while (shown.length > 1 && ctx.measureText(shown).width > maxTextWidth) {
                shown = shown.slice(1);
            }
            if (shown !== label) shown = "…" + shown;
            ctx.textAlign = "right";
            ctx.fillText(shown, histBtnX - 8, top + height / 2);
        },

        commit(value) {
            this.value = (value ?? "").trim();
            if (this.value) pushHistory(this.value);
            onChange(this.value);
        },

        mouse(event, pos, node) {
            if (event.type !== "pointerdown") return false;
            const x = pos[0];
            const y = pos[1] - (this.last_y ?? 0);
            const r = this._historyRect;

            if (r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                const graphX = node.pos[0] + r.x;
                const graphY = node.pos[1] + (this.last_y ?? 0) + r.y + r.h + 2;
                const [clientX, clientY] = graphToClient(graphX, graphY);
                showHistoryDropdown(node, this, value => this.commit(value), clientX, clientY);
                return true;
            }

            app.canvas.prompt("Katalog z obrazami", this.value || "", value => this.commit(value), event);
            return true;
        },

        serializeValue() {
            return this.value;
        },
    };
    return widget;
}

// ─── preview widget ───────────────────────────────────────────────────────────

function makePreviewWidget(node) {
    const widget = {
        type: "SZANDOR_DIR_PREVIEW",
        name: "filename",
        value: "",
        images: [],
        index: -1,
        signature: "",
        thumb: null,
        loading: false,
        stale: false,
        _leftArrowRect: null,
        _rightArrowRect: null,
        _refreshRect: null,

        computeSize(width) {
            return [width, ARROW_ROW_H + DEFAULT_PREVIEW_H + INFO_ROW_H];
        },

        currentDirectory() {
            return (node._szandorDirWidget?.value || "").trim();
        },

        async refresh(preferredName) {
            const directory = this.currentDirectory();
            if (!directory) {
                this.images = [];
                this.index = -1;
                this.thumb = null;
                this.stale = false;
                node.setDirtyCanvas(true, true);
                return;
            }

            this.loading = true;
            node.setDirtyCanvas(true, true);

            const { images, signature } = await listImages(directory);
            this.images = images || [];
            this.signature = signature || "";
            this.stale = false;
            this.loading = false;

            const wanted = preferredName !== undefined ? preferredName : this.value;
            let idx = this.images.indexOf(wanted);
            if (idx < 0) idx = this.images.length ? 0 : -1;
            await this.setIndex(idx, true);
        },

        async setIndex(idx, force = false) {
            if (!force && idx === this.index) return;
            this.index = idx;
            this.value = idx >= 0 ? this.images[idx] : "";
            this.thumb = null;
            node.setDirtyCanvas(true, true);
            if (this.value) {
                this.thumb = await fetchThumb(this.currentDirectory(), this.value);
            }
            node.setDirtyCanvas(true, true);
        },

        draw(ctx, _node, width, y) {
            // Uwaga: nie ufamy parametrowi "height" przekazywanemu przez LiteGraph —
            // w tym środowisku bywa on niezgodny z computeSize(), co powodowało
            // ucinanie/nakładanie się treści. Układ liczymy w oparciu o własne,
            // stałe wysokości sekcji (te same, które zwraca computeSize()).
            const height = ARROW_ROW_H + DEFAULT_PREVIEW_H + INFO_ROW_H;
            const top = y;
            const hasImages = this.images.length > 0;

            ctx.fillStyle = "#181818";
            ctx.fillRect(PAD, top, width - PAD * 2, height);
            ctx.strokeStyle = "#3a3a3a";
            ctx.lineWidth = 1;
            ctx.strokeRect(PAD, top, width - PAD * 2, height);

            // ── arrow / status row ──
            // Prostokąty trafień myszy przechowujemy w układzie LOKALNYM (bez "top"),
            // bo mouse() dostaje pozycję już pomniejszoną o last_y — do rysowania
            // dodajemy "top" osobno w miejscu użycia.
            const rowYLocal = 3;
            const rowY = top + rowYLocal;
            const rowH = ARROW_ROW_H - 6;
            const arrowW = 26;

            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            this._leftArrowRect = { x: PAD + 4, y: rowYLocal, w: arrowW, h: rowH };
            ctx.fillStyle = hasImages ? "#333" : "#222";
            ctx.fillRect(this._leftArrowRect.x, rowY, arrowW, rowH);
            ctx.fillStyle = hasImages ? "#ddd" : "#555";
            ctx.font = "bold 12px sans-serif";
            ctx.fillText("◀", this._leftArrowRect.x + arrowW / 2, rowY + rowH / 2 + 1);

            this._rightArrowRect = { x: width - PAD - 4 - arrowW, y: rowYLocal, w: arrowW, h: rowH };
            ctx.fillStyle = hasImages ? "#333" : "#222";
            ctx.fillRect(this._rightArrowRect.x, rowY, arrowW, rowH);
            ctx.fillStyle = hasImages ? "#ddd" : "#555";
            ctx.fillText("▶", this._rightArrowRect.x + arrowW / 2, rowY + rowH / 2 + 1);

            const refreshW = 22;
            this._refreshRect = { x: this._rightArrowRect.x - 6 - refreshW, y: rowYLocal, w: refreshW, h: rowH };
            ctx.fillStyle = this.loading ? "#2a4a6a" : (this.stale ? "#5a3a1a" : "#2a2a2a");
            ctx.fillRect(this._refreshRect.x, rowY, refreshW, rowH);
            ctx.fillStyle = this.loading ? "#8ec3ff" : (this.stale ? "#ffb35c" : "#999");
            ctx.font = "13px sans-serif";
            ctx.fillText("⟳", this._refreshRect.x + refreshW / 2, rowY + rowH / 2 + 1);
            if (this.stale && !this.loading) {
                ctx.fillStyle = "#ff5c5c";
                ctx.beginPath();
                ctx.arc(this._refreshRect.x + refreshW - 3, rowY + 3, 3, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.fillStyle = "#aaa";
            ctx.font = "11px sans-serif";
            const countText = hasImages ? `${this.index + 1} / ${this.images.length}` : "brak obrazów";
            ctx.fillText(countText, width / 2, rowY + rowH / 2 + 1);

            // ── thumbnail ──
            const thumbTop = top + ARROW_ROW_H;
            const thumbH = height - ARROW_ROW_H - INFO_ROW_H;
            const innerX = PAD + 4;
            const innerW = width - PAD * 2 - 8;
            ctx.fillStyle = "#101010";
            ctx.fillRect(innerX, thumbTop, innerW, thumbH);

            if (this.thumb && thumbH > 4) {
                const s = Math.min(innerW / this.thumb.width, thumbH / this.thumb.height);
                const tw = this.thumb.width * s;
                const th = this.thumb.height * s;
                const tx = innerX + (innerW - tw) / 2;
                const ty = thumbTop + (thumbH - th) / 2;
                ctx.drawImage(this.thumb, tx, ty, tw, th);
            } else {
                ctx.fillStyle = "#555";
                ctx.font = "11px sans-serif";
                let msg = "Wskaż katalog z obrazami";
                if (this.loading) msg = "Ładowanie...";
                else if (hasImages) msg = "";
                ctx.fillText(msg, width / 2, thumbTop + thumbH / 2);
            }

            // ── info row (nazwa + rozdzielczość) ──
            const infoTop = top + height - INFO_ROW_H;
            ctx.fillStyle = "#ccc";
            ctx.font = "11px monospace";
            const name = this.value || "";
            const shownName = name.length > 42 ? "…" + name.slice(-39) : (name || "-");
            ctx.fillText(shownName, width / 2, infoTop + 12);

            ctx.fillStyle = "#888";
            ctx.font = "10px monospace";
            const resText = this.thumb
                ? `${this.thumb.naturalWidth || this.thumb.width} × ${this.thumb.naturalHeight || this.thumb.height}`
                : "";
            ctx.fillText(resText, width / 2, infoTop + 26);
        },

        mouse(event, pos) {
            if (event.type !== "pointerdown") return false;
            const x = pos[0];
            const y = pos[1] - (this.last_y ?? 0);
            const inRect = r => r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

            if (inRect(this._refreshRect)) {
                this.refresh(this.value);
                return true;
            }
            if (!this.images.length) return false;
            if (inRect(this._leftArrowRect)) {
                this.setIndex((this.index - 1 + this.images.length) % this.images.length);
                return true;
            }
            if (inRect(this._rightArrowRect)) {
                this.setIndex((this.index + 1) % this.images.length);
                return true;
            }
            return false;
        },

        serializeValue() {
            return this.value;
        },
    };
    return widget;
}

// ─── extension ────────────────────────────────────────────────────────────────

app.registerExtension({
    name: "Szandor.DirectoryImageLoader",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;

        const origCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origCreated?.apply(this, arguments);
            const node = this;

            // Usuń oba auto-wygenerowane widgety STRING ("directory", "filename") i
            // zastąp je własnymi, w pełni kontrolowanymi widgetami o stałej wysokości —
            // dzięki temu nie ma niezgodności w liczeniu wysokości między nimi.
            const dirIdx = node.widgets?.findIndex(w => w.name === "directory") ?? -1;
            const initialDir = dirIdx >= 0 ? node.widgets[dirIdx].value : "";
            if (dirIdx >= 0) node.widgets.splice(dirIdx, 1);

            const fnIdx = node.widgets?.findIndex(w => w.name === "filename") ?? -1;
            if (fnIdx >= 0) node.widgets.splice(fnIdx, 1);

            const preview = makePreviewWidget(node);
            const dirWidget = makeDirectoryWidget(node, initialDir, () => preview.refresh(""));
            node.widgets.push(dirWidget, preview);
            node._szandorPreview = preview;
            node._szandorDirWidget = dirWidget;

            const requiredSize = node.computeSize();
            node.setSize([
                Math.max(node.size[0], requiredSize[0], MIN_WIDTH),
                Math.max(node.size[1], requiredSize[1]),
            ]);

            node._szandorPollTimer = setInterval(async () => {
                if (!preview || preview.loading) return;
                const directory = preview.currentDirectory();
                if (!directory) return;
                const { signature } = await listImages(directory);
                if (signature && preview.signature && signature !== preview.signature) {
                    preview.stale = true;
                    node.setDirtyCanvas(true, true);
                }
            }, POLL_MS);

            requestAnimationFrame(() => {
                if (!node._szandorConfigured) preview.refresh("");
            });
        };

        // onConfigure jest wywoływane po przywróceniu wartości widgetów z workflow —
        // wartości są odtwarzane pozycyjnie, więc dirWidget.value / preview.value
        // zawierają już zapisany katalog i nazwę pliku.
        const origConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (config) {
            origConfigure?.apply(this, arguments);
            const node = this;
            node._szandorConfigured = true;
            const preview = node._szandorPreview;
            if (preview) {
                const restoredName = preview.value || "";
                requestAnimationFrame(() => preview.refresh(restoredName));
            }
        };

        const origRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            if (this._szandorPollTimer) clearInterval(this._szandorPollTimer);
            origRemoved?.apply(this, arguments);
        };
    },
});
