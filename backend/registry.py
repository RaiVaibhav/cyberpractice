"""Auto-discover scenario modules.

Every module under backend/scenarios that defines a top-level ``scenario`` dict
is a runnable scenario — no registration step, mirroring the Node version.
"""
import importlib
import pkgutil

from . import scenarios as scenarios_pkg

REQUIRED_KEYS = ("id", "title", "systemPrompt", "tools", "initialState", "checkSolved")


def load_all():
    found = []
    for mod in pkgutil.iter_modules(scenarios_pkg.__path__):
        if mod.name.startswith("_"):
            continue
        module = importlib.import_module(f"{scenarios_pkg.__name__}.{mod.name}")
        scenario = getattr(module, "scenario", None)
        if not scenario:
            continue
        for key in REQUIRED_KEYS:
            if scenario.get(key) is None:
                raise ValueError(f"{mod.name}: scenario is missing required key '{key}'")
        found.append(scenario)
    found.sort(key=lambda s: s["id"])
    return found
