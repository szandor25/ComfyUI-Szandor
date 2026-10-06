// No npm dependencies. Run with CHROME_PATH=/path/to/chrome node tests/test_folder_media_browser.mjs.
// Folder Media + Prompt Loader file drops against a stubbed ComfyUI host and stubbed folder API.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const chromePath = process.env.CHROME_PATH;
if (!chromePath) throw new Error("Set CHROME_PATH to a Chromium executable.");
const repo = new URL("../", import.meta.url);
const DEFAULT_DROP_DIR = "C:/ComfyUI/input/szandor_folder_media";

// Folder contents per directory; the drop stub mimics import_dropped for the cases tested here.
const folders = {
    "D:/set": [{ name: "a", image: "a.png", json: "a.json" }, { name: "b", image: "b.png", json: "b.json" }],
    [DEFAULT_DROP_DIR]: [],
};
const drops = [];
const kindOf = name => /\.json$/i.test(name) ? "json" : /\.txt$/i.test(name) ? "txt" : "image";

const html = `<!doctype html><html><head><meta charset="UTF-8"></head>
<body style="background:#252930;padding:30px"><script type="module">
import { app } from '/scripts/app.js';
import '/web/folder_media_loader.js';
class Host {
  constructor() {
    this.id = 1; this.size = [380, 640]; this.graph = app.graph;
    const w = (name, value) => ({ name, value });
    this.widgets = [w('directory', 'D:/set'), w('seed', 0), w('media_filter', 'obrazy'), w('default_time', 5), w('fps', 24), w('time_output', 'liczba')];
  }
  addDOMWidget(name, type, element, options) {
    this.element = element; document.body.append(element);
    element.style.width = '380px'; element.style.height = '560px';
    const widget = { name, type, element, options };
    Object.defineProperty(widget, 'value', { get: options.getValue, set: options.setValue });
    this.widgets.push(widget); return widget;
  }
  setSize(size) { this.size = size; }
  setDirtyCanvas() {}
}
const extension = app.extensions[0];
extension.beforeRegisterNodeDef(Host, { name: 'SzandorFolderMediaLoader' });
window.node = new Host(); node.onNodeCreated();
window.widget = name => node.widgets.find(w => w.name === name);
window.pageDrops = 0;
document.addEventListener('drop', () => window.pageDrops++);
window.dropFiles = (files, target = node.element) => {
  const dataTransfer = new DataTransfer();
  for (const file of files) dataTransfer.items.add(file);
  const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer });
  target.dispatchEvent(over);
  const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer });
  target.dispatchEvent(drop);
  return { over: over.defaultPrevented, drop: drop.defaultPrevented };
};
window.statusText = () => document.querySelector('.fml-status').textContent;
window.ready = true;
</script></body></html>`;

const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, "http://x");
        if (url.pathname === "/") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(html); return; }
        if (url.pathname === "/scripts/app.js") {
            res.setHeader("Content-Type", "text/javascript");
            res.end("export const app = { extensions: [], graph: { change() {}, getNodeById() {} }, registerExtension(e) { this.extensions.push(e); }, async queuePrompt() {} };"); return;
        }
        if (url.pathname === "/scripts/api.js") {
            res.setHeader("Content-Type", "text/javascript");
            res.end("export const api = { fetchApi: (path, options) => fetch(path, options), apiURL: path => path };"); return;
        }
        if (url.pathname === "/szandor/folder-media/list") {
            const items = folders[url.searchParams.get("directory")];
            const filter = url.searchParams.get("filter");
            const shown = (items ?? []).filter(i => filter !== "obrazy" || i.image);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ exists: !!items, items: shown, signature: JSON.stringify(shown) })); return;
        }
        if (url.pathname === "/szandor/folder-media/info") {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ prompt: `prompt ${url.searchParams.get("name")}`, time: 5, time_source: "json", start_time: 0, end_time: 5 })); return;
        }
        if (url.pathname === "/szandor/folder-media/preview") { res.writeHead(404).end("none"); return; }
        if (url.pathname === "/szandor/folder-media/drop" && req.method === "POST") {
            const form = await new Response(req, { headers: { "content-type": req.headers["content-type"] }, duplex: "half" }).formData();
            const directory = form.get("directory") || DEFAULT_DROP_DIR;
            const files = form.getAll("file").map(f => f.name);
            drops.push({ directory: form.get("directory"), files });
            res.setHeader("Content-Type", "application/json");
            if (!folders[directory]) { res.writeHead(400).end(JSON.stringify({ error: `Katalog nie istnieje: ${directory}` })); return; }
            const saved = [];
            const names = [];
            for (const file of files) {
                const stem = file.replace(/\.[^.]+$/, "");
                let item = folders[directory].find(i => i.name === stem);
                if (!item) folders[directory].push(item = { name: stem });
                if (!item[kindOf(file)]) { item[kindOf(file)] = file; saved.push(file); }
                if (!names.includes(stem)) names.push(stem);
            }
            res.end(JSON.stringify({ names, saved, renamed: {}, skipped: [], directory })); return;
        }
        if (!/^\/web\/[a-z0-9_]+\.(js|css)$/.test(url.pathname)) { res.writeHead(404).end(); return; }
        res.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "text/javascript");
        res.end(await readFile(new URL(url.pathname.slice(1), repo)));
    } catch (error) { res.writeHead(500).end(String(error)); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const profile = await mkdtemp(`${tmpdir()}/szandor-fml-test-`);
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
        throw new Error(`Timed out waiting for ${label}: ${await evaluate("statusText()")}`);
    };
    await cdp("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    await waitFor("window.ready === true", "page");
    await waitFor("document.querySelector('.fml-counter').textContent.startsWith('1 / 2')", "initial list");

    // An image already in the folder selects its item (the JSON comes with it), without copying anything.
    assert.deepEqual(await evaluate("dropFiles([new File(['png'], 'b.png', { type: 'image/png' })])"), { over: true, drop: true });
    await waitFor("widget('seed').value === 1", "seed of b");
    assert.equal(await evaluate("pageDrops"), 0);
    assert.deepEqual(drops.at(-1), { directory: "D:/set", files: ["b.png"] });
    await waitFor("document.querySelector('.fml-prompt').textContent === 'prompt b'", "prompt of b");
    assert.match(await evaluate("statusText()"), /Wybrano: b/);

    // A new prompt-only item hidden by the "obrazy" filter switches the filter to "wszystko".
    await evaluate("dropFiles([new File(['{}'], 'c.json'), new File(['x'], 'notes.md')])");
    await waitFor("widget('seed').value === 2", "seed of c");
    assert.equal(await evaluate("widget('media_filter').value"), "wszystko");
    assert.deepEqual(drops.at(-1).files, ["c.json"]);
    assert.match(await evaluate("statusText()"), /Dodano: c\.json/);
    await new Promise(r => setTimeout(r, 700)); // the settings watcher must not reset the selection
    assert.equal(await evaluate("widget('seed').value"), 2);
    assert.match(await evaluate("document.querySelector('.fml-counter').textContent"), /^3 \/ 3/);

    // Unsupported files never reach the server.
    const before = drops.length;
    await evaluate("dropFiles([new File(['x'], 'readme.md')])");
    await waitFor("statusText().includes('Przeciągnij obraz')", "unsupported warning");
    assert.equal(drops.length, before);

    // Drop on the canvas-drawn part of the node goes through onDragOver / onDragDrop.
    assert.equal(await evaluate(`(() => {
      const dataTransfer = new DataTransfer(); dataTransfer.items.add(new File(['png'], 'a.png'));
      const event = new DragEvent('drop', { dataTransfer });
      window.canvasDrop = node.onDragOver(event) && node.onDragDrop(event);
      return node.onDragOver(new DragEvent('dragover', { dataTransfer: new DataTransfer() }));
    })()`), false);
    assert.equal(await evaluate("canvasDrop"), true);
    await waitFor("widget('seed').value === 0", "seed of a");

    // Without a directory the files go to the default input folder, which becomes the node's directory.
    await evaluate("const d = document.querySelector('.fml-dir'); d.value = ''; d.dispatchEvent(new Event('change'))");
    await waitFor("document.querySelector('.fml-counter').textContent === '—'", "empty directory");
    await evaluate("dropFiles([new File(['png'], 'new.png'), new File(['{}'], 'new.json')])");
    await waitFor(`widget('directory').value === ${JSON.stringify(DEFAULT_DROP_DIR)}`, "default directory");
    assert.deepEqual(drops.at(-1), { directory: "", files: ["new.png", "new.json"] });
    await waitFor("document.querySelector('.fml-counter').textContent.startsWith('1 / 1')", "new item");
    assert.match(await evaluate("statusText()"), /Dodano: new\.png, new\.json/);

    // Server errors are reported in the status line.
    await evaluate("const e = document.querySelector('.fml-dir'); e.value = 'Z:/missing'; e.dispatchEvent(new Event('change'))");
    await evaluate("dropFiles([new File(['png'], 'x.png')])");
    await waitFor("statusText().includes('Katalog nie istnieje')", "error status");
    assert.ok(await evaluate("document.querySelector('.fml-status').classList.contains('fml-warn')"));

    assert.deepEqual(errors, []);
    console.log("PASS: drop selects existing item, copies new files, switches filter, ignores unsupported files, canvas drop hooks, default directory, error status.");
} finally {
    chrome.kill();
    await new Promise(resolve => chrome.exitCode !== null ? resolve() : chrome.once("exit", resolve));
    server.close();
    for (const { timer } of pending.values()) clearTimeout(timer);
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
