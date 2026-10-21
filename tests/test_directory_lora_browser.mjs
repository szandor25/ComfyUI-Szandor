// CHROME_PATH=/path/to/chrome node tests/test_directory_lora_browser.mjs
// Real browser interaction with a stubbed ComfyUI host and server responses.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve, basename } from "node:path";

const chromePath = process.env.CHROME_PATH;
if (!chromePath) throw new Error("Set CHROME_PATH to a Chromium executable.");
const repo = new URL("../", import.meta.url);
const base = "F:/AI_MODELE/datasets";
const initial = `${base}/kirade_solas`;
const sibling = `${base}/zażółć & #`;
const folders = {
    "": { directory: "", parent: null, directories: [{ name: "F:/", path: "F:/" }], images: [] },
    "F:/": { directory: "F:/", parent: "", directories: [{ name: "datasets", path: base }], images: [] },
    [base]: { directory: base, parent: "F:/", directories: [
        { name: "kirade_solas", path: initial }, { name: "zażółć & #", path: sibling },
        { name: "empty", path: `${base}/empty` },
    ], images: [] },
    [initial]: { directory: initial, parent: base, directories: [], images: ["image2.png", "image10.png"] },
    [sibling]: { directory: sibling, parent: base, directories: [], images: ["obraz #2.png", "obraz #10.png"] },
    [`${base}/empty`]: { directory: `${base}/empty`, parent: base, directories: [], images: [] },
};
const html = `<!doctype html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;background:#202020;color:#eee;font:14px sans-serif"><canvas width="1200" height="900"></canvas>
<script type="module">
import { app } from '/scripts/app.js';
import '/web/directory_image_loader.js';
import '/web/lora_stack_loader.js';
app.canvasEl = document.querySelector('canvas');
class Host {
  constructor(widgets) { this.widgets = widgets; this.size = [520, 360]; this.pos = [0, 0]; }
  computeSize() { return [520, 380]; }
  setSize(size) { this.size = size; }
  setDirtyCanvas() { requestAnimationFrame(() => window.draw?.()); }
}
await app.extensions.find(e => e.name === 'Szandor.DirectoryImageLoader').beforeRegisterNodeDef(Host, { name: 'SzandorDirectoryImageLoader' });
window.directoryNode = new Host([{ name: 'directory', value: ${JSON.stringify(initial)} }, { name: 'filename', value: '' }]);
directoryNode.onNodeCreated();
class StackHost {
  constructor() { this.size = [520, 180]; this.properties = {}; this.widgets = [{ name: 'lora_stack', value: JSON.stringify([
    { name: 'portraits/kirade_solas.safetensors', enabled: true, strength: 1, trigger: 'kirade_solas', use_trigger: true },
    { name: 'styles/soft_light.safetensors', enabled: true, strength: 0.75, trigger: 'soft light', use_trigger: false },
  ]) }]; }
  computeSize() { return this._szandorLoraStackWidget?.computeSize(this.size[0]) ?? [520, 180]; }
  setSize(size) { this.size = size; }
  setDirtyCanvas() { requestAnimationFrame(() => window.draw?.()); }
}
await app.extensions.find(e => e.name === 'Szandor.LoraStackLoader').beforeRegisterNodeDef(StackHost, { name: 'SzandorLoraStackLoader' });
window.stackNode = new StackHost(); stackNode.onNodeCreated();
window.stack = stackNode._szandorLoraStackWidget;
window.draw = () => {
  const ctx = app.canvasEl.getContext('2d'); ctx.clearRect(0, 0, 1200, 900);
  ctx.fillStyle = '#eee'; ctx.font = '16px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('Load Image From Directory v2', 24, 30);
  directoryNode._szandorDirWidget.last_y = 50;
  directoryNode._szandorDirWidget.draw(ctx, directoryNode, 520, 50);
  directoryNode._szandorPreview.last_y = 90;
  directoryNode._szandorPreview.draw(ctx, directoryNode, 520, 90);
  ctx.fillStyle = '#eee'; ctx.font = '16px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('LoRA Stack with Thumbnails', 24, 410);
  stack.last_y = 430; stack.draw(ctx, stackNode, 520, 430);
};
app.canvasEl.onpointerdown = event => {
  if (event.offsetY < 90) directoryNode._szandorDirWidget.mouse(event, [event.offsetX, event.offsetY], directoryNode);
  else if (event.offsetY >= 430) stack.mouse(event, [event.offsetX, event.offsetY]);
};
window.clickButton = text => [...document.querySelectorAll('button')].find(b => b.textContent === text).click();
window.openBrowser = () => directoryNode._szandorDirWidget.mouse({ type: 'pointerdown' }, [450, 65], directoryNode);
window.ready = true; draw();
</script></body></html>`;

const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, "http://x");
        if (url.pathname === "/") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(html); return; }
        if (url.pathname === "/scripts/app.js") {
            res.setHeader("Content-Type", "text/javascript");
            res.end("export const app = { extensions: [], canvas: { prompt(label, initial, commit) { window.numericCommit = commit; } }, registerExtension(e) { this.extensions.push(e); } };"); return;
        }
        if (url.pathname === "/scripts/api.js") {
            res.setHeader("Content-Type", "text/javascript");
            res.end("export const api = { fetchApi: path => fetch(path), apiURL: path => path };"); return;
        }
        if (url.pathname.startsWith("/szandor/")) {
            const directory = url.searchParams.get("directory");
            const folder = folders[directory];
            res.setHeader("Content-Type", "application/json");
            if (url.pathname === "/szandor/browse-directory") {
                if (!folder) res.statusCode = 404;
                res.end(JSON.stringify(folder ?? { error: "Folder does not exist." })); return;
            }
            if (url.pathname === "/szandor/dir-images") {
                const send = () => res.end(JSON.stringify({ images: folder?.images ?? [], signature: directory }));
                if (directory === initial) setTimeout(send, 120); else send();
                return;
            }
            if (url.pathname === "/szandor/loras") { res.end(JSON.stringify({ loras: ["portraits/kirade_solas.safetensors", "styles/soft_light.safetensors"] })); return; }
            if (url.pathname === "/szandor/lora-triggers") { res.end(JSON.stringify({ trigger: "from file", suggestions: [{ text: "portrait", source: "class_tokens" }] })); return; }
            res.writeHead(404).end(); return;
        }
        if (!/^\/web\/[a-z0-9_]+\.js$/.test(url.pathname)) { res.writeHead(404).end(); return; }
        res.setHeader("Content-Type", "text/javascript");
        res.end(await readFile(new URL(url.pathname.slice(1), repo)));
    } catch (error) { res.writeHead(500).end(String(error)); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const profile = await mkdtemp(`${tmpdir()}/szandor-directory-lora-`);
const chrome = spawn(chromePath, ["--headless", "--no-sandbox", "--disable-gpu", "--no-first-run", "--disable-background-networking", "--window-size=1200,1000", `--user-data-dir=${profile}`, "--remote-debugging-pipe", "about:blank"], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
let sequence = 0, buffer = "", stderr = "";
const pending = new Map(), errors = [];
chrome.stderr.on("data", data => { stderr += data; });
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
    const waitFor = async expression => {
        for (let i = 0; i < 100; i++) {
            if (await evaluate(expression)) return;
            await new Promise(resolve => setTimeout(resolve, 30));
        }
        throw new Error(`Timed out: ${expression}`);
    };
    const screenshot = async suffix => {
        if (!process.env.NODE_UI_SCREENSHOT) return;
        const shot = await cdp("Page.captureScreenshot", { format: "png" });
        await writeFile(`${process.env.NODE_UI_SCREENSHOT}-${suffix}.png`, Buffer.from(shot.data, "base64"));
    };
    await cdp("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    await waitFor("window.ready && directoryNode._szandorPreview.value === 'image2.png'");
    // Open Browse using the actual canvas pointer event.
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: 450, y: 65, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: 450, y: 65, button: "left", clickCount: 1 });
    await waitFor("document.querySelector('[role=status]')?.textContent.includes('2 images')");
    await evaluate("clickButton('↑ Up')");
    await waitFor("document.querySelector('[role=status]')?.textContent.includes('3 folders')");
    assert.equal(await evaluate("document.querySelector('input').value"), base);
    await screenshot("folders");
    await evaluate("clickButton('📁 zażółć & #')");
    await waitFor("document.querySelector('[role=status]')?.textContent.includes('2 images')");
    await evaluate("clickButton('▧ obraz #10.png')");
    await waitFor("directoryNode._szandorPreview.value === 'obraz #10.png'");
    assert.deepEqual(await evaluate("directoryNode.widgets.map(w => w.serializeValue())"), [sibling, "obraz #10.png"]);
    await evaluate("openBrowser()");
    await waitFor("document.querySelector('[role=status]')?.textContent.includes('2 images')");
    await evaluate("clickButton('↑ Up')");
    await waitFor("document.querySelector('[role=status]')?.textContent.includes('3 folders')");
    await evaluate("clickButton('Cancel')");
    assert.equal(await evaluate("directoryNode._szandorDirWidget.value"), sibling);
    await evaluate("openBrowser()");
    await waitFor("document.querySelector('[role=status]')?.textContent.includes('2 images')");
    await evaluate(`document.querySelector('input').value = ${JSON.stringify(`${base}/empty`)}; clickButton('Open')`);
    await waitFor("document.querySelector('[role=status]')?.textContent.includes('0 folders · 0 images')");
    assert.match(await evaluate("document.querySelector('[role=dialog]').textContent"), /No subfolders or supported images/);
    await evaluate("document.querySelector('input').value = 'missing'; clickButton('Open')");
    await waitFor("document.querySelector('[role=status]')?.textContent === 'Folder does not exist.'");
    assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Use this folder').disabled"), true);
    await evaluate("clickButton('Roots')");
    await waitFor("document.querySelector('[role=status]')?.textContent.includes('Choose a drive')");
    await evaluate("clickButton('Cancel')");
    // An old slow folder response must not overwrite a newer selection.
    await evaluate(`directoryNode._szandorDirWidget.commit(${JSON.stringify(initial)}); directoryNode._szandorDirWidget.commit(${JSON.stringify(sibling)}, 'obraz #10.png')`);
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(await evaluate("directoryNode._szandorPreview.value"), "obraz #10.png");
    await evaluate("stack.mouse({type:'pointerdown'}, [475, 522])");
    await waitFor("document.querySelector('textarea[aria-label=Notes]') !== null");
    await evaluate("document.querySelector('textarea[aria-label=Notes]').value = 'Uwagi: najlepsza siła 0,75.\\nDobrze działa z miękkim światłem.'");
    await screenshot("notes");
    await evaluate("clickButton('Read from file')");
    await waitFor("document.querySelector('textarea[aria-label=Trigger]').value === 'from file'");
    assert.match(await evaluate("document.querySelector('textarea[aria-label=Notes]').value"), /Uwagi/);
    await evaluate("clickButton('Save'); stack.value = stack.serializeValue(); stack.setRowsFromValue()");
    assert.match(await evaluate("stack.rows[0].notes"), /miękkim światłem/);
    await evaluate("stack.mouse({type:'pointerdown'}, [470, 486]); stack.mouse({type:'pointerdown'}, [432, 486]); numericCommit('0,73')");
    assert.equal(await evaluate("stack.rows[0].strength"), 0.73);
    assert.equal(await evaluate("stack.rows[1].strength"), 0.75);
    await screenshot("nodes");
    assert.deepEqual(errors, []);
    console.log("PASS: canvas Browse button, parent/sibling navigation, image selection, Cancel, empty/missing folders, roots, stale requests, notes save/restore and metadata isolation, strength controls.");
} finally {
    chrome.kill();
    await new Promise(resolve => chrome.exitCode !== null ? resolve() : chrome.once("exit", resolve));
    server.close();
    for (const { timer } of pending.values()) clearTimeout(timer);
    if (dirname(resolve(profile)) !== resolve(tmpdir()) || !basename(profile).startsWith("szandor-directory-lora-")) throw new Error("Unsafe temporary profile path");
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
