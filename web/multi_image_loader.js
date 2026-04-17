import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_TYPE   = "MultiImageLoader";
const MAX_IMAGES  = 16;
const H_EMPTY     = 52;
const H_FILLED    = 148;
const THUMB_MAX_H = 96;
const PAD         = 8;

// ─── thumbnail cache ──────────────────────────────────────────────────────────

const thumbCache = new Map();

function fetchThumb(filename) {
    if (!filename) return Promise.resolve(null);
    if (thumbCache.has(filename)) return Promise.resolve(thumbCache.get(filename));
    return new Promise(resolve => {
        const img = new Image();
        img.onload  = () => { thumbCache.set(filename, img); resolve(img); };
        img.onerror = () => resolve(null);
        img.src = api.apiURL(
            `/view?filename=${encodeURIComponent(filename)}&type=input&subfolder=`
        );
    });
}

// ─── upload helper ────────────────────────────────────────────────────────────

async function uploadFile(file) {
    const body = new FormData();
    body.append("image", file);
    body.append("type", "input");
    body.append("overwrite", "false");
    try {
        const r = await api.fetchApi("/upload/image", { method: "POST", body });
        if (!r.ok) return null;
        return (await r.json()).name ?? null;
    } catch { return null; }
}

// ─── convert client coords → graph coords ────────────────────────────────────

function clientToGraph(clientX, clientY) {
    const rect  = app.canvasEl.getBoundingClientRect();
    const ds    = app.canvas.ds;
    const scale = ds.scale ?? 1;
    const off   = ds.offset ?? [0, 0];
    return [
        (clientX - rect.left) / scale - off[0],
        (clientY - rect.top)  / scale - off[1],
    ];
}

// ─── drop handling (shared) ───────────────────────────────────────────────────

async function handleFileDrop(node, files) {
    const countW = node.widgets?.find(w => w.name === "image_count");
    let count = countW?.value ?? 1;

    for (const file of files) {
        // find first empty visible slot
        let target = null;
        for (let i = 1; i <= count; i++) {
            const w = slotWidget(node, i);
            if (w && !w.value) { target = w; break; }
        }

        // no empty slot → auto-expand if possible
        if (!target && count < MAX_IMAGES) {
            count++;
            if (countW) {
                countW.value = count;
                // trigger slider callback manually
                countW.callback?.(count);
            } else {
                syncNode(node, count);
            }
            target = slotWidget(node, count);
        }

        if (!target) break; // all slots full

        const name = await uploadFile(file);
        if (name) await target.applyImage(name);
    }
}

function slotWidget(node, i) {
    return node.widgets?.find(w => w.name === `image_${String(i).padStart(2, "0")}`);
}

// ─── single image-slot widget factory ────────────────────────────────────────

function makeSlotWidget(node, idx) {
    const w = {
        type:    "SZANDOR_IMGSLOT",
        name:    `image_${String(idx).padStart(2, "0")}`,
        value:   "",
        _thumb:  null,
        _hidden: false,

        hide() { this._hidden = true; },
        show() { this._hidden = false; },

        // computeSize must reflect thumb state EXACTLY
        computeSize(width) {
            if (this._hidden) return [0, -4];
            return [width, this._thumb ? H_FILLED : H_EMPTY];
        },

        // Non-blocking thumb load (called from onConfigure)
        loadThumbAsync() {
            if (!this.value) { this._thumb = null; return; }
            fetchThumb(this.value).then(t => {
                this._thumb = t;
                node.setSize(node.computeSize());
                node.setDirtyCanvas(true, true);
            });
        },

        // Awaitable version used on user interaction
        async applyImage(filename) {
            this.value  = filename ?? "";
            this._thumb = null;
            // Force an immediate redraw so slot collapses/expands before thumb arrives
            node.setSize(node.computeSize());
            node.setDirtyCanvas(true, true);
            if (this.value) {
                this._thumb = await fetchThumb(this.value);
                node.setSize(node.computeSize());
                node.setDirtyCanvas(true, true);
            }
        },

        // ── drawing ───────────────────────────────────────────────────────────
        draw(ctx, _node, width, y, height) {
            if (this._hidden) return;

            const iw = width - PAD * 2;

            // background
            ctx.fillStyle = this._thumb ? "#152015" : "#1e1e1e";
            ctx.fillRect(PAD, y + 2, iw, height - 4);

            // border
            ctx.strokeStyle = this._thumb ? "#4a8a4a" : "#3a3a3a";
            ctx.lineWidth = 1;
            ctx.strokeRect(PAD, y + 2, iw, height - 4);

            if (this._thumb) {
                // INSET: gap between border line and inner elements
                const INSET   = 8;
                const innerW  = iw - INSET * 2;
                const btnSize = 18;

                // ✕ delete button – top-right, clearly inside border
                const bx = PAD + iw - INSET - btnSize;
                const by = y + 2 + INSET;
                ctx.fillStyle = "rgba(190,40,40,0.92)";
                ctx.fillRect(bx, by, btnSize, btnSize);
                ctx.fillStyle = "#fff";
                ctx.font = "bold 11px sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("\u2715", bx + btnSize / 2, by + 13);

                // index badge – top-left, clearly inside border
                const badgeX = PAD + INSET;
                const badgeY = y + 2 + INSET;
                ctx.fillStyle = "rgba(0,0,0,0.72)";
                ctx.fillRect(badgeX, badgeY, 18, 15);
                ctx.fillStyle = "#ccc";
                ctx.font = "bold 9px monospace";
                ctx.textAlign = "center";
                ctx.fillText(String(idx), badgeX + 9, badgeY + 11);

                // thumbnail – centred, capped at THUMB_MAX_H, below the badge/button row
                const thumbAreaTop = by + btnSize + 4;
                const thumbMaxH    = Math.max(THUMB_MAX_H, height - (thumbAreaTop - y) - 22);
                const scale = Math.min(innerW / this._thumb.width, thumbMaxH / this._thumb.height);
                const tw = this._thumb.width  * scale;
                const th = this._thumb.height * scale;
                const tx = PAD + INSET + (innerW - tw) / 2;
                const ty = thumbAreaTop;
                ctx.drawImage(this._thumb, tx, ty, tw, th);

                // filename label
                ctx.fillStyle = "#888";
                ctx.font = "10px monospace";
                ctx.textAlign = "center";
                const lbl = this.value.length > 40
                    ? "\u2026" + this.value.slice(-37)
                    : this.value;
                ctx.fillText(lbl, width / 2, ty + th + 13);

            } else {
                // empty placeholder text
                ctx.fillStyle = "#555";
                ctx.font = "12px sans-serif";
                ctx.textAlign = "center";
                ctx.fillText(
                    `\u2191 Obraz ${idx} \u2013 kliknij lub upu\u015b\u0107`,
                    width / 2,
                    y + height / 2 + 4
                );
            }
        },

        // ── mouse events ──────────────────────────────────────────────────────
        async mouse(event, pos, node) {
            if (event.type !== "pointerdown") return false;

            // pos = [x_from_node_left, y_from_node_top]
            const mx = pos[0];
            const my = pos[1] - (this.last_y ?? 0); // y relative to this widget's top

            // delete button – coords must match draw() exactly
            if (this._thumb) {
                const INSET   = 8;
                const btnSize = 18;
                const iw      = node.size[0] - PAD * 2;
                const bx = PAD + iw - INSET - btnSize;
                const by = 2 + INSET; // relative to widget top (last_y already subtracted)
                if (mx >= bx && mx <= bx + btnSize && my >= by && my <= by + btnSize) {
                    await this.applyImage("");
                    return true;
                }
            }

            // click → file picker
            const input = document.createElement("input");
            input.type   = "file";
            input.accept = "image/png,image/jpeg,image/webp,image/bmp,image/gif";
            input.onchange = async e => {
                const file = e.target.files?.[0];
                if (!file) return;
                const name = await uploadFile(file);
                if (name) await this.applyImage(name);
            };
            input.click();
            return true;
        },

        serializeValue() { return this.value; },
    };
    return w;
}

// ─── sync outputs and widget visibility ──────────────────────────────────────

function syncNode(node, count) {
    const c = Math.max(1, Math.min(MAX_IMAGES, count | 0));

    // widget visibility
    for (let i = 1; i <= MAX_IMAGES; i++) {
        const w = slotWidget(node, i);
        if (w?.hide) i <= c ? w.show() : w.hide();
    }

    // remove outputs from the end down to c (iterate backwards to keep indices stable)
    const cur = node.outputs?.length ?? 0;
    if (cur > c) {
        for (let i = cur - 1; i >= c; i--) node.removeOutput(i);
    } else if (cur < c) {
        for (let i = cur + 1; i <= c; i++) node.addOutput(`obraz_${i}`, "IMAGE");
    }

    node.setSize(node.computeSize());
    node.setDirtyCanvas(true, true);
}

// ─── extension ────────────────────────────────────────────────────────────────

app.registerExtension({
    name: "Szandor.MultiImageLoader",

    // setup() runs once when the extension loads – perfect for canvas-level hooks
    setup() {
        // Use CAPTURE phase so we run before ComfyUI's global drop handler,
        // which would otherwise intercept image files and open them as workflows.
        const opts = { capture: true };

        app.canvasEl.addEventListener("dragover", e => {
            const [gx, gy] = clientToGraph(e.clientX, e.clientY);
            const node = app.graph.getNodeOnPos(gx, gy, app.graph._nodes);
            if (node?.type !== NODE_TYPE) return;
            e.preventDefault();
            e.stopImmediatePropagation();
        }, opts);

        app.canvasEl.addEventListener("drop", async e => {
            const files = [...(e.dataTransfer?.files ?? [])].filter(
                f => f.type.startsWith("image/")
            );
            if (!files.length) return;

            const [gx, gy] = clientToGraph(e.clientX, e.clientY);
            const node = app.graph.getNodeOnPos(gx, gy, app.graph._nodes);
            if (node?.type !== NODE_TYPE) return;

            e.preventDefault();
            e.stopImmediatePropagation();
            await handleFileDrop(node, files);
        }, opts);
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;

        // ── onNodeCreated ─────────────────────────────────────────────────────
        const origCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origCreated?.apply(this, arguments);
            const node = this;

            // Remove auto-generated STRING widgets, replace with custom slot widgets
            for (let i = MAX_IMAGES; i >= 1; i--) {
                const name = `image_${String(i).padStart(2, "0")}`;
                const idx  = node.widgets?.findIndex(w => w.name === name) ?? -1;
                if (idx >= 0) node.widgets.splice(idx, 1);
            }
            for (let i = 1; i <= MAX_IMAGES; i++) {
                node.widgets.push(makeSlotWidget(node, i));
            }

            // Hook the image_count slider
            const countW = node.widgets?.find(w => w.name === "image_count");
            if (countW) {
                const origCb = countW.callback;
                countW.callback = function (value) {
                    try { origCb?.call(this, value); } catch (_) {}
                    syncNode(node, value);
                };
            }

            // Defer initial sync to the next frame:
            // – for workflow loads: onConfigure runs first (synchronously, same tick),
            //   sets _szandor_synced = true, so rAF skips
            // – for fresh nodes: rAF fires, no onConfigure was called, sync runs normally
            requestAnimationFrame(() => {
                if (node._szandor_synced) return;
                const cw = node.widgets?.find(w => w.name === "image_count");
                if (cw) syncNode(node, cw.value);
            });
        };

        // ── onConfigure – called after widget values are restored from workflow ──
        const origConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (config) {
            origConfigure?.apply(this, arguments);
            const node = this;
            node._szandor_synced = true;   // prevent rAF double-sync

            // Sync outputs to saved image_count (widgets already restored at this point)
            const countW = node.widgets?.find(w => w.name === "image_count");
            if (countW) syncNode(node, countW.value);

            // Load thumbnails asynchronously
            for (let i = 1; i <= MAX_IMAGES; i++) {
                const w = slotWidget(node, i);
                if (w?.value) w.loadThumbAsync();
            }
        };
    },
});
