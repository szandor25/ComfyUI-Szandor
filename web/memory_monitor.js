import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const MONITOR_TYPE = "SzandorMemoryMonitor";
const CLEANUP_TYPE = "SzandorMemoryCleanup";
const DEFAULT_SIZE = [560, 700];
const LIVE_POINTS = 240;
const KIND_ORDER = ["diffusion", "text_encoder", "vae", "controlnet", "other"];
const KIND_PLURAL = {
    diffusion: "modele dyfuzji", text_encoder: "text encodery", vae: "VAE", controlnet: "ControlNety", other: "inne",
};
const STATUS_LABELS = { success: "✓", error: "✗ błąd", interrupted: "⏹ przerwane", running: "▶ w toku", unknown: "?" };
const COLORS = { device: "#ffb35c", allocated: "#8bc9ff", reserved: "#5a7fa8", rss: "#73e0ba" };

function installStyles() {
    if (document.getElementById("szandor-mem-style")) return;
    const link = document.createElement("link");
    link.id = "szandor-mem-style";
    link.rel = "stylesheet";
    link.href = new URL("./memory_monitor.css", import.meta.url).href;
    document.head.append(link);
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(text, title, className = "") {
    const b = el("button", className, text);
    b.type = "button";
    if (title) b.title = title;
    return b;
}

export function formatBytes(bytes) {
    if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
    const gb = bytes / 1024 ** 3;
    if (Math.abs(gb) >= 1) return `${gb.toFixed(1)} GB`;
    return `${Math.round(bytes / 1024 ** 2)} MB`;
}

export function formatDelta(bytes) {
    if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
    if (Math.abs(bytes) < 1024 ** 2) return "0";
    return (bytes > 0 ? "+" : "−") + formatBytes(Math.abs(bytes));
}

export function formatSeconds(seconds) {
    if (!Number.isFinite(seconds)) return "—";
    if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")} min`;
}

// Czas zadania; dla trwającego — do teraz (zegar przeglądarki może się różnić, więc nie mniej niż ostatnia próbka).
function runDuration(run) {
    const last = run.samples?.at(-1)?.[0] ?? 0;
    const end = run.finished ? run.finished - run.started : Math.max(last, Date.now() / 1000 - run.started);
    return Math.max(0.001, end);
}

function nodeLabel(row) {
    const graphNode = app.graph?.getNodeById?.(Number(row.display_node)) ?? app.graph?.getNodeById?.(row.display_node);
    // Tytuł z grafu tylko dla tego samego typu — zadanie z API może mieć inne numery węzłów.
    const graphTitle = graphNode && (!row.class_type || graphNode.type === row.class_type) ? graphNode.title : "";
    const name = row.title || graphTitle || row.class_type || "węzeł";
    return `${name} #${row.display_node ?? row.node}`;
}

// Wartości węzła według wybranej miary: liczniki PyTorcha albo zajętość całej karty.
function measure(row, metric) {
    if (metric === "device") {
        return { start: row.start?.device, peak: row.peak_device, end: row.end?.device };
    }
    return { start: row.start?.allocated, peak: row.peak_allocated, end: row.end?.allocated };
}

export function runToCsv(run, labelFor = nodeLabel) {
    const gb = v => (Number.isFinite(v) ? (v / 1024 ** 3).toFixed(3).replace(".", ",") : "");
    const sec = v => (Number.isFinite(v) ? v.toFixed(3).replace(".", ",") : "");
    const header = ["lp", "wezel", "typ", "alloc_start_gb", "alloc_szczyt_gb", "alloc_koniec_gb", "alloc_delta_gb",
        "karta_start_gb", "karta_szczyt_gb", "karta_koniec_gb", "reserved_szczyt_gb",
        "ram_start_gb", "ram_szczyt_gb", "ram_koniec_gb", "czas_s"];
    const quote = text => `"${String(text).replaceAll('"', '""')}"`;
    const rows = run.nodes.map((row, i) => [
        i + 1, quote(labelFor(row)), quote(row.class_type || ""),
        gb(row.start?.allocated), gb(row.peak_allocated), gb(row.end?.allocated),
        gb((row.end?.allocated ?? NaN) - (row.start?.allocated ?? NaN)),
        gb(row.start?.device), gb(row.peak_device), gb(row.end?.device), gb(row.peak_reserved),
        gb(row.start?.rss), gb(row.peak_rss), gb(row.end?.rss),
        sec((row.t1 ?? NaN) - row.t0),
    ].join(";"));
    return "﻿" + [header.join(";"), ...rows].join("\r\n") + "\r\n";
}

// ─── wykresy ──────────────────────────────────────────────────────────────────

function prepareCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(10, canvas.clientWidth);
    const height = Math.max(10, canvas.clientHeight);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return { ctx, width, height };
}

function drawGrid(ctx, width, height, left, labels) {
    ctx.strokeStyle = "#2d3340";
    ctx.fillStyle = "#6f7a8d";
    ctx.font = "10px system-ui, sans-serif";
    ctx.lineWidth = 1;
    for (const [fraction, text] of labels) {
        const y = Math.round(4 + (height - 18) * (1 - fraction)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.fillText(text, 2, y + 3);
    }
}

function drawLine(ctx, points, color, xOf, yOf) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (const [x, y] of points) {
        if (!Number.isFinite(y)) { started = false; continue; }
        if (started) ctx.lineTo(xOf(x), yOf(y));
        else { ctx.moveTo(xOf(x), yOf(y)); started = true; }
    }
    ctx.stroke();
}

// ─── panel monitora ───────────────────────────────────────────────────────────

function createMonitor(node) {
    installStyles();
    const root = el("div", "szandor-mem");

    const tabsRow = el("div", "mem-tabs");
    const tabs = {
        live: button("Na żywo", "VRAM, RAM i bieżący węzeł"),
        models: button("Modele", "Modele załadowane przez ComfyUI"),
        runs: button("Uruchomienia", "Pamięć każdego węzła w ostatnich zadaniach"),
    };
    const stateChip = el("span", "mem-chip", "…");
    tabsRow.append(tabs.live, tabs.models, tabs.runs, el("span", "mem-spacer"), stateChip);

    // Na żywo
    const live = el("div", "mem-page");
    const gpuLine = el("div", "mem-line");
    const gpuName = el("span", "mem-strong", "—");
    const gpuExtra = el("span", "mem-dim");
    const policyChip = el("span", "mem-chip mem-policy");
    gpuLine.append(gpuName, gpuExtra, el("span", "mem-spacer"), policyChip);
    const vramBar = el("div", "mem-bar");
    const vramLegend = el("div", "mem-legend");
    const grid = el("div", "mem-grid");
    const cells = {};
    for (const [key, label, title] of [
        ["allocated", "Allocated", "Pamięć zajęta przez tensory PyTorcha (dokładna)."],
        ["reserved", "Reserved", "Allocated + pamięć trzymana w cache PyTorcha do ponownego użycia."],
        ["peak", "Szczyt", "Najwyższe allocated od ostatniego resetu szczytu."],
        ["free", "Wolne", "Wolna pamięć karty według sterownika."],
    ]) {
        const cell = el("div", "mem-cell");
        cell.title = title;
        cell.append(el("small", "", label), cells[key] = el("b", "", "—"));
        grid.append(cell);
    }
    const ramBar = el("div", "mem-bar");
    const ramLegend = el("div", "mem-legend");
    const liveCanvas = el("canvas", "mem-chart mem-chart-live");
    const liveChartLegend = el("div", "mem-legend mem-chart-legend");
    for (const [key, label] of [["device", "karta"], ["allocated", "allocated"], ["rss", "RAM ComfyUI"]]) {
        const item = el("i", "", `■ ${label}`);
        item.style.color = COLORS[key];
        liveChartLegend.append(item);
    }
    liveChartLegend.append(el("span", "", "(% pojemności)"));
    const currentBox = el("div", "mem-current");
    currentBox.hidden = true;
    const actions = el("div", "mem-actions");
    const actionButtons = {
        empty_cache: button("Opróżnij cache CUDA", "torch.cuda.empty_cache — oddaje nieużywaną pamięć z cache PyTorcha."),
        gc: button("gc + cache", "gc.collect() i opróżnienie cache CUDA."),
        unload_all: button("⏏ Wyładuj wszystko z VRAM", "Przenosi wszystkie modele do RAM. Kolejne uruchomienie załaduje je z RAM (szybko)."),
        clear_cache: button("🧹 Wyczyść cache ComfyUI", "Wyładowuje modele i usuwa zapamiętane wyniki węzłów — zwalnia też RAM. Następne uruchomienie wczyta modele z dysku.", "mem-danger"),
        reset_peak: button("Reset szczytu", "Zeruje wartość „Szczyt”."),
    };
    actions.append(...Object.values(actionButtons));
    live.append(gpuLine, vramBar, vramLegend, grid, ramBar, ramLegend, liveCanvas, liveChartLegend, currentBox, actions);

    // Modele
    const models = el("div", "mem-page");
    const modelsScroll = el("div", "mem-scroll");
    const modelsTable = el("table", "mem-table");
    modelsScroll.append(modelsTable);
    const modelsFooter = el("div", "mem-line mem-dim");
    const kindActions = el("div", "mem-actions");
    models.append(modelsScroll, modelsFooter, kindActions);

    // Uruchomienia
    const runs = el("div", "mem-page");
    const runsBar = el("div", "mem-line");
    const runSelect = el("select", "mem-run-select");
    runSelect.title = "Ostatnie zadania (do 5)";
    const metricSelect = el("select");
    for (const [value, label] of [["allocated", "Miara: PyTorch allocated"], ["device", "Miara: cała karta"]]) {
        const option = el("option", "", label);
        option.value = value;
        metricSelect.append(option);
    }
    metricSelect.title = "PyTorch allocated: dokładny szczyt tensorów ComfyUI. Cała karta: zajętość według sterownika (z innymi programami), szczyt z próbek co 0,25 s.";
    const csvButton = button("CSV", "Zapisz tabelę jako CSV (Excel: separator ;)");
    runsBar.append(runSelect, metricSelect, el("span", "mem-spacer"), csvButton);
    const runSummary = el("div", "mem-line mem-dim");
    const runCanvas = el("canvas", "mem-chart mem-chart-run");
    const runLegend = el("div", "mem-legend mem-chart-legend");
    for (const [key, label] of [["device", "karta"], ["reserved", "reserved"], ["allocated", "allocated (kreski: szczyt węzła)"]]) {
        const item = el("i", "", `■ ${label}`);
        item.style.color = COLORS[key];
        runLegend.append(item);
    }
    const runHover = el("div", "mem-legend mem-hover", "Najedź na wykres, aby zobaczyć węzeł i pamięć w danej chwili.");
    const runsScroll = el("div", "mem-scroll");
    const runsTable = el("table", "mem-table mem-run-table");
    runsScroll.append(runsTable);
    runs.append(runsBar, runSummary, runCanvas, runLegend, runHover, runsScroll);

    const message = el("div", "mem-message");
    root.append(tabsRow, live, models, runs, message);

    root.addEventListener("pointerdown", e => {
        if (e.target.closest("button, select, canvas, .mem-scroll")) e.stopPropagation();
    });
    root.addEventListener("keydown", e => e.stopPropagation());
    root.addEventListener("wheel", e => {
        if (e.target.closest(".mem-scroll")) e.stopPropagation();
    }, { passive: true });

    const state = {
        tab: node.properties?.szandorMemoryTab || "live",
        stats: null,
        livePoints: [],
        runs: [],
        runKey: "",
        serial: -1,
        hoverRow: -1,
        hoverTime: null,
        disposed: false,
        timer: 0,
        historyRequest: 0,
    };

    const refreshWidget = () => node.widgets?.find(w => w.name === "refresh");
    const intervalMs = () => Math.max(250, (parseFloat(String(refreshWidget()?.value ?? "1").replace(",", ".")) || 1) * 1000);

    function showMessage(text, warn = false) {
        message.textContent = text;
        message.classList.toggle("mem-warn", warn);
        message.title = text;
    }

    function setTab(tab) {
        state.tab = tab;
        if (node.properties) node.properties.szandorMemoryTab = tab;
        for (const [key, b] of Object.entries(tabs)) b.classList.toggle("mem-active", key === tab);
        live.hidden = tab !== "live";
        models.hidden = tab !== "models";
        runs.hidden = tab !== "runs";
        render();
        if (tab === "runs") loadHistory();
    }

    // ── na żywo ──
    function segment(bar, parts, total) {
        bar.replaceChildren();
        for (const [value, cls, title] of parts) {
            if (!(value > 0) || !(total > 0)) continue;
            const part = el("span", cls);
            part.style.width = `${Math.min(100, (value / total) * 100)}%`;
            part.title = `${title}: ${formatBytes(value)}`;
            bar.append(part);
        }
    }

    function renderLive() {
        const s = state.stats;
        if (!s) return;
        const gpu = s.gpu;
        if (gpu) {
            gpuName.textContent = gpu.name;
            const extra = [];
            if (Number.isFinite(gpu.utilization)) extra.push(`${gpu.utilization}%`);
            if (Number.isFinite(gpu.temperature)) extra.push(`${gpu.temperature}°C`);
            gpuExtra.textContent = extra.join(" · ");
            const other = Math.max(0, gpu.used - gpu.reserved);
            segment(vramBar, [
                [gpu.allocated, "b-allocated", "PyTorch allocated"],
                [gpu.reserved - gpu.allocated, "b-reserved", "Cache PyTorcha (reserved − allocated)"],
                [other, "b-other", "Inne (kontekst CUDA, inne programy)"],
            ], gpu.total);
            vramLegend.textContent = `VRAM ${formatBytes(gpu.used)} / ${formatBytes(gpu.total)} · `
                + `allocated ${formatBytes(gpu.allocated)} · cache ${formatBytes(gpu.reserved - gpu.allocated)} · `
                + `inne ${formatBytes(other)}`;
            vramLegend.title = "Inne = zajętość karty − reserved: kontekst CUDA, biblioteki spoza PyTorcha i inne programy.";
            cells.allocated.textContent = formatBytes(gpu.allocated);
            cells.reserved.textContent = formatBytes(gpu.reserved);
            cells.peak.textContent = formatBytes(gpu.peak);
            cells.free.textContent = formatBytes(gpu.free);
        } else {
            gpuName.textContent = "Brak GPU CUDA / ROCm";
            gpuExtra.textContent = "pokazuję tylko RAM";
            vramBar.replaceChildren();
            vramLegend.textContent = "";
            for (const cell of Object.values(cells)) cell.textContent = "—";
        }
        grid.hidden = !gpu;
        vramBar.hidden = !gpu;

        const policy = s.policy ?? {};
        policyChip.textContent = policy.vram_state ?? "?";
        policyChip.title = [
            `Tryb pamięci ComfyUI: ${policy.vram_state ?? "?"}`,
            `Smart memory: ${policy.smart_memory === false ? "wyłączone" : "włączone"}`,
            Number.isFinite(policy.extra_reserved) ? `Rezerwa VRAM: ${formatBytes(policy.extra_reserved)}` : "",
            policy.flags?.length ? `Parametry: ${policy.flags.join(" ")}` : "Parametry: domyślne",
        ].filter(Boolean).join("\n");

        const ram = s.ram;
        segment(ramBar, [
            [ram.process, "b-rss", "ComfyUI"],
            [Math.max(0, ram.used - ram.process), "b-other", "Inne procesy"],
        ], ram.total);
        const ramParts = [`RAM ${formatBytes(ram.used)} / ${formatBytes(ram.total)}`, `ComfyUI ${formatBytes(ram.process)}`];
        if (ram.swap_total) ramParts.push(`swap ${formatBytes(ram.swap_used)}`);
        if (ram.pinned) ramParts.push(`pinned ${formatBytes(ram.pinned)}`);
        ramLegend.textContent = ramParts.join(" · ");

        renderCurrent();
        drawLiveChart();
    }

    function renderCurrent() {
        const current = state.stats?.current;
        currentBox.hidden = !current;
        if (!current) return;
        const parts = [`▶ ${nodeLabel(current)}`, formatSeconds(current.elapsed)];
        const gpu = state.stats.gpu;
        if (gpu && Number.isFinite(current.start?.allocated)) {
            parts.push(`start ${formatBytes(current.start.allocated)}`, `teraz ${formatBytes(gpu.allocated)}`,
                `szczyt ${formatBytes(current.peak_allocated)}`,
                `Δ ${formatDelta(gpu.allocated - current.start.allocated)}`);
        }
        currentBox.textContent = parts.join(" · ");
    }

    function drawLiveChart() {
        if (live.hidden) return;
        const { ctx, width, height } = prepareCanvas(liveCanvas);
        const left = 30;
        drawGrid(ctx, width, height, left, [[0, "0%"], [0.5, "50%"], [1, "100%"]]);
        const points = state.livePoints;
        if (points.length < 2) return;
        const t0 = points[0].t;
        const span = Math.max(1, points.at(-1).t - t0);
        const xOf = t => left + ((t - t0) / span) * (width - left - 2);
        const yOf = fraction => 4 + (height - 18) * (1 - Math.min(1, Math.max(0, fraction)));
        const series = [["device", COLORS.device], ["allocated", COLORS.allocated], ["rss", COLORS.rss]];
        for (const [key, color] of series) drawLine(ctx, points.map(p => [p.t, p[key]]), color, xOf, yOf);
        ctx.fillStyle = "#6f7a8d";
        ctx.fillText(`ostatnie ${formatSeconds(span)}`, width - 90, height - 3);
    }

    function pushLivePoint(s) {
        const gpu = s.gpu;
        state.livePoints.push({
            t: s.time,
            device: gpu ? gpu.used / gpu.total : NaN,
            allocated: gpu ? gpu.allocated / gpu.total : NaN,
            rss: s.ram.process / s.ram.total,
        });
        if (state.livePoints.length > LIVE_POINTS) state.livePoints.splice(0, state.livePoints.length - LIVE_POINTS);
    }

    // ── modele ──
    function renderModels() {
        const s = state.stats;
        if (!s) return;
        const list = [...s.models].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.size - a.size);
        tabs.models.textContent = `Modele (${list.length})`;
        if (models.hidden) return;
        const busy = s.busy;
        modelsTable.replaceChildren();
        if (!list.length) {
            const row = modelsTable.insertRow();
            const cell = row.insertCell();
            cell.className = "mem-empty";
            cell.textContent = "Brak modeli załadowanych przez ComfyUI. Modele pojawiają się po pierwszym użyciu; "
                + "węzły z własnym zarządzaniem pamięcią (np. WanVideoWrapper) nie są tu widoczne.";
        } else {
            const head = modelsTable.createTHead().insertRow();
            for (const text of ["Model", "Rodzaj", "dtype", "Rozmiar", "W VRAM", ""]) head.append(el("th", "", text));
            const body = modelsTable.createTBody();
            for (const model of list) {
                const row = body.insertRow();
                const name = row.insertCell();
                name.textContent = model.name;
                name.title = [`Urządzenie docelowe: ${model.load_device}`, `Teraz: ${model.device}`,
                    model.patches ? `Łatki (LoRA itp.): ${model.patches} wag` : "Bez łatek",
                    model.dynamic ? "Dynamiczne ładowanie wag" : ""].filter(Boolean).join("\n");
                if (model.patches) name.append(el("span", "mem-tag", `+${model.patches} łatek`));
                row.insertCell().append(el("span", `mem-kind k-${model.kind}`, model.kind_label));
                row.insertCell().textContent = model.dtype || "—";
                row.insertCell().textContent = formatBytes(model.size);
                const loadedCell = row.insertCell();
                const fraction = model.size > 0 ? model.loaded / model.size : 0;
                const mini = el("div", "mem-mini");
                const fill = el("span");
                fill.style.width = `${Math.min(100, fraction * 100)}%`;
                mini.append(fill);
                loadedCell.append(mini, el("small", "", `${formatBytes(model.loaded)} · ${Math.round(fraction * 100)}%`));
                const unload = button("⏏", busy ? "Niedostępne w trakcie zadania — użyj węzła Memory Cleanup."
                    : "Wyładuj ten model z VRAM (zostaje w RAM).");
                unload.disabled = busy || !(model.loaded > 0);
                unload.addEventListener("click", () => runAction("unload_model", { id: model.id }, unload));
                row.insertCell().append(unload);
            }
        }
        const totalLoaded = list.reduce((sum, m) => sum + (m.loaded || 0), 0);
        const totalSize = list.reduce((sum, m) => sum + (m.size || 0), 0);
        modelsFooter.textContent = list.length
            ? `W VRAM: ${formatBytes(totalLoaded)} z ${formatBytes(totalSize)} · wyładowany model zostaje w RAM, dopóki trzyma go cache ComfyUI.`
            : "";
        kindActions.replaceChildren();
        for (const kind of KIND_ORDER) {
            if (!list.some(m => m.kind === kind && m.loaded > 0)) continue;
            const b = button(`⏏ ${KIND_PLURAL[kind]}`, `Wyładuj z VRAM wszystkie: ${KIND_PLURAL[kind]}`);
            b.disabled = busy;
            b.addEventListener("click", () => runAction("unload_kind", { kind }, b));
            kindActions.append(b);
        }
    }

    // ── uruchomienia ──
    const runKey = run => `${run.prompt_id}|${run.started}`;
    const selectedRun = () => state.runs.find(run => runKey(run) === state.runKey) ?? state.runs[0];

    function renderRuns() {
        if (runs.hidden) return;
        const previous = state.runKey;
        runSelect.replaceChildren();
        for (const run of state.runs) {
            const option = el("option");
            option.value = runKey(run);
            const started = new Date(run.started * 1000).toLocaleTimeString();
            const duration = runDuration(run);
            option.textContent = `${started} · ${formatSeconds(duration)} · ${STATUS_LABELS[run.status] ?? run.status}`;
            runSelect.append(option);
        }
        const run = selectedRun();
        state.runKey = run ? runKey(run) : "";
        runSelect.value = state.runKey;
        runSelect.disabled = !run;
        csvButton.disabled = !run?.nodes.length;
        if (previous !== state.runKey) state.hoverRow = -1;
        if (!run) {
            runSummary.textContent = "Brak zapisanych uruchomień — uruchom workflow (Queue). Pomiar działa dla zadań z przeglądarki.";
            runsTable.replaceChildren();
            prepareCanvas(runCanvas);
            return;
        }
        const metric = metricSelect.value;
        const rows = run.nodes;
        const peaks = rows.map(row => measure(row, metric).peak ?? -Infinity);
        const maxPeak = Math.max(...peaks);
        const total = runDuration(run);
        const cached = run.cached?.length ?? 0;
        runSummary.textContent = [
            `Czas ${formatSeconds(total)}`, `węzłów ${rows.length}`, cached ? `z cache ${cached}` : "",
            Number.isFinite(maxPeak) ? `szczyt ${formatBytes(maxPeak)}` : "",
            run.status === "running" ? "trwa…" : "",
        ].filter(Boolean).join(" · ");

        runsTable.replaceChildren();
        const head = runsTable.createTHead().insertRow();
        for (const text of ["#", "Węzeł", "Start", "Szczyt", "Koniec", "Δ", "RAM Δ", "Czas"]) head.append(el("th", "", text));
        const body = runsTable.createTBody();
        if (!rows.length) {
            const cell = body.insertRow().insertCell();
            cell.colSpan = 8;
            cell.className = "mem-empty";
            cell.textContent = run.status === "running" ? "Czekam na pierwszy węzeł…"
                : "Wszystkie węzły pochodziły z cache — nic nie zostało wykonane.";
        }
        rows.forEach((row, i) => {
            const values = measure(row, metric);
            const tr = body.insertRow();
            tr.classList.toggle("mem-top", peaks[i] === maxPeak && Number.isFinite(maxPeak));
            tr.classList.toggle("mem-hover-row", i === state.hoverRow);
            const cellsText = [
                String(i + 1), nodeLabel(row), formatBytes(values.start), formatBytes(values.peak), formatBytes(values.end),
                formatDelta((values.end ?? NaN) - (values.start ?? NaN)),
                formatDelta((row.end?.rss ?? NaN) - (row.start?.rss ?? NaN)),
                row.t1 ? formatSeconds(row.t1 - row.t0) : "…",
            ];
            for (const text of cellsText) tr.insertCell().textContent = text;
            tr.cells[1].title = `${row.class_type || ""}\nDwuklik: pokaż węzeł w grafie`;
            tr.cells[3].title = `Szczyt w trakcie węzła (reserved: ${formatBytes(row.peak_reserved)}, RAM: ${formatBytes(row.peak_rss)})`;
            tr.addEventListener("pointerenter", () => { state.hoverRow = i; drawRunChart(); });
            tr.addEventListener("pointerleave", () => { state.hoverRow = -1; drawRunChart(); });
            tr.addEventListener("dblclick", () => focusNode(row));
        });
        drawRunChart();
    }

    function focusNode(row) {
        const target = app.graph?.getNodeById?.(Number(row.display_node)) ?? app.graph?.getNodeById?.(row.display_node);
        if (!target) return;
        app.canvas?.centerOnNode?.(target);
        app.canvas?.selectNode?.(target);
        app.canvas?.setDirty?.(true, true);
    }

    function drawRunChart() {
        if (runs.hidden) return;
        const run = selectedRun();
        const { ctx, width, height } = prepareCanvas(runCanvas);
        if (!run) return;
        const left = 44;
        const total = run.total || null;
        const samples = run.samples ?? [];
        const end = runDuration(run);
        const xOf = t => left + (t / end) * (width - left - 2);
        // Pasma węzłów (naprzemienne tło) z podświetleniem wskazanego.
        run.nodes.forEach((row, i) => {
            const x0 = xOf(row.t0 - run.started);
            const x1 = xOf((row.t1 ?? run.started + end) - run.started);
            ctx.fillStyle = i === state.hoverRow ? "#3a4a6688" : i % 2 ? "#ffffff08" : "#ffffff00";
            ctx.fillRect(x0, 0, Math.max(1, x1 - x0), height - 14);
        });
        if (samples.length < 2) {
            ctx.fillStyle = "#6f7a8d";
            ctx.font = "11px system-ui, sans-serif";
            ctx.fillText(run.status === "running" ? "Zbieram próbki…" : "Brak wykresu — zadanie trwało krócej niż 0,5 s.", left, height / 2);
            return;
        }
        const ymax = total ?? Math.max(1, ...samples.map(s => s[4] ?? 0));
        const yOf = v => 4 + (height - 18) * (1 - Math.min(1, Math.max(0, v / ymax)));
        drawGrid(ctx, width, height, left, [[0, "0"], [0.5, formatBytes(ymax / 2)], [1, formatBytes(ymax)]]);
        if (total) {
            drawLine(ctx, samples.map(s => [s[0], s[1]]), COLORS.device, xOf, yOf);
            drawLine(ctx, samples.map(s => [s[0], s[3]]), COLORS.reserved, xOf, yOf);
            drawLine(ctx, samples.map(s => [s[0], s[2]]), COLORS.allocated, xOf, yOf);
        } else {
            drawLine(ctx, samples.map(s => [s[0], s[4]]), COLORS.rss, xOf, yOf);
        }
        // Szczyty węzłów jako kreski (dokładne, także między próbkami).
        ctx.fillStyle = COLORS.allocated;
        for (const row of run.nodes) {
            if (!Number.isFinite(row.peak_allocated) || !total) continue;
            const x0 = xOf(row.t0 - run.started);
            const x1 = xOf((row.t1 ?? run.started + end) - run.started);
            ctx.fillRect(x0, yOf(row.peak_allocated) - 1, Math.max(2, x1 - x0), 2);
        }
        if (state.hoverTime !== null) {
            ctx.strokeStyle = "#ffffff66";
            ctx.beginPath();
            ctx.moveTo(xOf(state.hoverTime) + 0.5, 0);
            ctx.lineTo(xOf(state.hoverTime) + 0.5, height - 14);
            ctx.stroke();
        }
        ctx.fillStyle = "#6f7a8d";
        ctx.fillText("0 s", left, height - 2);
        ctx.fillText(formatSeconds(end), width - 50, height - 2);
    }

    runCanvas.addEventListener("pointermove", event => {
        const run = selectedRun();
        if (!run) return;
        const rect = runCanvas.getBoundingClientRect();
        const left = 44;
        const samples = run.samples ?? [];
        const end = runDuration(run);
        const x = (event.clientX - rect.left) * (runCanvas.clientWidth / rect.width);
        const t = Math.max(0, Math.min(end, ((x - left) / (runCanvas.clientWidth - left - 2)) * end));
        state.hoverTime = t;
        const index = run.nodes.findIndex(row => row.t0 - run.started <= t && (row.t1 ?? Infinity) - run.started >= t);
        state.hoverRow = index;
        const sample = samples.reduce((best, s) => (!best || Math.abs(s[0] - t) < Math.abs(best[0] - t) ? s : best), null);
        const parts = [`${formatSeconds(t)}`];
        if (index >= 0) parts.push(nodeLabel(run.nodes[index]));
        if (sample && run.total) parts.push(`karta ${formatBytes(sample[1])}`, `allocated ${formatBytes(sample[2])}`, `reserved ${formatBytes(sample[3])}`);
        if (sample) parts.push(`RAM ${formatBytes(sample[4])}`);
        runHover.textContent = parts.join(" · ");
        for (const [i, tr] of Array.from(runsTable.tBodies[0]?.rows ?? []).entries()) tr.classList.toggle("mem-hover-row", i === index);
        drawRunChart();
    });
    runCanvas.addEventListener("pointerleave", () => {
        state.hoverTime = null;
        state.hoverRow = -1;
        for (const tr of runsTable.tBodies[0]?.rows ?? []) tr.classList.remove("mem-hover-row");
        drawRunChart();
    });

    // ── dane i akcje ──
    function render() {
        renderLive();
        renderModels();
        renderRuns();
        const busy = !!state.stats?.busy;
        stateChip.textContent = state.stats ? (busy ? "▶ zadanie" : "bezczynny") : "brak połączenia";
        stateChip.classList.toggle("mem-busy", busy);
        for (const [action, b] of Object.entries(actionButtons)) {
            if (action === "reset_peak" || action === "clear_cache") continue;
            b.disabled = busy || !state.stats;
            b.title = busy ? "Niedostępne w trakcie zadania — użyj węzła Memory Cleanup w workflow." : b.dataset.title ?? b.title;
        }
    }
    for (const b of Object.values(actionButtons)) b.dataset.title = b.title;

    async function loadHistory() {
        const request = ++state.historyRequest;
        try {
            const res = await api.fetchApi("/szandor/memory/history");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (state.disposed || request !== state.historyRequest) return;
            state.runs = data.runs ?? [];
            renderRuns();
        } catch (err) {
            if (!state.disposed) showMessage(`⚠ Nie udało się pobrać historii: ${err?.message ?? err}`, true);
        }
    }

    async function poll() {
        if (state.disposed) return;
        if (!document.hidden) {
            try {
                const res = await api.fetchApi("/szandor/memory/stats");
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (state.disposed) return;
                state.stats = data;
                pushLivePoint(data);
                const serialChanged = data.serial !== state.serial;
                state.serial = data.serial;
                render();
                if (state.tab === "runs" && (serialChanged || data.busy)) loadHistory();
            } catch (err) {
                if (state.disposed) return;
                state.stats = null;
                stateChip.textContent = "brak połączenia";
                showMessage(`⚠ Brak danych z serwera: ${err?.message ?? err}`, true);
            }
        }
        clearTimeout(state.timer);
        state.timer = setTimeout(poll, intervalMs());
    }

    async function runAction(action, payload = {}, source = null) {
        if (action === "clear_cache" && !confirm("Wyczyścić cache ComfyUI? Wszystkie modele zostaną wyładowane, "
            + "a następne uruchomienie wczyta je od nowa z dysku.")) return;
        if (source) source.disabled = true;
        showMessage("…");
        try {
            const res = await api.fetchApi("/szandor/memory/action", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, ...payload }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            const freed = data.freed > 1024 ** 2 ? ` (zwolniono ${formatBytes(data.freed)} VRAM)` : "";
            showMessage(`${data.message}${freed}`);
        } catch (err) {
            showMessage(`⚠ ${err?.message ?? err}`, true);
        } finally {
            if (source) source.disabled = false;
            clearTimeout(state.timer);
            poll();
        }
    }

    for (const [action, b] of Object.entries(actionButtons)) b.addEventListener("click", () => runAction(action, {}, b));
    for (const [tab, b] of Object.entries(tabs)) b.addEventListener("click", () => setTab(tab));
    runSelect.addEventListener("change", () => { state.runKey = runSelect.value; renderRuns(); });
    metricSelect.addEventListener("change", renderRuns);
    csvButton.addEventListener("click", () => {
        const run = selectedRun();
        if (!run) return;
        const blob = new Blob([runToCsv(run)], { type: "text/csv;charset=utf-8" });
        const link = el("a");
        link.href = URL.createObjectURL(blob);
        const stamp = new Date(run.started * 1000).toISOString().slice(0, 19).replace(/[:T]/g, "-");
        link.download = `pamiec_wezlow_${stamp}.csv`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    });

    const widget = node.addDOMWidget("memory_monitor", "SZANDOR_MEMORY_MONITOR", root, {
        getValue: () => "",
        setValue: () => {},
        getMinHeight: () => 380,
        hideOnZoom: false,
        serialize: false,
    });
    widget.serializeValue = () => undefined;

    setTab(state.tab);
    poll();

    return {
        widget,
        dispose() {
            state.disposed = true;
            clearTimeout(state.timer);
        },
        restoreTab() {
            setTab(node.properties?.szandorMemoryTab || state.tab);
        },
    };
}

// ─── raport węzła Memory Cleanup ──────────────────────────────────────────────

function createCleanupReport(node) {
    installStyles();
    const report = el("pre", "szandor-mem-report", "Raport pojawi się po wykonaniu węzła.");
    report.addEventListener("pointerdown", e => e.stopPropagation());
    const widget = node.addDOMWidget("cleanup_report", "SZANDOR_MEMORY_REPORT", report, {
        getValue: () => "",
        setValue: () => {},
        getMinHeight: () => 70,
        hideOnZoom: false,
        serialize: false,
    });
    widget.serializeValue = () => undefined;
    return {
        show(text) {
            report.textContent = text;
            report.classList.add("mem-filled");
        },
    };
}

app.registerExtension({
    name: "Szandor.MemoryMonitor",

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === MONITOR_TYPE) {
            const origCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function (...args) {
                const result = origCreated?.apply(this, args);
                this.properties = this.properties ?? {};
                this._szandorMemory = createMonitor(this);
                this.setSize?.([...DEFAULT_SIZE]);
                return result;
            };
            const origConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function (...args) {
                const result = origConfigure?.apply(this, args);
                this._szandorMemory?.restoreTab();
                return result;
            };
            const origRemoved = nodeType.prototype.onRemoved;
            nodeType.prototype.onRemoved = function (...args) {
                this._szandorMemory?.dispose();
                return origRemoved?.apply(this, args);
            };
        }
        if (nodeData.name === CLEANUP_TYPE) {
            const origCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function (...args) {
                const result = origCreated?.apply(this, args);
                this._szandorMemoryReport = createCleanupReport(this);
                return result;
            };
            const origExecuted = nodeType.prototype.onExecuted;
            nodeType.prototype.onExecuted = function (message, ...args) {
                const result = origExecuted?.call(this, message, ...args);
                const text = message?.szandor_memory?.[0];
                if (text) this._szandorMemoryReport?.show(text);
                return result;
            };
        }
    },
});
