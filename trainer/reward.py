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
        # Penalize hard landings by checking vertical velocity when landing
        if terminated or truncated:
            # If landed successfully (y close to ground)
            if obs[1] <= 0.2:  # Lander is on ground
                # Add penalty for high vertical velocity at impact
                vertical_velocity = obs[2]
                hard_landing_penalty = -np.abs(vertical_velocity) * 5.0
                return original_reward + hard_landing_penalty
        return original_reward
        # --------------------------------
        # --------------------------------
        # --------------------------------


def make_env(env_id: str = "CartPole-v1", render_mode: str | None = None):
    """Create the wrapped environment. Called by the exterm trainer."""
    env = gym.make(env_id, render_mode=render_mode)
    env = RewardShapingWrapper(env)
    return env
