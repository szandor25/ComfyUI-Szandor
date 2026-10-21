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
        empty.textContent = "No folder history";
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

function showDirectoryBrowser(node, onSelect) {
    closeHistoryDropdown();
    node._szandorCloseBrowser?.();
    const backdrop = document.createElement("div");
    backdrop.style.cssText = "position:fixed;inset:0;z-index:100001;background:#0009;display:grid;place-items:center";
    const panel = document.createElement("div");
    panel.style.cssText = "width:min(720px,90vw);max-height:85vh;padding:18px;background:#242424;color:#eee;border:1px solid #777;border-radius:10px;display:flex;flex-direction:column;gap:12px;font:13px sans-serif";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Browse folders and images");
    const title = document.createElement("strong");
    title.textContent = "Browse folders and images";
    const navigation = document.createElement("div");
    navigation.style.cssText = "display:flex;gap:8px";
    const button = (label, action) => {
        const element = document.createElement("button");
        element.type = "button";
        element.textContent = label;
        element.onclick = action;
        element.style.cssText = "padding:8px 12px;cursor:pointer;color:#eee;background:#39334b;border:1px solid #75689b;border-radius:5px";
        return element;
    };
    const path = document.createElement("input");
    path.value = node._szandorDirWidget?.value || "";
    path.placeholder = "Folder path on the ComfyUI server";
    path.setAttribute("aria-label", "Folder path");
    path.style.cssText = "flex:1;min-width:0;padding:8px;background:#171717;color:#eee;border:1px solid #666";
    const status = document.createElement("div");
    status.setAttribute("role", "status");
    const list = document.createElement("div");
    list.style.cssText = "overflow:auto;min-height:140px;max-height:50vh;border:1px solid #444;border-radius:5px";
    const footer = document.createElement("div");
    footer.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
    let current = null;
    let version = 0;
    let closed = false;
    const close = () => {
        closed = true;
        version++;
        backdrop.remove();
        if (node._szandorCloseBrowser === close) node._szandorCloseBrowser = null;
    };
    node._szandorCloseBrowser = close;
    const select = filename => {
        if (!current?.directory) return;
        onSelect(current.directory, filename);
        close();
    };
    const up = button("↑ Up", () => navigate(current.parent));
    up.title = "Open the parent folder";
    const roots = button("Roots", () => navigate(""));
    roots.title = "Show server drives or filesystem root";
    const open = button("Open", () => navigate(path.value.trim()));
    const useFolder = button("Use this folder", () => select(undefined));
    const navigate = async directory => {
        const request = ++version;
        path.value = directory;
        current = null;
        up.disabled = true;
        useFolder.disabled = true;
        list.replaceChildren();
        status.textContent = "Loading…";
        try {
            const response = await api.fetchApi(`/szandor/browse-directory?directory=${encodeURIComponent(directory)}`);
            const data = await response.json();
            if (request !== version || closed) return;
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            current = data;
            path.value = data.directory;
            up.disabled = data.parent == null;
            useFolder.disabled = !data.directory;
            status.textContent = data.directory
                ? `${data.directories.length} folders · ${data.images.length} images — click a folder to open it or an image to select it.`
                : "Choose a drive or root folder on the ComfyUI server.";
            const addEntry = (label, action) => {
                const entry = button(label, action);
                entry.style.cssText = "display:block;width:100%;text-align:left;padding:9px 12px;color:#eee;background:#292929;border:0;border-bottom:1px solid #444;cursor:pointer;overflow-wrap:anywhere";
                list.appendChild(entry);
            };
            for (const folder of data.directories) addEntry(`📁 ${folder.name}`, () => navigate(folder.path));
            for (const filename of data.images) addEntry(`▧ ${filename}`, () => select(filename));
            if (!data.directories.length && !data.images.length) {
                const empty = document.createElement("div");
                empty.textContent = "No subfolders or supported images in this folder.";
                empty.style.cssText = "padding:20px;color:#aaa";
                list.appendChild(empty);
            }
        } catch (error) {
            if (request !== version || closed) return;
            status.textContent = error.message || "Could not read this folder.";
        }
    };
    path.onkeydown = event => {
        if (event.key === "Enter") { event.preventDefault(); navigate(path.value.trim()); }
    };
    panel.onkeydown = event => {
        event.stopPropagation();
        if (event.key === "Escape") close();
        if (event.key === "Tab") {
            const controls = [...panel.querySelectorAll("input,button")].filter(control => !control.disabled);
            const index = controls.indexOf(document.activeElement);
            if (event.shiftKey && index === 0) { event.preventDefault(); controls.at(-1).focus(); }
            else if (!event.shiftKey && index === controls.length - 1) { event.preventDefault(); controls[0].focus(); }
        }
    };
    backdrop.onpointerdown = event => { if (event.target === backdrop) close(); };
    navigation.append(up, roots, path, open);
    footer.append(useFolder, button("Cancel", close));
    panel.append(title, navigation, status, list, footer);
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
    navigate(path.value);
    path.focus();
}

function makeDirectoryWidget(node, initialValue, onChange) {
    const HIST_BTN_W = 22;
    const BROWSE_BTN_W = 54;

    const widget = {
        type: "SZANDOR_DIR_ROW",
        name: "directory",
        value: initialValue || "",
        _historyRect: null,
        _browseRect: null,

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
            ctx.fillText("folder:", PAD + 8, top + height / 2);

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

            const browseX = histBtnX - BROWSE_BTN_W - 4;
            this._browseRect = { x: browseX, y: histBtnYLocal, w: BROWSE_BTN_W, h: histBtnH };
            ctx.fillStyle = "#39334b";
            ctx.beginPath();
            ctx.roundRect(browseX, top + histBtnYLocal, BROWSE_BTN_W, histBtnH, 4);
            ctx.fill();
            ctx.fillStyle = "#ddd";
            ctx.fillText("Browse", browseX + BROWSE_BTN_W / 2, top + height / 2);

            ctx.fillStyle = this.value ? "#ddd" : "#666";
            ctx.font = "11px monospace";
            const label = this.value || "(click to choose a folder)";
            const maxTextWidth = width - PAD * 2 - 66 - HIST_BTN_W - BROWSE_BTN_W - 4;
            let shown = label;
            while (shown.length > 1 && ctx.measureText(shown).width > maxTextWidth) {
                shown = shown.slice(1);
            }
            if (shown !== label) shown = "…" + shown;
            ctx.textAlign = "right";
            ctx.fillText(shown, browseX - 8, top + height / 2);
        },

        commit(value, filename) {
            const previous = this.value;
            this.value = (value ?? "").trim();
            if (this.value) pushHistory(this.value);
            onChange(this.value, filename ?? (previous === this.value ? undefined : ""));
        },

        mouse(event, pos, node) {
            if (event.type !== "pointerdown") return false;
            const x = pos[0];
            const y = pos[1] - (this.last_y ?? 0);
            const r = this._historyRect;
            const browse = this._browseRect;
            if (browse && x >= browse.x && x <= browse.x + browse.w && y >= browse.y && y <= browse.y + browse.h) {
                showDirectoryBrowser(node, (directory, filename) => this.commit(directory, filename));
                return true;
            }

            if (r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                const graphX = node.pos[0] + r.x;
                const graphY = node.pos[1] + (this.last_y ?? 0) + r.y + r.h + 2;
                const [clientX, clientY] = graphToClient(graphX, graphY);
                showHistoryDropdown(node, this, value => this.commit(value), clientX, clientY);
                return true;
            }

            app.canvas.prompt("Folder with images", this.value || "", value => this.commit(value), event);
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
            const request = this._refreshVersion = (this._refreshVersion ?? 0) + 1;
            this._selectionVersion = (this._selectionVersion ?? 0) + 1;
            const directory = this.currentDirectory();
            const wanted = preferredName !== undefined ? preferredName : this.value;
            this.images = [];
            this.index = -1;
            this.value = wanted || "";
            this.thumb = null;
            if (!directory) {
                this.value = "";
                this.signature = "";
                this.loading = false;
                this.stale = false;
                node.setDirtyCanvas(true, true);
                return;
            }

            this.loading = true;
            node.setDirtyCanvas(true, true);

            const { images, signature } = await listImages(directory);
            if (request !== this._refreshVersion || directory !== this.currentDirectory()) return;
            this.images = images || [];
            this.signature = signature || "";
            this.stale = false;
            this.loading = false;

            let idx = this.images.indexOf(wanted);
            if (idx < 0) idx = this.images.length ? 0 : -1;
            await this.setIndex(idx, true);
        },

        async setIndex(idx, force = false) {
            if (!force && idx === this.index) return;
            const request = this._selectionVersion = (this._selectionVersion ?? 0) + 1;
            this.index = idx;
            this.value = idx >= 0 ? this.images[idx] : "";
            this.thumb = null;
            node.setDirtyCanvas(true, true);
            if (this.value) {
                const directory = this.currentDirectory();
                const thumb = await fetchThumb(directory, this.value);
                if (request !== this._selectionVersion || directory !== this.currentDirectory()) return;
                this.thumb = thumb;
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
            const countText = hasImages ? `${this.index + 1} / ${this.images.length}` : "no images";
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
                let msg = "Choose a folder with images";
                if (this.loading) msg = "Loading...";
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
            const dirWidget = makeDirectoryWidget(node, initialDir, (_directory, filename) => preview.refresh(filename));
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
                if (directory === preview.currentDirectory() && signature && preview.signature && signature !== preview.signature) {
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
            this._szandorCloseBrowser?.();
            origRemoved?.apply(this, arguments);
        };
    },
});
