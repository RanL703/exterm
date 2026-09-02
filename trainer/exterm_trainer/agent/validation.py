"""Validation boundary for generated reward-function edits."""
import ast
import subprocess
import sys
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class RewardValidation:
    ok: bool
    error: str = ""
    risk_level: str = "auto"


_ALLOWED_NAMES = {
    "self", "obs", "action", "original_reward", "terminated", "truncated", "info", "np",
    "abs", "bool", "float", "int", "len", "max", "min", "pow", "round", "sum",
}
_ALLOWED_CALLS = _ALLOWED_NAMES - {"self", "obs", "action", "original_reward", "terminated", "truncated", "info", "np"}


def validate_reward_edit(old_code: str, new_code: str, timeout: float = 3.0) -> RewardValidation:
    try:
        old_tree = ast.parse(old_code)
        new_tree = ast.parse(new_code)
    except SyntaxError as error:
        return RewardValidation(False, f"syntax error: {error}")

    old_fn = _find_reward_fn(old_tree)
    new_fn = _find_reward_fn(new_tree)
    if old_fn is None or new_fn is None:
        return RewardValidation(False, "reward_fn was not found")

    old_signature = _without_reward_body(old_tree, old_fn)
    new_signature = _without_reward_body(new_tree, new_fn)
    if ast.dump(old_signature, include_attributes=False) != ast.dump(new_signature, include_attributes=False):
        return RewardValidation(False, "edit changes wrapper structure, imports, or training code", "confirm")

    for node in ast.walk(new_fn):
        if isinstance(node, ast.Name) and node.id.startswith("__"):
            return RewardValidation(False, "dunder names are not allowed")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id not in _ALLOWED_CALLS and node.func.id != "np":
            return RewardValidation(False, f"call to {node.func.id!r} is not allowed")

    undefined = _undefined_names(new_fn)
    if undefined:
        return RewardValidation(False, f"undefined name(s): {', '.join(sorted(undefined))}")

    runtime = _run_samples(new_code, timeout)
    return runtime


def _find_reward_fn(tree: ast.AST) -> Optional[ast.FunctionDef]:
    return next((node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "reward_fn"), None)


def _without_reward_body(tree: ast.Module, reward_fn: ast.FunctionDef) -> ast.Module:
    clone = ast.parse(ast.unparse(tree))
    clone_fn = _find_reward_fn(clone)
    assert clone_fn is not None
    clone_fn.body = []
    return clone


def _undefined_names(function: ast.FunctionDef) -> set[str]:
    assigned = {argument.arg for argument in function.args.args}
    for node in ast.walk(function):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            assigned.add(node.id)
    return {
        node.id for node in ast.walk(function)
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load)
        and node.id not in assigned and node.id not in _ALLOWED_NAMES
    }


def _run_samples(code: str, timeout: float) -> RewardValidation:
    script = """
import numpy as np
namespace = {"__name__": "__exterm_validation__"}
exec(compile(sys.stdin.read(), "reward.py", "exec"), namespace)
wrapper = namespace["RewardShapingWrapper"]
instance = wrapper.__new__(wrapper)
instance.prev_action = None
for obs, action, reward, terminated, truncated in [
    (np.zeros(8, dtype=np.float32), 0, 1.0, False, False),
    (np.ones(8, dtype=np.float32), 1, 0.0, True, False),
    (np.zeros(8, dtype=np.float32), np.array([0.25], dtype=np.float32), -1.0, False, True),
]:
    value = wrapper.reward_fn(instance, obs, action, reward, terminated, truncated, {})
    if not isinstance(value, (int, float, np.number)) or not np.isfinite(value):
        raise ValueError("reward_fn must return one finite numeric value")
"""
    try:
        completed = subprocess.run([sys.executable, "-I", "-c", "import sys; " + script], input=code, text=True, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return RewardValidation(False, "runtime validation timed out")
    if completed.returncode:
        detail = completed.stderr.strip().splitlines()[-1] if completed.stderr.strip() else "runtime error"
        return RewardValidation(False, f"runtime validation failed: {detail}")
    return RewardValidation(True)
