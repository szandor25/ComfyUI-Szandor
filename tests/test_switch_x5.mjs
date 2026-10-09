import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

function loadInline() {
    const context = vm.createContext({ app: { registerExtension() {} } });
    const source = readFileSync(new URL("../web/switch_x5.js", import.meta.url), "utf8")
        .replace(/^import .*;$/gm, "")
        .replace(/^export /gm, "");
    vm.runInContext(`${source}\nglobalThis.inlineSwitches = inlineSwitches;`, context);
    return context.inlineSwitches;
}

const switches = (inputs = {}) => ({
    class_type: "SzandorSwitchX5",
    inputs: { switch_1: false, switch_2: false, switch_3: false, switch_4: false, switch_5: false, ...inputs },
});

test("widget-driven switches are replaced by the selected input", () => {
    const output = loadInline()({
        1: { class_type: "Text", inputs: { value: "a" } },
        2: { class_type: "Text", inputs: { value: "b" } },
        9: switches({ switch_1: true, on_true_1: ["1", 0], on_false_1: ["2", 0] }),
        5: { class_type: "Preview", inputs: { source: ["9", 0] } },
    });
    assert.deepEqual(JSON.parse(JSON.stringify(output[5].inputs)), { source: ["1", 0] });
    assert.equal(output[9], undefined);
});

test("one switch feeding another through a node no longer forms a cycle", () => {
    const output = loadInline()({
        1: { class_type: "Text", inputs: { value: "a" } },
        3: { class_type: "Concat", inputs: { string_a: ["9", 0] } },
        9: switches({ switch_1: true, switch_2: true, on_true_1: ["1", 0], on_true_2: ["3", 0] }),
        5: { class_type: "Preview", inputs: { source: ["9", 1] } },
    });
    assert.deepEqual(JSON.parse(JSON.stringify(output[3].inputs)), { string_a: ["1", 0] });
    assert.deepEqual(JSON.parse(JSON.stringify(output[5].inputs)), { source: ["3", 0] });
    assert.equal(output[9], undefined);
});

test("an unconnected selected input is dropped from the consumer", () => {
    const output = loadInline()({
        2: { class_type: "Text", inputs: { value: "b" } },
        9: switches({ switch_1: true, on_false_1: ["2", 0] }),
        5: { class_type: "Preview", inputs: { source: ["9", 0], other: 1 } },
    });
    assert.deepEqual(JSON.parse(JSON.stringify(output[5].inputs)), { other: 1 });
});

test("switches driven by a connected boolean stay in the backend graph", () => {
    const output = loadInline()({
        1: { class_type: "Text", inputs: { value: "a" } },
        8: { class_type: "Bool", inputs: { value: true } },
        9: switches({ switch_1: true, on_true_1: ["1", 0], switch_3: ["8", 0], on_true_3: ["1", 0] }),
        5: { class_type: "Preview", inputs: { a: ["9", 0], b: ["9", 2] } },
    });
    assert.deepEqual(JSON.parse(JSON.stringify(output[5].inputs)), { a: ["1", 0], b: ["9", 2] });
    assert.deepEqual(Object.keys(output[9].inputs).filter(name => name.startsWith("on_")), ["on_true_3"]);
});
