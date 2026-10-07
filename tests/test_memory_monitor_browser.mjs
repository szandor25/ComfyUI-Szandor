// No npm dependencies. Run with CHROME_PATH=/path/to/chrome node tests/test_memory_monitor_browser.mjs.
// Memory Monitor panel against a stubbed ComfyUI host and stubbed memory API (GPU data included).
// Set SCREENSHOT_DIR to save screenshots of the three tabs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const chromePath = process.env.CHROME_PATH;
if (!chromePath) throw new Error("Set CHROME_PATH to a Chromium executable.");
const repo = new URL("../", import.meta.url);
const GB = 1024 ** 3;

const stats = {
    gpu: { name: "Test GPU 96GB", total: 96 * GB, used: 61 * GB, free: 35 * GB, allocated: 52 * GB, reserved: 58 * GB,
        peak_allocated: 70 * GB, peak_reserved: 74 * GB, peak: 73 * GB, utilization: 97, temperature: 71 },
    ram: { total: 128 * GB, used: 67 * GB, available: 61 * GB, process: 41 * GB, swap_used: 2 * GB, swap_total: 16 * GB, pinned: 3 * GB },
    policy: { vram_state: "HIGH_VRAM", extra_reserved: 0.7 * GB, smart_memory: true, flags: ["--highvram"] },
    models: [
        { id: "11", name: "WanT5Model", kind: "text_encoder", kind_label: "text encoder", device: "cuda:0", load_device: "cuda:0", dtype: "float8_e4m3fn", size: 9.8 * GB, loaded: 9.8 * GB, patches: 0, dynamic: false },
        { id: "22", name: "WAN22_T2V", kind: "diffusion", kind_label: "model dyfuzji", device: "cuda:0", load_device: "cuda:0", dtype: "bfloat16", size: 28.6 * GB, loaded: 20 * GB, patches: 400, dynamic: false },
        { id: "33", name: "WanVAE", kind: "vae", kind_label: "VAE", device: "cpu", load_device: "cuda:0", dtype: "bfloat16", size: 0.25 * GB, loaded: 0, patches: 0, dynamic: false },
    ],
    time: 1000, busy: false, serial: 1, current: null,
};
const t0 = 1000;
const samples = Array.from({ length: 80 }, (_, i) => [i * 0.5, (20 + i / 2) * GB, (10 + i / 3) * GB, (12 + i / 3) * GB, 30 * GB]);
const history = { serial: 1, runs: [{
    prompt_id: "p1", started: t0, finished: t0 + 40, status: "success", total: 96 * GB, ram_total: 128 * GB,
    cached: ["1"], samples, interval: 0.5,
    nodes: [
        { node: "4", display_node: "4", class_type: "CLIPTextEncode", title: "Prompt", t0: t0, t1: t0 + 2,
          start: { device: 20 * GB, allocated: 10 * GB, reserved: 12 * GB, rss: 30 * GB }, end: { device: 21 * GB, allocated: 11 * GB, reserved: 12 * GB, rss: 30 * GB },
          peak_allocated: 12 * GB, peak_reserved: 13 * GB, peak_device: 22 * GB, peak_rss: 31 * GB },
        { node: "3", display_node: "3", class_type: "KSampler", title: "", t0: t0 + 2, t1: t0 + 38,
          start: { device: 21 * GB, allocated: 11 * GB, reserved: 12 * GB, rss: 30 * GB }, end: { device: 50 * GB, allocated: 27 * GB, reserved: 30 * GB, rss: 32 * GB },
          peak_allocated: 45 * GB, peak_reserved: 47 * GB, peak_device: 60 * GB, peak_rss: 33 * GB },
    ],
}] };
const actions = [];
let actionReply = { status: 200, body: { message: "Unloaded from VRAM: WanT5Model", freed: 9.8 * GB } };
let statsRequests = 0;

const html = `<!doctype html><html><head><meta charset="UTF-8"></head>
<body style="background:#252930;padding:20px;margin:0"><script type="module">
import { app } from '/scripts/app.js';
import '/web/memory_monitor.js';
class Host {
  constructor(type) { this.type = type; this.properties = {}; this.size = [560, 700]; this.widgets = type === 'SzandorMemoryMonitor' ? [{ name: 'refresh', value: '0.5 s' }] : []; }
  addDOMWidget(name, type, element, options) {
    this.element = element; document.body.append(element);
    element.style.width = '560px'; element.style.height = '660px';
    const widget = { name, type, element, options }; this.widgets.push(widget); return widget;
  }
  setSize(size) { this.size = size; }
}
const extension = app.extensions.find(e => e.name === 'Szandor.MemoryMonitor');
class Monitor extends Host { constructor() { super('SzandorMemoryMonitor'); } }
class Cleanup extends Host { constructor() { super('SzandorMemoryCleanup'); } }
extension.beforeRegisterNodeDef(Monitor, { name: 'SzandorMemoryMonitor' });
extension.beforeRegisterNodeDef(Cleanup, { name: 'SzandorMemoryCleanup' });
window.monitor = new Monitor(); monitor.onNodeCreated();
window.cleanup = new Cleanup(); cleanup.onNodeCreated();
cleanup.element.style.height = '90px';
window.confirm = () => window.confirmAnswer;
window.q = selector => monitor.element.querySelector(selector);
window.tab = i => monitor.element.querySelectorAll('.mem-tabs button')[i].click();
window.ready = true;
</script></body></html>`;

const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, "http://x");
        if (url.pathname === "/") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(html); return; }
        if (url.pathname === "/scripts/app.js") {
            res.setHeader("Content-Type", "text/javascript");
            res.end("export const app = { extensions: [], graph: { getNodeById: () => null }, registerExtension(e) { this.extensions.push(e); } };"); return;
        }
        if (url.pathname === "/scripts/api.js") {
            res.setHeader("Content-Type", "text/javascript");
            res.end("export const api = { fetchApi: (path, options) => fetch(path, options) };"); return;
        }
        res.setHeader("Content-Type", "application/json");
        if (url.pathname === "/szandor/memory/stats") { statsRequests++; res.end(JSON.stringify(stats)); return; }
        if (url.pathname === "/szandor/memory/history") { res.end(JSON.stringify(history)); return; }
        if (url.pathname === "/szandor/memory/action") {
            let body = "";
            for await (const chunk of req) body += chunk;
            actions.push(JSON.parse(body));
            res.writeHead(actionReply.status).end(JSON.stringify(actionReply.body)); return;
        }
        if (!/^\/web\/[a-z0-9_]+\.(js|css)$/.test(url.pathname)) { res.writeHead(404).end(); return; }
        res.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "text/javascript");
        res.end(await readFile(new URL(url.pathname.slice(1), repo)));
    } catch (error) { res.writeHead(500).end(String(error)); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const profile = await mkdtemp(`${tmpdir()}/szandor-mem-test-`);
const chrome = spawn(chromePath, ["--headless", "--no-sandbox", "--disable-gpu", "--no-first-run", "--disable-background-networking", `--user-data-dir=${profile}`, "--remote-debugging-pipe", "about:blank"], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
let sequence = 0;
let buffer = "";
const pending = new Map();
const errors = [];
chrome.stdio[4].on("data", data => {
    buffer += data;
    let end;
    while ((end = buffer.indexOf("\0")) !== -1) {
        const msg = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails);
        if (pending.has(msg.id)) {
            const { resolve, reject, timer } = pending.get(msg.id);
            clearTimeout(timer); pending.delete(msg.id);
            if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);
        }
    }
});
let stderr = "";
chrome.stderr.on("data", data => { stderr += data; });
function call(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out: ${stderr.slice(-1000)}`)); }, 15000);
        pending.set(id, { resolve, reject, timer });
        chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
    });
}
try {
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    const cdp = (method, params) => call(method, params, sessionId);
    await cdp("Runtime.enable");
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
    const evaluate = async expression => {
        const result = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
    };
    const waitFor = async (expression, label) => {
        for (let i = 0; i < 100; i++) {
            if (await evaluate(expression)) return;
            await new Promise(r => setTimeout(r, 50));
        }
        throw new Error(`Timed out waiting for ${label}`);
    };
    const screenshot = async name => {
        if (!process.env.SCREENSHOT_DIR) return;
        await new Promise(r => setTimeout(r, 200));
        const { data } = await cdp("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 620, height: 820, scale: 1 } });
        await writeFile(`${process.env.SCREENSHOT_DIR}/memory_${name}.png`, Buffer.from(data, "base64"));
    };
    await cdp("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    await waitFor("window.ready === true", "page");

    // Live: GPU, VRAM split, policy and RAM.
    await waitFor("q('.mem-strong').textContent === 'Test GPU 96GB'", "gpu name");
    assert.match(await evaluate("q('.mem-strong').nextSibling.textContent"), /97% · 71°C/);
    const legends = await evaluate("[...monitor.element.querySelectorAll('.mem-page:not([hidden]) .mem-legend')].map(e => e.textContent)");
    assert.match(legends[0], /^VRAM 61\.0 GB \/ 96\.0 GB · allocated 52\.0 GB · cache 6\.0 GB · other 3\.0 GB$/);
    assert.match(legends[1], /RAM 67\.0 GB \/ 128\.0 GB · ComfyUI 41\.0 GB · swap 2\.0 GB · pinned 3\.0 GB/);
    assert.deepEqual(await evaluate("[...monitor.element.querySelectorAll('.mem-cell b')].map(e => e.textContent)"), ["52.0 GB", "58.0 GB", "73.0 GB", "35.0 GB"]);
    assert.equal(await evaluate("q('.mem-policy').textContent"), "HIGH_VRAM");
    assert.match(await evaluate("q('.mem-policy').title"), /--highvram/);
    assert.equal(await evaluate("q('.mem-chip').textContent"), "idle");
    await screenshot("live");

    // Models: sorted by kind, partial load bar, per-model and per-kind unload.
    await evaluate("tab(1)");
    await waitFor("monitor.element.querySelectorAll('.mem-table tbody tr').length === 3", "model rows");
    assert.deepEqual(await evaluate("[...monitor.element.querySelectorAll('.mem-table tbody tr')].map(r => r.cells[0].firstChild.textContent)"),
        ["WAN22_T2V", "WanT5Model", "WanVAE"]);
    assert.match(await evaluate("monitor.element.querySelector('.mem-table tbody tr').cells[4].textContent"), /20\.0 GB · 70%/);
    assert.equal(await evaluate("monitor.element.querySelectorAll('.mem-table tbody tr')[2].querySelector('button').disabled"), true);
    assert.equal(await evaluate("monitor.element.querySelector('.mem-tabs button:nth-child(2)').textContent"), "Models (3)");
    await screenshot("models");
    await evaluate("monitor.element.querySelectorAll('.mem-table tbody tr')[1].querySelector('button').click()");
    await waitFor("q('.mem-message').textContent.includes('freed 9.8 GB')", "unload message");
    assert.deepEqual(actions.at(-1), { action: "unload_model", id: "11" });
    assert.deepEqual(await evaluate("[...monitor.element.querySelectorAll('.mem-page:not([hidden]) .mem-actions button')].map(b => b.textContent)"),
        ["⏏ diffusion models", "⏏ text encoders"]);
    await evaluate("monitor.element.querySelector('.mem-page:not([hidden]) .mem-actions button').click()");
    for (let i = 0; i < 100 && actions.length < 2; i++) await new Promise(r => setTimeout(r, 50));
    assert.deepEqual(actions.at(-1), { action: "unload_kind", kind: "diffusion" });

    // Busy: unloading disabled, server refusal shown as a warning.
    stats.busy = true;
    stats.current = { node: "3", display_node: "3", class_type: "KSampler", title: "", elapsed: 12.3, start: { allocated: 40 * GB }, peak_allocated: 70 * GB };
    await waitFor("q('.mem-chip').textContent === '▶ job'", "busy chip");
    assert.equal(await evaluate("monitor.element.querySelector('.mem-table tbody tr button').disabled"), true);
    await evaluate("tab(0)");
    await waitFor("!q('.mem-current').hidden", "current node");
    assert.equal(await evaluate("q('.mem-current').textContent"), "▶ KSampler #3 · 12.3 s · start 40.0 GB · now 52.0 GB · peak 70.0 GB · Δ +12.0 GB");
    assert.equal(await evaluate("[...monitor.element.querySelectorAll('.mem-actions button')].find(b => b.textContent.startsWith('Empty')).disabled"), true);
    actionReply = { status: 409, body: { error: "Trwa wykonywanie zadania" } };
    await evaluate("[...monitor.element.querySelectorAll('.mem-actions button')].find(b => b.textContent === 'Reset peak').click()");
    await waitFor("q('.mem-message').classList.contains('mem-warn')", "busy warning");
    assert.match(await evaluate("q('.mem-message').textContent"), /Trwa wykonywanie/);
    stats.busy = false;
    stats.current = null;
    actionReply = { status: 200, body: { message: "ok" } };
    await evaluate("window.confirmAnswer = false; [...monitor.element.querySelectorAll('.mem-actions button')].find(b => b.textContent.includes('Clear')).click()");
    const before = actions.length;
    await new Promise(r => setTimeout(r, 200));
    assert.equal(actions.length, before);

    // Runs: table, top peak, metric switch, CSV.
    await evaluate("tab(2)");
    await waitFor("monitor.element.querySelectorAll('.mem-run-table tbody tr').length === 2", "run rows");
    const rows = await evaluate("[...monitor.element.querySelectorAll('.mem-run-table tbody tr')].map(r => [...r.cells].map(c => c.textContent))");
    assert.deepEqual(rows[0], ["1", "Prompt #4", "10.0 GB", "12.0 GB", "11.0 GB", "+1.0 GB", "0", "2.00 s"]);
    assert.deepEqual(rows[1], ["2", "KSampler #3", "11.0 GB", "45.0 GB", "27.0 GB", "+16.0 GB", "+2.0 GB", "36.0 s"]);
    assert.equal(await evaluate("monitor.element.querySelectorAll('.mem-run-table tr.mem-top').length"), 1);
    assert.match(await evaluate("q('.mem-page:not([hidden]) .mem-line.mem-dim').textContent"), /Time 40\.0 s · 2 nodes · 1 cached · peak 45\.0 GB/);
    await evaluate("const m = monitor.element.querySelectorAll('.mem-run-select ~ select')[0]; m.value = 'device'; m.dispatchEvent(new Event('change'))");
    assert.equal(await evaluate("monitor.element.querySelectorAll('.mem-run-table tbody tr')[1].cells[3].textContent"), "60.0 GB");
    await evaluate("const m2 = monitor.element.querySelectorAll('.mem-run-select ~ select')[0]; m2.value = 'allocated'; m2.dispatchEvent(new Event('change'))");
    // Hover over the chart highlights the node under the cursor.
    await evaluate(`(() => { const c = q('.mem-chart-run'); const r = c.getBoundingClientRect();
      c.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + r.width * 0.6, clientY: r.top + 20, bubbles: true })); })()`);
    assert.match(await evaluate("q('.mem-hover').textContent"), /KSampler #3 · device/);
    assert.equal(await evaluate("monitor.element.querySelectorAll('.mem-run-table tr.mem-hover-row').length"), 1);
    await screenshot("runs");
    const csv = await evaluate("import('/web/memory_monitor.js').then(m => m.runToCsv(window.__run ?? null)).catch(e => String(e))".replace("window.__run ?? null", JSON.stringify(history.runs[0])));
    const lines = csv.split("\r\n");
    assert.ok(lines[0].startsWith("﻿no;node;type;alloc_start_gb"));
    assert.equal(lines[2].split(";").slice(0, 7).join(";"), '2;"KSampler #3";"KSampler";11,000;45,000;27,000;16,000');
    assert.equal(lines[2].split(";").at(-1), "36,000");

    // Cleanup node shows its report; removing the monitor stops polling.
    await evaluate("cleanup.onExecuted({ szandor_memory: ['Unloaded: WanT5Model'] })");
    assert.equal(await evaluate("cleanup.element.textContent"), "Unloaded: WanT5Model");
    await evaluate("monitor.onRemoved()");
    const count = statsRequests;
    await new Promise(r => setTimeout(r, 1200));
    assert.ok(statsRequests <= count + 1, "polling stops after removal");

    assert.deepEqual(errors, []);
    console.log("PASS: live GPU/RAM/policy, models sort/partial load/unload per model and kind, busy state + refusal + confirm, run table/top peak/metric switch/hover/CSV, cleanup report, polling stops on removal.");
} finally {
    chrome.kill();
    await new Promise(resolve => chrome.exitCode !== null ? resolve() : chrome.once("exit", resolve));
    server.close();
    for (const { timer } of pending.values()) clearTimeout(timer);
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
