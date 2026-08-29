"""
exterm reward shaping wrapper for CartPole.

This file is managed by exterm - every `exterm steer` command that modifies
the reward function will diff and patch this file, auto-checkpointing before
the change. Use `exterm rollback` to revert both code and model weights together.

Shape the reward however you like - just return a float from `reward_fn`.
The default below passes through the original environment reward unchanged.
"""
import gymnasium as gym
import numpy as np
from gymnasium import Wrapper


class RewardShapingWrapper(Wrapper):
    """Wraps CartPole-v1 to apply custom reward shaping."""

    def step(self, action):
        obs, reward, terminated, truncated, info = self.env.step(action)
        shaped_reward = self.reward_fn(obs, action, reward, terminated, truncated, info)
        return obs, shaped_reward, terminated, truncated, info

    def reward_fn(
        self,
        obs: np.ndarray,
        action: int,
        original_reward: float,
        terminated: bool,
        truncated: bool,
        info: dict,
    ) -> float:
        # ----- Edit below this line -----
        # Penalize jerky movements (rapid action changes)
        if hasattr(self, 'last_action') and self.last_action is not None:
            if action != self.last_action:
                # Apply penalty for action oscillation
                return original_reward - 0.5
        else:
            self.last_action = action
        
        # Update last action for next step
        self.last_action = action
        return original_reward
        # --------------------------------


def make_env(env_id: str = "CartPole-v1"):
    """Create the wrapped environment. Called by the exterm trainer."""
    env = gym.make(env_id)
    env = RewardShapingWrapper(env)
    return env
