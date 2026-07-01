import { app } from "../../scripts/app.js";

const NODE_TYPE = "ImagePassthrough";
const MAX_SLOTS = 30;

// Layout constants
const TITLE_H  = 30;  // ComfyUI node title bar height
const SLIDER_H = 24;  // our custom slider height
const SLIDER_Y = TITLE_H + 5;
const SLOT_H   = 20;
const SOCKETS_START_Y = SLIDER_Y + SLIDER_H + 8;  // sockets below slider

// ─── geometry helpers ─────────────────────────────────────────────────────────

const sliderX = (node) => 10;
const sliderW = (node) => node.size[0] - 20;

function slotY(i) {
    return SOCKETS_START_Y + i * SLOT_H + SLOT_H / 2;
}

function nodeHeight(c) {
    return SOCKETS_START_Y + c * SLOT_H + 8;
}

// ─── position sockets via slot.pos so they start below the custom slider ──────

function updatePositions(node) {
    const w = node.size[0];
    for (let i = 0; i < (node.inputs?.length ?? 0); i++) {
        node.inputs[i].pos  = [0, slotY(i)];
    }
    for (let i = 0; i < (node.outputs?.length ?? 0); i++) {
        node.outputs[i].pos = [w, slotY(i)];
    }
}

// ─── sync input + output socket counts ───────────────────────────────────────

function syncPassthrough(node, count) {
    const c = Math.max(1, Math.min(MAX_SLOTS, count | 0));

    const curIn = node.inputs?.length ?? 0;
    if (curIn > c) {
        for (let i = curIn - 1; i >= c; i--) node.removeInput(i);
    } else if (curIn < c) {
        for (let i = curIn + 1; i <= c; i++) node.addInput(`in_${i}`, "IMAGE");
    }

    const curOut = node.outputs?.length ?? 0;
    if (curOut > c) {
        for (let i = curOut - 1; i >= c; i--) node.removeOutput(i);
    } else if (curOut < c) {
        for (let i = curOut + 1; i <= c; i++) node.addOutput(`out_${i}`, "IMAGE");
    }

    node.size[1] = nodeHeight(c);
    updatePositions(node);
    node.setDirtyCanvas(true, true);
}

// ─── slider interaction helpers ───────────────────────────────────────────────

function valueFromMouseX(node, mx) {
    const pct = Math.max(0, Math.min(1, (mx - sliderX(node)) / sliderW(node)));
    return Math.max(1, Math.min(MAX_SLOTS, Math.round(1 + pct * (MAX_SLOTS - 1))));
}

function applySliderValue(node, newVal) {
    const cw = node.widgets?.find(w => w.name === "slot_count");
    if (!cw) return;
    if (cw.value === newVal) return;
    cw.value = newVal;
    try { cw.callback?.(newVal); } catch (_) {}
    syncPassthrough(node, newVal);
}

// ─── extension ────────────────────────────────────────────────────────────────

app.registerExtension({
    name: "Szandor.ImagePassthrough",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;

        // ── onNodeCreated ─────────────────────────────────────────────────────
        const origCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origCreated?.apply(this, arguments);
            const node = this;

            // Suppress the default INT widget visual – we draw our own at the top.
            // The widget still serialises its value normally.
            const countW = node.widgets?.find(w => w.name === "slot_count");
            if (countW) {
                countW.computeSize    = () => [0, -4];
                countW.draw           = () => {};
                countW.mouse          = () => false;  // disable widget's built-in mouse handling (hover/scroll changes)
                const origCb = countW.callback;
                countW.callback = function (value) {
                    try { origCb?.call(this, value); } catch (_) {}
                    syncPassthrough(node, value);
                };
            }

            node._dragging_slider = false;

            // ── custom slider rendered in the foreground ──────────────────────
            node.onDrawForeground = function (ctx) {
                if (this.flags?.collapsed) return;
                const cw  = this.widgets?.find(w => w.name === "slot_count");
                const val = cw?.value ?? 2;
                const pct = (val - 1) / (MAX_SLOTS - 1);
                const sx  = sliderX(this);
                const sw  = sliderW(this);

                // track
                ctx.fillStyle = "#222";
                ctx.fillRect(sx, SLIDER_Y, sw, SLIDER_H);

                // fill
                ctx.fillStyle = this._dragging_slider ? "#4466aa" : "#335599";
                ctx.fillRect(sx, SLIDER_Y, sw * pct, SLIDER_H);

                // border
                ctx.strokeStyle = "#555";
                ctx.lineWidth   = 1;
                ctx.strokeRect(sx, SLIDER_Y, sw, SLIDER_H);

                // label left
                ctx.fillStyle  = "#aaa";
                ctx.font       = "12px sans-serif";
                ctx.textAlign  = "left";
                ctx.fillText("slot_count", sx + 6, SLIDER_Y + SLIDER_H / 2 + 4);

                // value right
                ctx.fillStyle = "#fff";
                ctx.textAlign = "right";
                ctx.fillText(String(val), sx + sw - 6, SLIDER_Y + SLIDER_H / 2 + 4);
            };

            // ── mouse events for the custom slider ───────────────────────────
            node.onMouseDown = function (e, pos) {
                const sx = sliderX(this);
                const sw = sliderW(this);
                if (
                    pos[0] >= sx && pos[0] <= sx + sw &&
                    pos[1] >= SLIDER_Y && pos[1] <= SLIDER_Y + SLIDER_H
                ) {
                    this._dragging_slider = true;
                    applySliderValue(this, valueFromMouseX(this, pos[0]));
                    return true;
                }
                return false;
            };

            node.onMouseMove = function (e, pos) {
                if (!this._dragging_slider) return false;
                applySliderValue(this, valueFromMouseX(this, pos[0]));
                return true;
            };

            node.onMouseUp = function () {
                if (this._dragging_slider) {
                    this._dragging_slider = false;
                    this.setDirtyCanvas(true, true);
                }
            };

            // update output x-positions when the user manually resizes the node
            node.onResize = function () {
                updatePositions(node);
            };

            // deferred initial sync
            requestAnimationFrame(() => {
                if (node._szandor_pt_synced) return;
                const cw = node.widgets?.find(w => w.name === "slot_count");
                if (cw) syncPassthrough(node, cw.value);
            });
        };

        // ── onConfigure (workflow restore) ────────────────────────────────────
        const origConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (config) {
            origConfigure?.apply(this, arguments);
            this._szandor_pt_synced = true;
            const countW = this.widgets?.find(w => w.name === "slot_count");
            if (countW) syncPassthrough(this, countW.value);
        };
    },
});
