import { app } from "../../scripts/app.js";

const NODE_TYPE = "SzandorBooleanSwitches";
const SWITCH_COUNT = 5;
const NAMES_PROPERTY = "szandorSwitchNames";

const switchName = i => `switch_${i + 1}`;

function savedNames(node) {
    const names = node.properties?.[NAMES_PROPERTY];
    return Array.from({ length: SWITCH_COUNT }, (_, i) =>
        typeof names?.[i] === "string" ? names[i].trim() : "");
}

// The name replaces the label of the toggle, of its widget socket and of the
// matching output; an empty name brings back the default switch_N label.
function applyNames(node) {
    const names = savedNames(node);
    for (let i = 0; i < SWITCH_COUNT; i++) {
        const label = names[i] || undefined;
        const widget = node.widgets?.find(w => w.name === switchName(i));
        if (widget) widget.label = label;
        const input = node.inputs?.find(slot => slot.widget?.name === switchName(i));
        if (input) input.label = label;
        const output = node.outputs?.[i];
        if (output) output.label = label;
    }
    node.graph?.trigger?.("node:slot-label:changed", { nodeId: node.id });
    node.setDirtyCanvas?.(true, true);
}

function renameSwitch(node, i, event) {
    const names = savedNames(node);
    app.canvas.prompt(`Name of ${switchName(i)}`, names[i], value => {
        names[i] = String(value ?? "").trim();
        node.properties ??= {};
        node.properties[NAMES_PROPERTY] = names;
        applyNames(node);
        node.graph?.change?.();
    }, event);
}

app.registerExtension({
    name: "Szandor.BooleanSwitches",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;
        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function (...args) {
            const result = originalCreated?.apply(this, args);
            this.properties ??= {};
            this.properties[NAMES_PROPERTY] ??= Array(SWITCH_COUNT).fill("");
            return result;
        };
        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (...args) {
            const result = originalConfigure?.apply(this, args);
            applyNames(this);
            return result;
        };
        const originalMenu = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
            const result = originalMenu?.call(this, canvas, options);
            const names = savedNames(this);
            options.unshift({
                content: "Name switches",
                has_submenu: true,
                submenu: {
                    options: names.map((name, i) => ({
                        content: name ? `${switchName(i)}: ${name}` : switchName(i),
                        callback: (_value, _options, event) => renameSwitch(this, i, event),
                    })),
                },
            }, null);
            return result;
        };
    },
});
