import asyncio
import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set

import gymnasium as gym
from gymnasium.wrappers import RecordVideo
from stable_baselines3 import A2C, DDPG, DQN, PPO, SAC, TD3
from stable_baselines3.common.monitor import Monitor

from ..protocol.messages import (
    CheckpointInfo,
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

        self._model = None
        self._env = None
        self._checkpoints_dir = Path("checkpoints")
        self._checkpoints_dir.mkdir(exist_ok=True)
        self._videos_dir = Path("videos")
        self._videos_dir.mkdir(exist_ok=True)
        self._checkpoints: List[CheckpointInfo] = []
        self._current_reward_code = ""
        self._run_start_time = 0.0
        self._video_episode_trigger = None

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

    def apply_steering(self, new_reward_code: str, new_hyperparameters: Optional[Dict[str, Any]] = None) -> None:
        """Apply steering changes - update reward code and optionally hyperparameters."""
        if self._model is None:
            raise RuntimeError("No active model to steer")

        # Save checkpoint before applying changes
        self.save_checkpoint()

        # Update reward code
        self._write_reward_code(new_reward_code)
        self._current_reward_code = new_reward_code

        # Update hyperparameters if provided
        if new_hyperparameters is not None and self.current_config:
            self.current_config.hyperparameters.update(new_hyperparameters)
            # Note: SB3 doesn't support dynamic hyperparameter changes easily
            # For v1, we'll just update the config; user can restart with new params

        logger.info("Applied steering changes")

    def _read_reward_code(self) -> str:
        """Read the current reward.py from the project directory."""
        try:
            reward_path = Path("reward.py")
            if reward_path.exists():
                return reward_path.read_text()
        except Exception:
            pass
        return ""

    def _write_reward_code(self, code: str) -> None:
        """Write reward.py to the project directory."""
        try:
            Path("reward.py").write_text(code)
        except Exception as e:
            logger.error(f"Failed to write reward.py: {e}")

    def save_checkpoint(self, checkpoint_id: Optional[str] = None) -> CheckpointInfo:
        """Save a checkpoint of the current model and reward code."""
        if self._model is None:
            raise RuntimeError("No model to checkpoint")

        import uuid
        if checkpoint_id is None:
            checkpoint_id = str(uuid.uuid4())[:8]

        # Save model
        model_path = self._checkpoints_dir / f"{checkpoint_id}.zip"
        self._model.save(str(model_path))

        # Get current reward code
        reward_code = self._read_reward_code()

        # Create checkpoint info
        timesteps = self.latest_telemetry.timesteps if self.latest_telemetry else 0
        episode_count = self.latest_telemetry.episode_count if self.latest_telemetry else 0
        mean_reward = self.latest_telemetry.mean_reward_100 if self.latest_telemetry else None

        checkpoint = CheckpointInfo(
            checkpoint_id=checkpoint_id,
            run_id=self.current_config.run_id if self.current_config else "",
            timesteps=timesteps,
            episode_count=episode_count,
            mean_reward_100=mean_reward,
            created_at=time.time(),
            reward_code=reward_code,
            hyperparameters=dict(self.current_config.hyperparameters) if self.current_config else {},
            algorithm=self.current_config.algorithm if self.current_config else "",
            env_id=self.current_config.env_id if self.current_config else "",
        )

        self._checkpoints.append(checkpoint)
        self._current_reward_code = reward_code

        logger.info(f"Saved checkpoint {checkpoint_id} at {timesteps} timesteps")
        return checkpoint

    def load_checkpoint(self, checkpoint_id: str) -> CheckpointInfo:
        """Load a checkpoint - restores model weights and reward code."""
        checkpoint = next((c for c in self._checkpoints if c.checkpoint_id == checkpoint_id), None)
        if checkpoint is None:
            raise ValueError(f"Checkpoint {checkpoint_id} not found")

        if self._model is None:
            raise RuntimeError("No model to load checkpoint into")

        model_path = self._checkpoints_dir / f"{checkpoint_id}.zip"
        if not model_path.exists():
            raise FileNotFoundError(f"Checkpoint model file not found: {model_path}")

        # Load model weights
        self._model = self._model.__class__.load(str(model_path), env=self._env)

        # Restore reward code
        self._write_reward_code(checkpoint.reward_code)
        self._current_reward_code = checkpoint.reward_code

        logger.info(f"Loaded checkpoint {checkpoint_id}")
        return checkpoint

    def list_checkpoints(self) -> List[CheckpointInfo]:
        """List all available checkpoints."""
        return list(self._checkpoints)

    def get_checkpoint(self, checkpoint_id: str) -> Optional[CheckpointInfo]:
        """Get a specific checkpoint by ID."""
        return next((c for c in self._checkpoints if c.checkpoint_id == checkpoint_id), None)

    def list_videos(self, run_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """List available video files."""
        videos = []
        if run_id:
            search_dirs = [self._videos_dir / run_id]
        else:
            search_dirs = [d for d in self._videos_dir.iterdir() if d.is_dir()]

        for run_dir in search_dirs:
            if not run_dir.exists() or not run_dir.is_dir():
                continue
            for video_file in run_dir.glob("*.mp4"):
                stat = video_file.stat()
                videos.append({
                    "run_id": run_dir.name,
                    "filename": video_file.name,
                    "path": str(video_file),
                    "size_bytes": stat.st_size,
                    "created_at": stat.st_mtime,
                })

        return sorted(videos, key=lambda v: v["created_at"], reverse=True)

    def get_video_path(self, run_id: str, filename: str) -> Optional[Path]:
        """Get the path to a specific video file."""
        video_path = self._videos_dir / run_id / filename
        if video_path.exists() and video_path.is_file():
            return video_path
        return None

    def _run_worker(self, config: RunConfig) -> None:
        self._env = None
        try:
            logger.info(f"Starting training run {config.run_id}: env={config.env_id}, algo={config.algorithm}, steps={config.total_timesteps}")
            self.state = RunState.TRAINING
            self._broadcast({
                "type": "status",
                **self.get_status().model_dump()
            })

            # Create monitored Gymnasium environment with video recording
            base_env = gym.make(config.env_id, render_mode="rgb_array")
            self._env = Monitor(base_env)

            # Wrap with RecordVideo for episode replay
            # Record every episode (episode_trigger=lambda x: True)
            video_dir = self._videos_dir / config.run_id
            video_dir.mkdir(exist_ok=True)
            self._env = RecordVideo(
                self._env,
                video_folder=str(video_dir),
                episode_trigger=lambda x: True,
                name_prefix=f"episode",
            )

            algo_cls = ALGO_MAP.get(config.algorithm.upper(), PPO)
            policy = "MlpPolicy"

            algo_kwargs = dict(config.hyperparameters)
            if config.seed is not None:
                algo_kwargs["seed"] = config.seed

            self._model = algo_cls(policy, self._env, verbose=0, **algo_kwargs)

            # Read initial reward code
            self._current_reward_code = self._read_reward_code()

            cb = StreamingCallback(
                run_id=config.run_id,
                total_timesteps=config.total_timesteps,
                emit_fn=self._emit_telemetry,
                stop_event=self._stop_event,
                pause_event=self._pause_event,
            )

            self._model.learn(total_timesteps=config.total_timesteps, callback=cb)

            if self._stop_event.is_set():
                self.state = RunState.STOPPED
            else:
                self.state = RunState.COMPLETED

        except Exception as e:
            logger.exception(f"Training failed: {e}")
            self.error = str(e)
            self.state = RunState.FAILED
        finally:
            if self._env is not None:
                try:
                    self._env.close()
                except Exception:
                    pass
            self._broadcast({
                "type": "status",
                **self.get_status().model_dump()
            })