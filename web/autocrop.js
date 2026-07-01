import { app } from "../../scripts/app.js";

const NODE_TYPE = "SzandorAutoCrop";

function ensureMultiOutputLinks(node) {
    if (!node.outputs) return;
    for (const output of node.outputs) {
        if (!Array.isArray(output.links)) {
            output.links = output.links == null ? [] : [output.links];
        }
    }
}

app.registerExtension({
    name: "Szandor.AutoCrop",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;

        const origCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origCreated?.apply(this, arguments);
            ensureMultiOutputLinks(this);
        };

        const origConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            origConfigure?.apply(this, arguments);
            ensureMultiOutputLinks(this);
        };
    },
});
