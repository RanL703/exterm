import collections
import threading
import time
from typing import Callable, Deque, Dict, Optional

from stable_baselines3.common.callbacks import BaseCallback

from ..protocol.messages import TelemetryEvent


class StreamingCallback(BaseCallback):
    """Stable-Baselines3 callback that streams live telemetry and allows cancellation."""

    def __init__(
        self,
        run_id: str,
        total_timesteps: int,
        emit_fn: Callable[[TelemetryEvent], None],
        stop_event: threading.Event,
        pause_event: threading.Event,
        step_interval: int = 250,
        verbose: int = 0,
    ):
        super().__init__(verbose=verbose)
        self.run_id = run_id
        self.total_timesteps = total_timesteps
        self.emit_fn = emit_fn
        self.stop_event = stop_event
        self.pause_event = pause_event
        self.step_interval = step_interval

        self.episode_count = 0
        self.episode_rewards: Deque[float] = collections.deque(maxlen=100)
        self.episode_lengths: Deque[int] = collections.deque(maxlen=100)

        self._start_time = 0.0
        self._last_emit_step = 0
        self._last_emit_time = 0.0

    def _on_training_start(self) -> None:
        self._start_time = time.perf_counter()
        self._last_emit_time = self._start_time
        self._last_emit_step = 0

    def _on_step(self) -> bool:
        # Check if stop was requested
        if self.stop_event.is_set():
            return False

        # Check if pause was requested
        while self.pause_event.is_set():
            if self.stop_event.is_set():
                return False
            time.sleep(0.1)

        current_time = time.perf_counter()
        current_step = self.num_timesteps
        elapsed = max(current_time - self._start_time, 1e-6)
        fps = int(current_step / elapsed)

        # Check for completed episodes in infos
        infos = self.locals.get("infos", [])
        completed_episodes = []
        for info in infos:
            if "episode" in info:
                ep_r = float(info["episode"]["r"])
                ep_l = int(info["episode"]["l"])
                self.episode_rewards.append(ep_r)
                self.episode_lengths.append(ep_l)
                self.episode_count += 1
                completed_episodes.append((ep_r, ep_l))

        mean_reward_100 = (
            float(sum(self.episode_rewards) / len(self.episode_rewards))
            if self.episode_rewards
            else None
        )

        metrics: Dict[str, float] = {}
        if hasattr(self, "logger") and self.logger is not None:
            for k, v in getattr(self.logger, "name_to_value", {}).items():
                if isinstance(v, (int, float)):
                    short_k = k.split("/")[-1]
                    metrics[short_k] = float(v)

        progress = min(current_step / max(self.total_timesteps, 1), 1.0)

        if completed_episodes:
            for ep_r, ep_l in completed_episodes:
                event = TelemetryEvent(
                    run_id=self.run_id,
                    timestamp=time.time(),
                    timesteps=current_step,
                    total_timesteps=self.total_timesteps,
                    progress=progress,
                    episode_count=self.episode_count,
                    episode_reward=ep_r,
                    episode_length=ep_l,
                    mean_reward_100=mean_reward_100,
                    fps=fps,
                    metrics=metrics,
                )
                self.emit_fn(event)
            self._last_emit_step = current_step
            self._last_emit_time = current_time
        elif (current_step - self._last_emit_step >= self.step_interval) or (
            current_time - self._last_emit_time >= 1.0
        ):
            event = TelemetryEvent(
                run_id=self.run_id,
                timestamp=time.time(),
                timesteps=current_step,
                total_timesteps=self.total_timesteps,
                progress=progress,
                episode_count=self.episode_count,
                episode_reward=None,
                episode_length=None,
                mean_reward_100=mean_reward_100,
                fps=fps,
                metrics=metrics,
            )
            self.emit_fn(event)
            self._last_emit_step = current_step
            self._last_emit_time = current_time

        return True
