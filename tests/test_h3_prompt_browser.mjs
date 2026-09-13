// No npm dependencies. Run with CHROME_PATH=/path/to/chrome node tests/test_h3_prompt_browser.mjs.
// Uses a minimal ComfyUI widget host; does not load models or run generation.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const chromePath = process.env.CHROME_PATH;
if (!chromePath) throw new Error("Set CHROME_PATH to a Chromium executable.");
const repo = new URL("../", import.meta.url);
let savedTemplate = null;
let deleteRequests = 0;
const html = `<!doctype html><html><head><meta charset="UTF-8"></head>
<body style="background:#252930;padding:30px"><script type="module">
import { app } from '/scripts/app.js';
import '/web/minimax_h3_prompt.js';
class Host {
  constructor() { this.id = 1; this.size = [640,480]; this.properties = {}; this.widgets = []; this.graph = app.graph; }
  addDOMWidget(name, type, element, options) {
    this.element = element; document.body.append(element);
    const widget = { name, type, element, options, onRemove() { element.remove(); } };
    Object.defineProperty(widget, 'value', { get: options.getValue, set: options.setValue });
    this.widgets.push(widget); this.setSize(this.size); return widget;
  }
  setSize(size) { this.size = size; if(this.element) { this.element.style.width = size[0]+'px'; this.element.style.height = (size[1]-60)+'px'; } this.onResize?.(size); }
  setDirtyCanvas() {}
}
const extension = app.extensions[0];
extension.beforeRegisterNodeDef(Host, {name:'SzandorMiniMaxH3Prompt'});
window.makeNode = () => {
  const node = new Host();
  extension.getCustomWidgets().SZANDOR_H3_PROMPT(node, 'prompt', ['STRING', {default:''}]);
  node.onNodeCreated(); return node;
};
window.node = makeNode(); window.widget = node.widgets[0];
app.graph.getNodeById = id => id === 1 ? node : { id:2, type:'LoadImage', widgets:[{name:'image',value:'reference.png'}], outputs:[{type:'IMAGE'}] };
app.graph.serialize = () => ({nodes:[{id:1,type:'SzandorMiniMaxH3Prompt',widgets_values:[widget.value]},{id:2,type:'LoadImage',widgets_values:['reference.png']}],links:[]});
window.ready = true;
</script></body></html>`;
const server = createServer(async (req, res) => {
    try {
        if (req.url === "/") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(html); return; }
        if (req.url === "/scripts/app.js") {
            res.setHeader("Content-Type", "text/javascript");
            res.end("export const app = { extensions: [], graph: { change() {}, beforeChange() {}, afterChange() {} }, async loadGraphData(data) { window.loadedWorkflow = data; }, registerExtension(e) { this.extensions.push(e); } };"); return;
        }
        if (req.url === "/scripts/api.js") {
            res.setHeader("Content-Type", "text/javascript");
            res.end("export const api = { fetchApi: (path, options) => fetch(path, options), apiURL: path => path };"); return;
        }
        if (req.url.startsWith("/szandor/h3-templates")) {
            res.setHeader("Content-Type", "application/json");
            if (req.method === "DELETE") {
                assert.equal(req.url, `/szandor/h3-templates/${savedTemplate.id}`);
                deleteRequests++;
                savedTemplate = null;
                res.end(JSON.stringify({ deleted: "a".repeat(32) })); return;
            }
            if (req.method === "POST" && req.url.endsWith("/restore")) {
                const workflow = structuredClone(savedTemplate.workflow);
                workflow.nodes[1].widgets_values[0] = "szandor_h3_templates/copy.png";
                res.end(JSON.stringify({ workflow })); return;
            }
            if (req.method === "POST") {
                let body = "";
                for await (const chunk of req) body += chunk;
                savedTemplate = { ...JSON.parse(body), id: "a".repeat(32), created_at: new Date().toISOString() };
                savedTemplate.images = savedTemplate.images.map(ref => ({ ...ref, file: "image.png", original_name: "reference.png" }));
                res.end(JSON.stringify(savedTemplate)); return;
            }
            if (req.url.includes("/images/")) { res.writeHead(404).end(); return; }
            res.end(JSON.stringify(req.url === "/szandor/h3-templates" ? (savedTemplate ? [savedTemplate] : []) : savedTemplate)); return;
        }
        if (!/^\/web\/[a-z0-9_]+\.(js|css)$/.test(req.url)) { res.writeHead(404).end(); return; }
        res.setHeader("Content-Type", req.url.endsWith("css") ? "text/css" : "text/javascript");
        res.end(await readFile(new URL(req.url.slice(1), repo)));
    } catch (error) { res.writeHead(500).end(String(error)); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const profile = await mkdtemp(`${tmpdir()}/szandor-h3-test-`);
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
    await cdp("Page.enable");
    const evaluate = async expression => {
        const result = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
    };
    await cdp("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
    for (let i = 0; i < 100; i++) {
        if (await evaluate("window.ready === true")) break;
        await new Promise(r => setTimeout(r, 50));
    }
    assert.equal(await evaluate("window.ready"), true);
    const settle = () => evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))");
    await evaluate("widget.inputEl.focus()");
    const text = "Zażółć gęślą jaźń! {red|blue} <img src=x onerror=alert(1)>";
    await cdp("Input.insertText", { text });
    await settle();
    assert.equal(await evaluate("widget.serializeValue()"), text);
    assert.equal(await evaluate("document.querySelectorAll('.h3-highlight img').length"), 0);
    await evaluate("widget.inputEl.setSelectionRange(0, 'Zażółć gęślą jaźń!'.length); document.querySelector('.h3-button').click()");
    await settle();
    assert.ok((await evaluate("widget.value")).startsWith("<d>[Polish] Zażółć gęślą jaźń!</d>"));
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", modifiers: 2, windowsVirtualKeyCode: 90 });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", modifiers: 2, windowsVirtualKeyCode: 90 });
    assert.equal(await evaluate("widget.value"), text);

    // Clipboard replacement affects the whole prompt and remains undoable.
    await evaluate("Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{readText:async()=> '  <d>[Polish] Nowy prompt!</d>\\n'}}); widget.inputEl.setSelectionRange(2,5); document.querySelector('.h3-paste').click()");
    await settle();
    assert.equal(await evaluate("widget.serializeValue()"), "  <d>[Polish] Nowy prompt!</d>\n");
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", modifiers: 2, windowsVirtualKeyCode: 90 });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", modifiers: 2, windowsVirtualKeyCode: 90 });
    assert.equal(await evaluate("widget.value"), text);
    await evaluate("navigator.clipboard.readText=async()=>''; document.querySelector('.h3-paste').click()");
    await settle();
    assert.equal(await evaluate("widget.value"), text);
    assert.match(await evaluate("document.querySelector('.h3-clipboard-status').textContent"), /nie zawiera tekstu/);
    await evaluate("navigator.clipboard.readText=async()=>{throw new Error('denied')}; document.querySelector('.h3-paste').click()");
    await settle();
    assert.equal(await evaluate("widget.value"), text);
    assert.equal(await evaluate("widget.inputEl.selectionEnd-widget.inputEl.selectionStart"), text.length);
    assert.match(await evaluate("document.querySelector('.h3-clipboard-status').textContent"), /Ctrl\+V/);
    await evaluate("navigator.clipboard.readText=()=>new Promise(resolve=>window.finishClipboard=resolve); document.querySelector('.h3-paste').click(); widget.value='Changed while waiting'; finishClipboard('stale clipboard')");
    await settle();
    assert.equal(await evaluate("widget.value"), "Changed while waiting");
    assert.equal(await evaluate("document.querySelector('.h3-paste').disabled"), false);

    await evaluate("widget.value = '<d>[Polish] Niedomknięty dialog';");
    assert.equal(await evaluate("document.querySelector('.h3-status').disabled"), false);
    await evaluate("document.querySelector('.h3-status').click()");
    assert.equal(await evaluate("widget.inputEl.value.slice(widget.inputEl.selectionStart, widget.inputEl.selectionEnd)"), "<d>");

    await evaluate("widget.value = ('[Shot 1] (S1) says <d>[Polish] ' + 'Bardzo długi tekst '.repeat(12) + '</d>\\n').repeat(20); widget.inputEl.scrollTop = 230; widget.inputEl.dispatchEvent(new Event('scroll'));");
    await settle();
    assert.equal(await evaluate("document.querySelector('.h3-highlight').scrollTop"), await evaluate("widget.inputEl.scrollTop"));
    assert.equal(await evaluate("document.querySelector('.h3-highlight').clientWidth"), await evaluate("widget.inputEl.clientWidth"));
    assert.ok(await evaluate("Math.abs(document.querySelector('.h3-highlight').scrollHeight - widget.inputEl.scrollHeight) <= 23"));

    // Resize through the visible grip at a non-unit canvas zoom.
    await evaluate("node.element.style.transformOrigin='top left'; node.element.style.transform='scale(0.75)'");
    const grip = await evaluate("(() => { const r=document.querySelector('.h3-grip').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()");
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...grip, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: grip.x + 75, y: grip.y + 60, button: "left", buttons: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: grip.x + 75, y: grip.y + 60, button: "left", clickCount: 1 });
    const size = await evaluate("node.size");
    assert.ok(Math.abs(size[0] - 740) < 2, `resized width ${size}`);
    assert.ok(Math.abs(size[1] - 560) < 2, `resized height ${size}`);
    const restored = await evaluate(`(() => {
      const data = {size:[...node.size], properties:{}, widgets_values:[widget.value]}; node.onSerialize(data);
      const saved = JSON.parse(JSON.stringify(data)); const copy = makeNode();
      copy.widgets[0].value=saved.widgets_values[0]; copy.onConfigure(saved);
      const result={size:copy.size, text:copy.widgets[0].serializeValue(), savedSize:saved.properties.szandorH3EditorSize};
      copy.widgets[0].onRemove(); return result;
    })()`);
    assert.deepEqual(restored.size, size);
    assert.deepEqual(restored.savedSize, size);
    assert.equal(restored.text, await evaluate("widget.value"));
    // Save and load through the visible library; backend copy integrity is tested in Python.
    await evaluate("widget.value = '  <d>[Polish] Szablon!</d>\\n'; [...node.element.querySelectorAll('button')].find(b=>b.textContent==='Szablony').click()");
    await evaluate("document.querySelector('[aria-label=\"Nazwa szablonu\"]').value='Moja scena'; document.querySelector('[aria-label=\"Informacyjny czas trwania w sekundach\"]').value='8.5'; document.querySelector('.h3-template-form').requestSubmit()");
    for (let i = 0; i < 100; i++) {
        if (await evaluate("document.querySelector('.h3-template-preview button')?.disabled === false")) break;
        await new Promise(r => setTimeout(r, 50));
    }
    assert.equal(savedTemplate.prompt, "  <d>[Polish] Szablon!</d>\n");
    assert.equal(savedTemplate.images.length, 1);
    assert.equal(savedTemplate.duration, 8.5);
    assert.equal(await evaluate("document.querySelector('.h3-template-prompt').textContent"), savedTemplate.prompt);
    assert.equal(await evaluate("document.querySelectorAll('.h3-template-gallery img').length"), 1);
    await evaluate("document.querySelector('.h3-template-preview button').click()");
    for (let i = 0; i < 100; i++) {
        if (await evaluate("!document.querySelector('.h3-template-dialog')")) break;
        await new Promise(r => setTimeout(r, 50));
    }
    assert.equal(await evaluate("loadedWorkflow.nodes[1].widgets_values[0]"), "szandor_h3_templates/copy.png");
    assert.equal(await evaluate("loadedWorkflow.nodes[0].widgets_values[0]"), savedTemplate.prompt);
    await evaluate("[...node.element.querySelectorAll('button')].find(b=>b.textContent==='Szablony').click()");
    for (let i = 0; i < 100; i++) {
        if (await evaluate("!!document.querySelector('.h3-template-list button')")) break;
        await new Promise(r => setTimeout(r, 50));
    }
    await evaluate("document.querySelector('.h3-template-list button').click()");
    for (let i = 0; i < 100; i++) {
        if (await evaluate("!!document.querySelector('.h3-template-actions .h3-template-delete')")) break;
        await new Promise(r => setTimeout(r, 50));
    }
    await evaluate("document.querySelector('.h3-template-actions .h3-template-delete').click()");
    assert.equal(await evaluate("document.querySelector('.h3-template-delete-confirm').hidden"), false);
    assert.equal(deleteRequests, 0);
    await evaluate("[...document.querySelectorAll('.h3-template-delete-confirm button')].find(b=>b.textContent==='Anuluj').click()");
    assert.equal(await evaluate("document.querySelector('.h3-template-delete-confirm').hidden"), true);
    assert.equal(deleteRequests, 0);
    await evaluate("document.querySelector('.h3-template-actions .h3-template-delete').click(); document.querySelector('.h3-template-delete-confirm .h3-template-delete').click()");
    for (let i = 0; i < 100; i++) {
        if (await evaluate("document.querySelector('.h3-template-message').textContent.startsWith('Usunięto') && !document.querySelector('.h3-template-list button')")) break;
        await new Promise(r => setTimeout(r, 50));
    }
    assert.equal(deleteRequests, 1);
    assert.equal(savedTemplate, null);
    assert.equal(await evaluate("document.querySelector('.h3-template-preview').children.length"), 0);
    assert.equal(await evaluate("loadedWorkflow.nodes[1].widgets_values[0]"), "szandor_h3_templates/copy.png");
    await evaluate("document.querySelector('.h3-template-heading button').click()");
    await evaluate("node.element.style.transform=''; widget.value='integrated_multimodal_description: [Shot 1] A woman (S1) says: <d>[Polish] Cześć!</d>\\n\\noverall_soundscape: Wind moves through the trees.\\n\\nnon_diegetic_music: N/A'; widget.inputEl.setSelectionRange(80,80)");
    await settle();
    if (process.env.H3_SCREENSHOT) {
        const shot = await cdp("Page.captureScreenshot", { format: "png" });
        await writeFile(process.env.H3_SCREENSHOT, Buffer.from(shot.data, "base64"));
    }
    await evaluate("widget.onRemove()");
    assert.equal(await evaluate("document.querySelectorAll('.szandor-h3-editor').length"), 0);
    assert.deepEqual(errors, []);
    console.log("PASS: native input, clipboard replacement + undo/failure/empty/race, HTML escaping, insertion + undo, diagnostics, wrap/scroll alignment, zoomed resize, workflow round-trip, template save/load/delete/cancel, cleanup.");
} finally {
    chrome.kill();
    await new Promise(resolve => chrome.exitCode !== null ? resolve() : chrome.once("exit", resolve));
    server.close();
    for (const { timer } of pending.values()) clearTimeout(timer);
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
