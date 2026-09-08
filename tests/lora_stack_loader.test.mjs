import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

function setup(fetchApi = async () => ({ ok: true, json: async () => ({ trigger: "detected" }) })) {
    let extension;
    const context = vm.createContext({
        app: { registerExtension: value => { extension = value; } },
        api: { fetchApi, apiURL: value => value },
        Image: class { set src(_) { this.onerror(); } },
        console, setTimeout,
    });
    const source = readFileSync(new URL("../web/lora_stack_loader.js", import.meta.url), "utf8")
        .replace(/^import .*;$/gm, "");
    vm.runInContext(`${source}\nglobalThis.makeWidget = makeStackWidget;`, context);
    const node = {
        size: [520, 180], computeSize: () => [520, 180],
        setSize(size) { this.size = size; }, setDirtyCanvas() {},
    };
    return { context, node, getExtension: () => extension };
}

test("trigger text and checkbox survive a workflow round trip", () => {
    const { context, node } = setup();
    const rows = [{ name: "style.safetensors", enabled: true, strength: 0.8,
        trigger: "magic style, detailed", use_trigger: true }];
    const widget = context.makeWidget(node, JSON.stringify(rows));
    assert.deepEqual(JSON.parse(widget.serializeValue()), rows);
    widget.setRowsFromValue();
    assert.deepEqual(JSON.parse(widget.serializeValue()), rows);
});

test("legacy workflow defaults to unchecked and retrieves metadata", async () => {
    const { context, node } = setup();
    const widget = context.makeWidget(node, '[{"name":"style.safetensors","enabled":true,"strength":1}]');
    assert.equal(widget.rows[0].use_trigger, false);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(widget.rows[0].trigger, "detected");
    assert.equal(JSON.parse(widget.serializeValue())[0].trigger, "detected");
});

test("late metadata does not replace a manual edit or a changed LoRA", async () => {
    let resolveFetch;
    const { context, node } = setup(() => new Promise(resolve => { resolveFetch = resolve; }));
    const widget = context.makeWidget(node, '[{"name":"old.safetensors","strength":1}]');
    widget.rows[0].name = "new.safetensors";
    widget.rows[0].trigger = "manual";
    resolveFetch({ ok: true, json: async () => ({ trigger: "stale" }) });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(widget.rows[0].trigger, "manual");
});

test("trigger checkbox does not toggle LoRA and upper slider still works", async () => {
    const { context, node } = setup();
    const widget = context.makeWidget(node, '[{"name":"style","enabled":true,"strength":1,"trigger":"test"}]');
    await widget.mouse({ type: "pointerdown" }, [20, 92]);
    assert.equal(widget.rows[0].use_trigger, true);
    assert.equal(widget.rows[0].enabled, true);
    await widget.mouse({ type: "pointerdown" }, [482, 60]);
    assert.equal(widget.rows[0].strength, 2);
    await widget.mouse({ type: "pointerup" }, [482, 60]);
    await widget.mouse({ type: "pointerdown" }, [20, 56]);
    assert.equal(widget.rows[0].enabled, false);
    assert.equal(widget.rows[0].use_trigger, true);
});

test("old socket definitions gain trigger outputs without moving model and clip", async () => {
    const { getExtension } = setup();
    class Node {
        inputs = [{ name: "model" }, { name: "clip" }];
        outputs = [{ name: "model", links: [1] }, { name: "clip", links: [2] }];
        addOutput(name, type) { this.outputs.push({ name, type }); }
        addInput(name, type) { this.inputs.push({ name, type }); }
    }
    await getExtension().beforeRegisterNodeDef(Node, { name: "SzandorLoraStackLoader" });
    const node = new Node();
    node.onConfigure();
    node.onConfigure();
    assert.deepEqual(node.outputs.map(output => output.name), ["model", "clip", "trigger_words", "prompt_with_triggers"]);
    assert.deepEqual(node.outputs[0].links, [1]);
    assert.deepEqual(node.outputs[1].links, [2]);
    assert.equal(node.inputs.filter(input => input.name === "prompt").length, 1);
});

test("training suggestions can be selected and saved without auto-activating words", async () => {
    const { context } = setup(async () => ({ ok: true, json: async () => ({
        trigger: "", suggestions: [
            { text: "private_person", source: "class_tokens" },
            { text: "portrait", source: "ss_tag_frequency", count: 80 },
        ],
    }) }));
    class Element {
        children = [];
        style = {};
        value = "";
        constructor(tag) { this.tag = tag; }
        append(...children) { this.children.push(...children); }
        appendChild(child) { this.children.push(child); }
        replaceChildren(...children) { this.children = children; }
        setAttribute() {}
        focus() {}
        remove() {}
    }
    context.document = { body: new Element("body"), createElement: tag => new Element(tag) };
    const row = { name: "private.safetensors", trigger: "", use_trigger: false };
    let saved;
    vm.runInContext("editTrigger", context)(row, text => { saved = text; });
    await new Promise(resolve => setImmediate(resolve));
    const panel = context.document.body.children[0].children[0];
    const input = panel.children.find(child => child.tag === "textarea");
    const suggestions = panel.children[4];
    assert.equal(input.value, "");
    assert.equal(suggestions.children.length, 2);
    suggestions.children[0].onclick();
    suggestions.children[0].onclick();
    assert.equal(input.value, "private_person");
    assert.equal(row.trigger, "");
    panel.children[5].children.find(button => button.textContent === "Zapisz").onclick();
    assert.equal(saved, "private_person");
    assert.equal(row.use_trigger, false);
});

function setupStack(count, limit = 10) {
    const result = setup();
    result.node.properties = { lora_rows_per_column: limit };
    const rows = Array.from({ length: count }, (_, index) => ({
        name: `style-${index}.safetensors`, enabled: true, strength: 1,
        trigger: "test", use_trigger: false,
    }));
    const widget = result.context.makeWidget(result.node, JSON.stringify(rows));
    result.node.computeSize = () => {
        const [width, height] = widget.computeSize(result.node.size[0]);
        return [width, height + 100];
    };
    widget.sync();
    return { ...result, widget, rows };
}

test("column boundaries size the stack and keep the original LoRA order", () => {
    for (const [count, columns, visibleRows] of [[0, 1, 0], [10, 1, 10], [11, 2, 10], [30, 3, 10], [31, 4, 10]]) {
        const { widget, node, rows } = setupStack(count);
        assert.deepEqual(Array.from(node.size), [520 * columns, 100 + 30 + visibleRows * 82 + 38]);
        assert.deepEqual(JSON.parse(widget.serializeValue()), rows);
    }
});

test("controls in later columns target the correct LoRA, including slider dragging", async () => {
    const { widget, node } = setupStack(30);
    await widget.mouse({ type: "pointerdown" }, [520 + 20, 56]);
    assert.equal(widget.rows[10].enabled, false);
    assert.equal(widget.rows[0].enabled, true);
    await widget.mouse({ type: "pointerdown" }, [1040 + 20, 92]);
    assert.equal(widget.rows[20].use_trigger, true);
    assert.equal(widget.rows[10].use_trigger, false);
    await widget.mouse({ type: "pointerdown" }, [1040 + 482, 60]);
    assert.equal(widget.rows[20].strength, 2);
    await widget.mouse({ type: "pointermove" }, [1040 + 356, 60]);
    assert.equal(widget.rows[20].strength, 0);
    await widget.mouse({ type: "pointerup" }, [1040 + 356, 60]);
    assert.equal(widget.rows[0].strength, 1);
    await widget.mouse({ type: "pointerdown" }, [520 + 499, 56]);
    assert.equal(widget.rows[10].name, "style-11.safetensors");
    assert.equal(node.size[0], 1560);
});

test("editing the column limit resizes the node and survives restored properties", async () => {
    const { widget, node, context } = setupStack(30);
    let commit;
    context.app.canvas = { prompt(_label, initial, callback) {
        assert.equal(initial, "10");
        commit = callback;
    } };
    await widget.mouse({ type: "pointerdown" }, [node.size[0] - 110, 16]);
    for (const value of ["0", "-2", "1.5", "abc", "Infinity", "", null]) {
        commit(value);
        assert.equal(node.properties.lora_rows_per_column, 10);
    }
    commit("6");
    assert.equal(node.properties.lora_rows_per_column, 6);
    assert.deepEqual(Array.from(node.size), [2600, 660]);
    const savedProperties = JSON.parse(JSON.stringify(node.properties));
    const savedValue = widget.serializeValue();
    const restored = setupStack(0);
    restored.node.properties = savedProperties;
    restored.widget.value = savedValue;
    restored.widget.setRowsFromValue();
    assert.deepEqual(Array.from(restored.node.size), [2600, 660]);
    commit("30");
    assert.deepEqual(Array.from(node.size), [520, 2628]);
});

test("removing the last entry in a column shrinks width and blank cells do nothing", async () => {
    const { widget, node } = setupStack(11);
    assert.equal(await widget.mouse({ type: "pointerdown" }, [540, 138]), false);
    assert.equal(widget.rows.length, 11);
    await widget.mouse({ type: "pointerdown" }, [1019, 56]);
    assert.equal(widget.rows.length, 10);
    assert.equal(node.size[0], 520);
});

test("thumbnail hit regions follow columns and widget offsets", () => {
    const { widget, node } = setupStack(30);
    for (const row of widget.rows) row.thumbnail = { width: 38, height: 36 };
    const ctx = new Proxy({ measureText: text => ({ width: text.length * 6 }) }, {
        get: (target, key) => target[key] ?? (() => {}),
    });
    widget.draw(ctx, node, node.size[0], 100);
    assert.deepEqual(JSON.parse(JSON.stringify(widget._thumbRects[20])), {
        index: 20, x: 1346, y: 38, width: 38, height: 36,
    });
    assert.equal(widget._thumbRects[29].y, 38 + 9 * 82);
});
