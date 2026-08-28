import asyncio
import logging
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Set

import gymnasium as gym
from stable_baselines3 import A2C, DDPG, DQN, PPO, SAC, TD3
from stable_baselines3.common.monitor import Monitor

from ..protocol.messages import (
    RunConfig,
    RunState,
    StatusResponse,
    TelemetryEvent,
)
from .callbacks import StreamingCallback

logger = logging.getLogger("exterm.runner")

ALGO_MAP = {
    "PPO": PPO,
    "DQN": DQN,
    "SAC": SAC,
    "A2C": A2C,
    "TD3": TD3,
    "DDPG": DDPG,
}


class TrainingRunner:
    """Manages the lifecycle of an RL training run."""

    def __init__(self):
        self.state: RunState = RunState.IDLE
        self.current_config: Optional[RunConfig] = None
        self.latest_telemetry: Optional[TelemetryEvent] = None
        self.error: Optional[str] = None

        self._stop_event = threading.Event()
        self._pause_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._subscribers: Set[asyncio.Queue] = set()

    def set_event_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    def _broadcast(self, message: Any) -> None:
        if not self._loop or self._loop.is_closed():
            return
        for q in list(self._subscribers):
            self._loop.call_soon_threadsafe(q.put_nowait, message)

    def _emit_telemetry(self, event: TelemetryEvent) -> None:
        self.latest_telemetry = event
        self._broadcast(event.model_dump())

    def get_status(self) -> StatusResponse:
        timesteps = self.latest_telemetry.timesteps if self.latest_telemetry else 0
        total_timesteps = (
            self.latest_telemetry.total_timesteps
            if self.latest_telemetry
            else (self.current_config.total_timesteps if self.current_config else 0)
        )
        episodes = self.latest_telemetry.episode_count if self.latest_telemetry else 0
        mean_reward = (
            self.latest_telemetry.mean_reward_100 if self.latest_telemetry else None
        )
        fps = self.latest_telemetry.fps if self.latest_telemetry else 0
        run_id = self.current_config.run_id if self.current_config else None

        return StatusResponse(
            run_id=run_id,
            state=self.state,
            current_run=self.current_config,
            timesteps=timesteps,
            total_timesteps=total_timesteps,
            episodes=episodes,
            mean_reward_100=mean_reward,
            fps=fps,
            error=self.error,
        )

    def start(self, config: RunConfig) -> None:
        if self.state in (RunState.TRAINING, RunState.STARTING, RunState.PAUSED):
            raise RuntimeError(f"Cannot start training while in state {self.state}")

        self.state = RunState.STARTING
        self.current_config = config
        self.latest_telemetry = None
        self.error = None
        self._stop_event.clear()
        self._pause_event.clear()

        self._broadcast({
            "type": "status",
            **self.get_status().model_dump()
        })

        self._thread = threading.Thread(target=self._run_worker, args=(config,), daemon=True)
        self._thread.start()

    def pause(self) -> None:
        if self.state == RunState.TRAINING:
            self._pause_event.set()
            self.state = RunState.PAUSED
            self._broadcast({
                "type": "status",
                **self.get_status().model_dump()
            })

    def resume(self) -> None:
        if self.state == RunState.PAUSED:
            self._pause_event.clear()
            self.state = RunState.TRAINING
            self._broadcast({
                "type": "status",
                **self.get_status().model_dump()
            })

    def stop(self) -> None:
        if self.state in (RunState.TRAINING, RunState.PAUSED, RunState.STARTING):
            self._stop_event.set()
            self._pause_event.clear()
            self.state = RunState.STOPPED
            self._broadcast({
                "type": "status",
                **self.get_status().model_dump()
            })

    def _run_worker(self, config: RunConfig) -> None:
        env = None
        try:
            logger.info(f"Starting training run {config.run_id}: env={config.env_id}, algo={config.algorithm}, steps={config.total_timesteps}")
            self.state = RunState.TRAINING
            self._broadcast({
                "type": "status",
                **self.get_status().model_dump()
            })

            # Create monitored Gymnasium environment
            base_env = gym.make(config.env_id)
            env = Monitor(base_env)

            algo_cls = ALGO_MAP.get(config.algorithm.upper(), PPO)
            policy = "MlpPolicy"

            algo_kwargs = dict(config.hyperparameters)
            if config.seed is not None:
                algo_kwargs["seed"] = config.seed

            model = algo_cls(policy, env, verbose=0, **algo_kwargs)

            cb = StreamingCallback(
                run_id=config.run_id,
                total_timesteps=config.total_timesteps,
                emit_fn=self._emit_telemetry,
                stop_event=self._stop_event,
                pause_event=self._pause_event,
            )

            model.learn(total_timesteps=config.total_timesteps, callback=cb)

            if self._stop_event.is_set():
                self.state = RunState.STOPPED
            else:
                self.state = RunState.COMPLETED

        except Exception as e:
            logger.exception(f"Training failed: {e}")
            self.error = str(e)
            self.state = RunState.FAILED
        finally:
            if env is not None:
                try:
                    env.close()
                except Exception:
                    pass
            self._broadcast({
                "type": "status",
                **self.get_status().model_dump()
            })
