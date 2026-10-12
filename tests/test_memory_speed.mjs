import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

function loadSpeedItems() {
    const context = vm.createContext({ app: { registerExtension() {} }, api: {} });
    const source = readFileSync(new URL("../web/memory_monitor.js", import.meta.url), "utf8")
        .replace(/^import .*;$/gm, "")
        .replace(/^export /gm, "")
        .replaceAll("import.meta.url", "\"file:///\"");
    vm.runInContext(`${source}\nglobalThis.speedItems = speedItems;`, context);
    return speed => JSON.parse(JSON.stringify(context.speedItems(speed)));
}

const MB = 1024 ** 2;
const nvml = {
    source: "nvml", core_clock: 2512, core_clock_max: 3090, memory_clock: 13365, memory_clock_max: 14001, memory_busy: 6,
    power: 555.6, power_limit: 600, pstate: 1, fan: 46, pcie_gen: 5, pcie_width: 8, pcie_gen_max: 5, pcie_width_max: 16,
    pcie_rx: 176 * MB, pcie_tx: 57 * MB, idle: false, slowdown: ["power limit"],
};

test("NVIDIA readout lists clocks, power, PCIe, state, fan and slowdowns", () => {
    const items = loadSpeedItems()(nvml);
    assert.deepEqual(items.map(([label, value]) => [label, value]), [
        ["Core", "2512 / 3090 MHz"],
        ["Memory", "13365 / 14001 MHz · 6% busy"],
        ["Power", "556 / 600 W"],
        ["PCIe", "5.0 x8 (max 5.0 x16) ↓176 MB/s ↑57 MB/s"],
        ["State", "P1"],
        ["Fan", "46%"],
        ["Slowed by", "power limit"],
    ]);
    assert.deepEqual(items.filter(item => item[3]).map(item => item[0]), ["PCIe", "Slowed by"]);
    assert.match(items[3][2], /Fewer lanes than the card supports \(x16\)/);
});

test("a full-width link, an idle card and missing sensors stay quiet", () => {
    const items = loadSpeedItems()({ ...nvml, pcie_width: 16, fan: null, slowdown: [], idle: true });
    assert.equal(items.find(([label]) => label === "PCIe")[1], "5.0 x16 ↓176 MB/s ↑57 MB/s");
    assert.equal(items.some(([label]) => label === "Fan"), false);
    assert.deepEqual(items.at(-1).slice(0, 2), ["", "idle"]);
    assert.equal(items.some(item => item[3]), false);
});

test("PyTorch fallback (AMD or no nvidia-ml-py) and missing data", () => {
    const speedItems = loadSpeedItems();
    assert.deepEqual(speedItems({ source: "torch", core_clock: 2400, power: 250 }).map(([l, v]) => [l, v]),
        [["Core", "2400 MHz"], ["Power", "250 W"]]);
    assert.deepEqual(speedItems({ source: null, hint: "Install nvidia-ml-py for clocks, power and PCIe." }), []);
    assert.deepEqual(speedItems(null), []);
});
