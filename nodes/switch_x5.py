"""Switch x5: five If/Else switches in one node, like ComfyUI's If/Else Switch.

Each switch_N picks on_true_N or on_false_N for out_N. The inputs are lazy, so only the
selected branch is executed. Every switch has its own type template: the output takes the
type of whatever is connected to its inputs.
"""
from comfy_api.latest import io

SWITCH_COUNT = 5

# sentinel for missing inputs
MISSING = object()


class SwitchX5(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        inputs, outputs = [], []
        for i in range(1, SWITCH_COUNT + 1):
            template = io.MatchType.Template(f"switch_{i}")
            inputs += [
                io.MatchType.Input(f"on_true_{i}", template=template, lazy=True, optional=True,
                                   tooltip=f"Sent to out_{i} when switch_{i} is true."),
                io.MatchType.Input(f"on_false_{i}", template=template, lazy=True, optional=True,
                                   tooltip=f"Sent to out_{i} when switch_{i} is false."),
                io.Boolean.Input(f"switch_{i}", default=False, label_on="true", label_off="false",
                                 tooltip=f"Selects on_true_{i} or on_false_{i}. "
                                         "Right-click the node → Name switches to label it."),
            ]
            outputs.append(io.MatchType.Output(template=template, id=f"out_{i}", display_name=f"out_{i}"))
        return io.Schema(
            node_id="SzandorSwitchX5",
            display_name="If/Else Switch x5 (Szandor)",
            category="Szandor/Utils",
            search_aliases=["if", "else", "switch", "boolean", "conditional", "branch"],
            description="Five If/Else switches: each switch_N sends on_true_N or on_false_N to out_N. "
                        "Only the selected input is executed.",
            inputs=inputs,
            outputs=outputs,
        )

    @classmethod
    def check_lazy_status(cls, **kwargs):
        needed = []
        for i in range(1, SWITCH_COUNT + 1):
            name = f"on_true_{i}" if kwargs.get(f"switch_{i}") else f"on_false_{i}"
            if kwargs.get(name, MISSING) is None:
                needed.append(name)
        return needed

    @classmethod
    def execute(cls, **kwargs) -> io.NodeOutput:
        selected = (kwargs.get(f"on_true_{i}" if kwargs.get(f"switch_{i}") else f"on_false_{i}")
                    for i in range(1, SWITCH_COUNT + 1))
        return io.NodeOutput(*selected)


NODE_CLASS_MAPPINGS = {"SzandorSwitchX5": SwitchX5}
NODE_DISPLAY_NAME_MAPPINGS = {"SzandorSwitchX5": "If/Else Switch x5 (Szandor)"}
