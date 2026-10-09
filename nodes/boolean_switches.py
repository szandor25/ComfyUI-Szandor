SWITCH_COUNT = 5


class BooleanSwitches:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                f"switch_{i}": ("BOOLEAN", {
                    "default": False,
                    "label_on": "true",
                    "label_off": "false",
                    "tooltip": f"Value sent to output switch_{i}. Right-click the node → Name switches to label it.",
                })
                for i in range(1, SWITCH_COUNT + 1)
            },
        }

    RETURN_TYPES = tuple(["BOOLEAN"] * SWITCH_COUNT)
    RETURN_NAMES = tuple(f"switch_{i}" for i in range(1, SWITCH_COUNT + 1))
    FUNCTION = "switches"
    CATEGORY = "Szandor/Utils"
    DESCRIPTION = ("Five independent true / false toggles, each with its own BOOLEAN output. "
                   "Right-click the node → Name switches to give each toggle and output a short name.")

    def switches(self, **kwargs):
        return tuple(bool(kwargs[f"switch_{i}"]) for i in range(1, SWITCH_COUNT + 1))


NODE_CLASS_MAPPINGS = {"SzandorBooleanSwitches": BooleanSwitches}
NODE_DISPLAY_NAME_MAPPINGS = {"SzandorBooleanSwitches": "Boolean Switches x5 (Szandor)"}
