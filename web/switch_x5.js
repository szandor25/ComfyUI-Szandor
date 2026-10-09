import { app } from "../../scripts/app.js";

const NODE_TYPE = "SzandorSwitchX5";
const SWITCH_COUNT = 5;
const NAMES_PROPERTY = "szandorSwitchNames";

const switchName = i => `switch_${i + 1}`;

function savedNames(node) {
    const names = node.properties?.[NAMES_PROPERTY];
    return Array.from({ length: SWITCH_COUNT }, (_, i) =>
        typeof names?.[i] === "string" ? names[i].trim() : "");
}

// The name replaces the label of the toggle, of its widget socket and of the
// matching output, and prefixes its on_true / on_false inputs; an empty name
// brings back the default labels.
function applyNames(node) {
    const names = savedNames(node);
    for (let i = 0; i < SWITCH_COUNT; i++) {
        const label = names[i] || undefined;
        const widget = node.widgets?.find(w => w.name === switchName(i));
        if (widget) widget.label = label;
        const input = node.inputs?.find(slot => slot.widget?.name === switchName(i));
        if (input) input.label = label;
        for (const branch of ["true", "false"]) {
            const slot = node.inputs?.find(s => s.name === `on_${branch}_${i + 1}`);
            if (slot) slot.label = label && `${label}: ${branch}`;
        }
        const output = node.outputs?.find(slot => slot.name === `out_${i + 1}`);
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

const isLink = value => Array.isArray(value) && value.length === 2;

// All five switches live in one node, so in the backend graph every output
// depends on every input; feeding out_1 into something upstream of on_true_2
// would be rejected as a dependency cycle. Switches set by their widget are
// therefore resolved here: consumers are linked straight to the selected
// input, and the node is sent to the backend only for switches driven by a
// connected boolean. The unselected branch stays unreferenced, so it does not
// run, as with lazy inputs.
export function inlineSwitches(output) {
    const isSwitch = id => output[id]?.class_type === NODE_TYPE;
    const constantSwitch = (node, i) => typeof node.inputs[`switch_${i}`] === "boolean";
    const resolve = (link, seen = new Set()) => {
        if (!isLink(link) || !isSwitch(link[0])) return link;
        const node = output[link[0]];
        const i = Number(link[1]) + 1;
        if (!constantSwitch(node, i)) return link;
        const key = `${link[0]}:${i}`;
        if (seen.has(key)) return link;
        seen.add(key);
        const selected = node.inputs[node.inputs[`switch_${i}`] ? `on_true_${i}` : `on_false_${i}`];
        return selected === undefined ? undefined : resolve(selected, seen);
    };
    for (const node of Object.values(output)) {
        for (const [name, value] of Object.entries(node.inputs ?? {})) {
            if (!isLink(value) || !isSwitch(value[0])) continue;
            const resolved = resolve(value);
            if (resolved === undefined) delete node.inputs[name];
            else node.inputs[name] = resolved;
        }
    }
    for (const id of Object.keys(output).filter(isSwitch)) {
        const node = output[id];
        for (let i = 1; i <= SWITCH_COUNT; i++) {
            if (!constantSwitch(node, i)) continue;
            delete node.inputs[`on_true_${i}`];
            delete node.inputs[`on_false_${i}`];
        }
        const used = Object.values(output).some(other =>
            Object.values(other.inputs ?? {}).some(value => isLink(value) && String(value[0]) === id));
        if (!used) delete output[id];
    }
    return output;
}

app.registerExtension({
    name: "Szandor.SwitchX5",
    setup() {
        const originalGraphToPrompt = app.graphToPrompt;
        app.graphToPrompt = async function (...args) {
            const result = await originalGraphToPrompt.apply(this, args);
            if (result?.output) inlineSwitches(result.output);
            return result;
        };
    },
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
