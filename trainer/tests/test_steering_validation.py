import pytest

from exterm_trainer.agent.validation import validate_reward_edit


BASE = '''import gymnasium as gym
import numpy as np
from gymnasium import Wrapper

class RewardShapingWrapper(Wrapper):
    def reward_fn(self, obs, action, original_reward, terminated, truncated, info):
        # ----- Edit below this line -----
        return original_reward
        # --------------------------------

def make_env(env_id="CartPole-v1"):
    return RewardShapingWrapper(gym.make(env_id))
'''


def edit(body: str) -> str:
    return BASE.replace("return original_reward", body)


def test_valid_reward_edit_runs_against_cached_samples():
    result = validate_reward_edit(BASE, edit("return original_reward - 0.1 * np.sum(np.square(action))"))
    assert result.ok
    assert result.risk_level == "auto"


def test_safe_builtin_constructor_is_allowed():
    result = validate_reward_edit(BASE, edit("return original_reward - dict(penalty=0.1)[\"penalty\"]"))
    assert result.ok


@pytest.mark.parametrize("body, message", [
    ("return original_reward + missing_value", "undefined name"),
    ("return (", "syntax"),
    ("return open('secret.txt').read()", "not allowed"),
])
def test_invalid_reward_edits_are_rejected(body, message):
    result = validate_reward_edit(BASE, edit(body))
    assert not result.ok
    assert message in result.error.lower()


def test_shape_or_training_loop_changes_require_confirmation():
    changed = BASE.replace("class RewardShapingWrapper", "class RewardShapingWrapper\n# changed")
    result = validate_reward_edit(BASE, changed)
    assert not result.ok
