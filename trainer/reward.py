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
        # ----- Edit below this line -----
        import numpy as np
        
        # Calculate velocity change (jerkiness indicator)
        # Access previous cart velocity from info if available
        prev_cart_vel = info.get('previous_cart_velocity', obs[1])
        current_cart_vel = obs[1]
        velocity_change = current_cart_vel - prev_cart_vel
        
        # Penalize large velocity changes (jerky movements)
        # Use a threshold to detect significant acceleration changes
        jerk_penalty = 0.0
        if not terminated and not truncated:
            # Calculate magnitude of velocity change
            vel_diff = np.abs(velocity_change)
            # Apply penalty for jerky movements (large velocity changes)
            jerk_penalty = -np.clip(vel_diff * 5.0, 0, 10.0)
        
        return original_reward + jerk_penalty
        # --------------------------------
        # --------------------------------


def make_env(env_id: str = "CartPole-v1"):
    """Create the wrapped environment. Called by the exterm trainer."""
    env = gym.make(env_id)
    env = RewardShapingWrapper(env)
    return env
