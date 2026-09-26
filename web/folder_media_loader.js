import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_TYPE = "SzandorFolderMediaLoader";
const DEFAULT_SIZE = [380, 640];
const MIN_SIZE = [300, 420];
const TICK_MS = 300;
const LIST_POLL_MS = 5000;
const HISTORY_KEY = "szandor.folderMediaLoader.recentDirs";
const DEFAULTS_KEY = "szandor.folderMediaLoader.defaults";
const HISTORY_MAX = 12;
const REMEMBERED = ["media_filter", "default_time", "fps"];
const BADGES = [["image", "IMG"], ["video", "VIDEO"], ["audio", "AUDIO"], ["txt", "TXT"], ["json", "JSON"]];

// ─── pamięć w przeglądarce: historia katalogów i ustawienia dla nowych nodów ──

function readStore(key, fallback) {
    try {
        const value = JSON.parse(localStorage.getItem(key) ?? "null");
        return value ?? fallback;
    } catch {
        return fallback;
    }
}

function writeStore(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // localStorage niedostępny — node działa dalej, tylko bez zapamiętywania
    }
}

function loadHistory() {
    const list = readStore(HISTORY_KEY, []);
    return Array.isArray(list) ? list.filter(x => typeof x === "string" && x) : [];
}

function pushHistory(directory) {
    if (!directory) return;
    const list = loadHistory().filter(x => x !== directory);
    list.unshift(directory);
    writeStore(HISTORY_KEY, list.slice(0, HISTORY_MAX));
}

function validSize(size) {
    return size?.length === 2 && Array.from(size).every(v => Number.isFinite(v) && v > 0);
}

function installStyles() {
    if (document.getElementById("szandor-fml-style")) return;
    const link = document.createElement("link");
    link.id = "szandor-fml-style";
    link.rel = "stylesheet";
    link.href = new URL("./folder_media_loader.css", import.meta.url).href;
    document.head.append(link);
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function query(params) {
    return Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v ?? "")}`).join("&");
}

function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return "-";
    return `${Number(seconds.toFixed(3))} s`;
}

// ─── panel ────────────────────────────────────────────────────────────────────

function createPanel(node, initialDirectory) {
    installStyles();
    const root = el("div", "szandor-fml");

    const dirRow = el("div", "fml-row");
    const dirInput = el("input", "fml-dir");
    dirInput.type = "text";
    dirInput.placeholder = "Ścieżka katalogu na komputerze z ComfyUI…";
    dirInput.spellcheck = false;
    dirInput.value = initialDirectory || "";
    const history = el("select", "fml-history");
    history.title = "Ostatnio używane katalogi";
    const refresh = el("button", "", "⟳");
    refresh.type = "button";
    refresh.title = "Odśwież listę plików";
    dirRow.append(dirInput, history, refresh);

    const navRow = el("div", "fml-row");
    const prev = el("button", "", "◀");
    prev.type = "button";
    prev.title = "Poprzednia pozycja (ustawia seed)";
    const counter = el("div", "fml-counter", "—");
    const next = el("button", "", "▶");
    next.type = "button";
    next.title = "Następna pozycja (ustawia seed)";
    const queueAll = el("button", "fml-queue-all", "⏭ Wszystkie");
    queueAll.type = "button";
    queueAll.title = "Dodaje do kolejki po jednym zadaniu dla każdej pozycji: seed od 0, tryb increment.";
    navRow.append(prev, counter, next, queueAll);

    const stage = el("div", "fml-stage");
    const badges = el("div", "fml-badges");
    const placeholder = el("div", "fml-placeholder");
    const img = el("img");
    img.alt = "";
    img.hidden = true;
    const play = el("button", "fml-play", "▶ wideo");
    play.type = "button";
    play.hidden = true;
    stage.append(img, placeholder, badges, play);

    const audio = el("audio");
    audio.controls = true;
    audio.preload = "none";
    audio.hidden = true;

    const meta = el("div", "fml-meta");
    const nameEl = el("span", "fml-name", "-");
    const resEl = el("span", "fml-res");
    const timeEl = el("span", "fml-time");
    meta.append(nameEl, resEl, timeEl);

    const promptEl = el("pre", "fml-prompt fml-empty", "(brak promptu)");
    promptEl.title = "Prompt z pliku .json (pole prompt) lub .txt — tylko podgląd";
    const status = el("div", "fml-status");

    root.append(dirRow, navRow, stage, audio, meta, promptEl, status);

    for (const control of [dirInput, history, refresh, prev, next, queueAll, play, audio, promptEl]) {
        control.addEventListener("pointerdown", e => e.stopPropagation());
        control.addEventListener("keydown", e => e.stopPropagation());
    }
    promptEl.addEventListener("wheel", e => e.stopPropagation(), { passive: true });

    const state = {
        directory: dirInput.value.trim(),
        items: [],
        signature: "",
        exists: false,
        index: -1,
        key: "",
        itemKey: "",
        info: null,
        lastLoaded: null,
        listRequest: 0,
        itemRequest: 0,
        objectUrl: null,
        disposed: false,
        queueing: false,
    };

    let widget = null;
    const widgetByName = name => node.widgets?.find(w => w.name === name);
    const seedWidget = () => widgetByName("seed");
    const filterValue = () => widgetByName("media_filter")?.value ?? "wszystko";
    const numberValue = (name, fallback) => {
        const value = Number(widgetByName(name)?.value);
        return Number.isFinite(value) ? value : fallback;
    };

    function fillHistory() {
        history.replaceChildren(el("option", "", "🕘"));
        history.firstChild.value = "";
        for (const dir of loadHistory()) {
            const option = el("option", "", dir);
            option.value = dir;
            history.append(option);
        }
        history.value = "";
    }

    function setDirectory(value, { remember = true } = {}) {
        const directory = (value ?? "").trim();
        dirInput.value = directory;
        if (directory === state.directory) return;
        state.directory = directory;
        if (remember && directory) {
            pushHistory(directory);
            fillHistory();
            if (node._szandorFmlReady) saveDefaults();
        }
        widget?.callback?.(directory);
        node.graph?.change?.();
        reloadList();
    }

    function setSeed(value) {
        const seed = seedWidget();
        if (!seed) return;
        seed.value = value;
        seed.callback?.(value);
        node.graph?.change?.();
        node.setDirtyCanvas?.(true, true);
        tick();
    }

    function step(delta) {
        const count = state.items.length;
        if (!count) return;
        setSeed(((state.index + delta) % count + count) % count);
    }

    async function reloadList() {
        const request = ++state.listRequest;
        const directory = state.directory;
        if (!directory) {
            Object.assign(state, { items: [], signature: "", exists: false });
            dirInput.classList.remove("fml-missing");
            state.key = "";
            tick();
            return;
        }
        status.textContent = "Wczytywanie listy…";
        try {
            const res = await api.fetchApi(`/szandor/folder-media/list?${query({ directory, filter: filterValue() })}`);
            const data = res.ok ? await res.json() : { items: [], exists: false };
            if (state.disposed || request !== state.listRequest) return;
            state.items = data.items ?? [];
            state.signature = data.signature ?? "";
            state.exists = !!data.exists;
        } catch {
            if (request !== state.listRequest) return;
            state.items = [];
            state.exists = false;
        }
        dirInput.classList.toggle("fml-missing", !state.exists);
        state.key = "";
        tick();
    }

    async function pollList() {
        if (!state.directory || state.disposed) return;
        try {
            const res = await api.fetchApi(
                `/szandor/folder-media/list?${query({ directory: state.directory, filter: filterValue() })}`
            );
            if (!res.ok) return;
            const data = await res.json();
            if (data.signature !== state.signature) reloadList();
        } catch {
            // chwilowy brak połączenia — spróbujemy przy następnym odpytaniu
        }
    }

    function clearMedia() {
        img.hidden = true;
        img.removeAttribute("src");
        if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
        state.objectUrl = null;
        stage.querySelector("video")?.remove();
        audio.pause();
        audio.removeAttribute("src");
        audio.hidden = true;
        play.hidden = true;
        badges.replaceChildren();
        resEl.textContent = "";
        timeEl.textContent = "";
    }

    function showPlaceholder(icon, text) {
        placeholder.replaceChildren();
        if (icon) placeholder.append(el("big", "", icon));
        placeholder.append(document.createTextNode(text));
        placeholder.hidden = false;
    }

    function fileUrl(filename) {
        return api.apiURL(`/szandor/folder-media/file?${query({ directory: state.directory, filename })}`);
    }

    function renderInfo() {
        const info = state.info;
        if (!info) return;
        const fps = numberValue("fps", 24);
        const frames = Math.round(info.time * fps);
        timeEl.textContent = `⏱ ${formatTime(info.time)} (${info.time_source}) · ${frames} kl.`;
        const prompt = info.prompt ?? "";
        promptEl.textContent = prompt || "(brak promptu)";
        promptEl.classList.toggle("fml-empty", !prompt);
    }

    async function showItem(item) {
        const request = ++state.itemRequest;
        clearMedia();
        state.info = null;
        nameEl.textContent = item.name;
        nameEl.title = BADGES.map(([k]) => item[k]).filter(Boolean).join("\n");
        for (const [kind, label] of BADGES) {
            if (item[kind]) badges.append(el("span", `fml-badge b-${kind}`, label));
        }
        promptEl.textContent = "…";

        const hasVisual = item.image || item.video;
        if (hasVisual) showPlaceholder("", "Ładowanie podglądu…");
        else showPlaceholder(item.audio ? "🔊" : "📝", item.audio ? "Plik audio" : "Tylko prompt");
        if (item.audio) {
            audio.src = fileUrl(item.audio);
            audio.hidden = false;
        }

        const infoPromise = api.fetchApi(`/szandor/folder-media/info?${query({
            directory: state.directory, name: item.name, default_time: numberValue("default_time", 5),
        })}`).then(r => (r.ok ? r.json() : null)).catch(() => null);

        if (hasVisual) {
            try {
                const res = await api.fetchApi(`/szandor/folder-media/preview?${query({
                    directory: state.directory, name: item.name,
                })}`);
                if (state.disposed || request !== state.itemRequest) return;
                if (!res.ok) throw new Error(await res.text());
                const blob = await res.blob();
                if (state.disposed || request !== state.itemRequest) return;
                state.objectUrl = URL.createObjectURL(blob);
                img.src = state.objectUrl;
                img.hidden = false;
                placeholder.hidden = true;
                const w = res.headers.get("X-Source-Width");
                const h = res.headers.get("X-Source-Height");
                resEl.textContent = w && h ? `${w} × ${h}` : "";
                play.hidden = !item.video;
            } catch (err) {
                if (request !== state.itemRequest) return;
                showPlaceholder("⚠", `Brak podglądu: ${String(err.message || err).slice(0, 160)}`);
            }
        }

        const info = await infoPromise;
        if (state.disposed || request !== state.itemRequest) return;
        state.info = info ?? { prompt: "", time: numberValue("default_time", 5), time_source: "domyślny" };
        renderInfo();
        renderStatus();
    }

    function renderStatus() {
        const warning = state.info?.warning;
        status.classList.toggle("fml-warn", !!warning);
        if (warning) {
            status.textContent = `⚠ ${warning}`;
        } else if (state.lastLoaded) {
            const l = state.lastLoaded;
            status.textContent = `Ostatnio wczytany: ${l.name} (${l.index + 1}/${l.count}) · ${formatTime(l.time)}`;
        } else {
            status.textContent = "Seed wybiera pozycję: indeks = seed mod liczba pozycji.";
        }
        status.title = status.textContent;
    }

    play.addEventListener("click", () => {
        const item = state.items[state.index];
        if (!item?.video) return;
        const video = el("video");
        video.src = fileUrl(item.video);
        video.controls = true;
        video.autoplay = true;
        video.addEventListener("pointerdown", e => e.stopPropagation());
        img.hidden = true;
        play.hidden = true;
        stage.prepend(video);
    });

    // Wywoływane cyklicznie: reaguje na zmiany seeda (także z control_after_generate),
    // filtra i ustawień czasu bez zależności od wewnętrznych zdarzeń frontendu.
    function tick() {
        if (state.disposed) return;
        const count = state.items.length;
        const seed = Number(seedWidget()?.value ?? 0);
        const index = count ? ((Math.trunc(seed) % count) + count) % count : -1;
        const key = `${state.signature}|${index}`;
        prev.disabled = next.disabled = count < 2;
        queueAll.disabled = !count || state.queueing;
        queueAll.textContent = count ? `⏭ Wszystkie (${count})` : "⏭ Wszystkie";

        if (key !== state.key) {
            state.key = key;
            state.index = index;
            if (!count) {
                clearMedia();
                state.info = null;
                nameEl.textContent = "-";
                promptEl.textContent = "(brak promptu)";
                promptEl.classList.add("fml-empty");
                counter.textContent = state.directory ? "brak plików" : "—";
                showPlaceholder("📁", !state.directory
                    ? "Wpisz ścieżkę katalogu z obrazami, wideo, audio i promptami (.txt / .json)"
                    : state.exists ? "Brak pasujących plików w katalogu" : "Katalog nie istnieje");
                renderStatus();
            } else {
                showItem(state.items[index]);
            }
        }
        if (count) counter.textContent = `${index + 1} / ${count}   ·   seed ${seed}`;
    }

    let settingsKey = "";
    function watchSettings() {
        const filter = filterValue();
        const key = `${filter}|${numberValue("default_time", 5)}|${numberValue("fps", 24)}`;
        if (key === settingsKey) return;
        const filterChanged = settingsKey && settingsKey.split("|")[0] !== filter;
        const timeChanged = settingsKey && !filterChanged;
        settingsKey = key;
        if (filterChanged) reloadList();
        else if (timeChanged && state.items[state.index]) {
            if (state.info?.time_source === "domyślny") state.key = "";
            else renderInfo();
        }
        if (node._szandorFmlReady) saveDefaults();
    }

    function saveDefaults() {
        const defaults = readStore(DEFAULTS_KEY, {}) || {};
        for (const name of REMEMBERED) {
            const w = widgetByName(name);
            if (w) defaults[name] = w.value;
        }
        const control = seedWidget()?.linkedWidgets?.[0] ?? widgetByName("control_after_generate");
        if (control) defaults.control_after_generate = control.value;
        if (state.directory) defaults.directory = state.directory;
        if (validSize(node.size)) defaults.size = Array.from(node.size);
        writeStore(DEFAULTS_KEY, defaults);
    }

    dirInput.addEventListener("change", () => setDirectory(dirInput.value));
    dirInput.addEventListener("keydown", e => {
        if (e.key === "Enter") setDirectory(dirInput.value);
    });
    history.addEventListener("focus", fillHistory);
    history.addEventListener("change", () => {
        if (history.value) setDirectory(history.value);
        history.value = "";
    });
    refresh.addEventListener("click", () => {
        state.signature = "";
        reloadList();
    });
    prev.addEventListener("click", () => step(-1));
    queueAll.addEventListener("click", async () => {
        const count = state.items.length;
        const seed = seedWidget();
        if (!count || !seed || state.queueing) return;
        if (!confirm(`Dodać do kolejki ${count} zadań — po jednym dla każdej pozycji z katalogu?`)) return;
        const control = seed.linkedWidgets?.[0] ?? widgetByName("control_after_generate");
        // increment po każdym zadaniu przechodzi przez pozycje 0, 1, …, count-1.
        if (control) control.value = "increment";
        setSeed(0);
        state.queueing = true;
        tick();
        try {
            await app.queuePrompt(0, count);
        } catch (err) {
            status.textContent = `⚠ Nie udało się dodać do kolejki: ${err?.message ?? err}`;
            status.classList.add("fml-warn");
        } finally {
            state.queueing = false;
            tick();
        }
    });
    next.addEventListener("click", () => step(1));

    fillHistory();
    const ticker = setInterval(() => { watchSettings(); tick(); }, TICK_MS);
    const poller = setInterval(pollList, LIST_POLL_MS);

    widget = node.addDOMWidget("directory", "SZANDOR_FOLDER_MEDIA", root, {
        getValue: () => state.directory,
        setValue: value => setDirectory(typeof value === "string" ? value : "", { remember: false }),
        getMinHeight: () => 300,
        hideOnZoom: false,
    });
    widget.serializeValue = () => state.directory;

    return {
        widget,
        setDirectory,
        saveDefaults,
        reloadList,
        onExecuted(message) {
            const loaded = message?.szandor_loaded?.[0];
            if (!loaded) return;
            state.lastLoaded = loaded;
            renderStatus();
        },
        dispose() {
            state.disposed = true;
            clearInterval(ticker);
            clearInterval(poller);
            clearMedia();
        },
    };
}

// ─── rejestracja ──────────────────────────────────────────────────────────────

app.registerExtension({
    name: "Szandor.FolderMediaLoader",

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;

        const origCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function (...args) {
            const result = origCreated?.apply(this, args);
            const node = this;

            // Panel zastępuje natywny widżet "directory" w tym samym miejscu listy,
            // aby wartości z workflow (odtwarzane pozycyjnie) trafiały do właściwych widżetów.
            const dirIdx = node.widgets?.findIndex(w => w.name === "directory") ?? -1;
            const initial = dirIdx >= 0 ? node.widgets[dirIdx].value : "";
            if (dirIdx >= 0) {
                const [old] = node.widgets.splice(dirIdx, 1);
                old.onRemove?.();
            }
            const panel = createPanel(node, initial);
            const added = node.widgets.indexOf(panel.widget);
            if (dirIdx >= 0 && added >= 0 && added !== dirIdx) {
                node.widgets.splice(added, 1);
                node.widgets.splice(dirIdx, 0, panel.widget);
            }
            node._szandorFml = panel;

            const defaults = readStore(DEFAULTS_KEY, {}) || {};
            node.setSize(validSize(defaults.size)
                ? [Math.max(MIN_SIZE[0], defaults.size[0]), Math.max(MIN_SIZE[1], defaults.size[1])]
                : [...DEFAULT_SIZE]);

            // Nowy node (nie wczytany z workflow / nie wklejony) startuje z ostatnimi ustawieniami.
            requestAnimationFrame(() => {
                if (!node._szandorFmlConfigured) {
                    for (const name of REMEMBERED) {
                        const w = node.widgets?.find(x => x.name === name);
                        if (w && defaults[name] !== undefined) w.value = defaults[name];
                    }
                    const seed = node.widgets?.find(w => w.name === "seed");
                    const control = seed?.linkedWidgets?.[0]
                        ?? node.widgets?.find(w => w.name === "control_after_generate");
                    if (control && defaults.control_after_generate) control.value = defaults.control_after_generate;
                    if (defaults.directory) panel.setDirectory(defaults.directory, { remember: false });
                    else panel.reloadList();
                }
                node._szandorFmlReady = true;
            });
            return result;
        };

        const origConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (config, ...args) {
            this._szandorFmlConfigured = true;
            const result = origConfigure?.call(this, config, ...args);
            if (validSize(config?.size)) this.setSize(Array.from(config.size));
            // Katalog jest odtwarzany przed filtrem — listę pobieramy, gdy wszystkie wartości są już na miejscu.
            requestAnimationFrame(() => this._szandorFml?.reloadList());
            return result;
        };

        const origResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function (size, ...args) {
            const result = origResize?.call(this, size, ...args);
            if (this._szandorFmlReady && validSize(size)) {
                clearTimeout(this._szandorFmlResizeTimer);
                this._szandorFmlResizeTimer = setTimeout(() => this._szandorFml?.saveDefaults(), 400);
            }
            return result;
        };

        const origExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message, ...args) {
            const result = origExecuted?.call(this, message, ...args);
            this._szandorFml?.onExecuted(message);
            return result;
        };

        const origRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function (...args) {
            clearTimeout(this._szandorFmlResizeTimer);
            this._szandorFml?.dispose();
            return origRemoved?.apply(this, args);
        };
    },
});
