import asyncio
import json
import logging
import os
import threading
import time
from collections import deque
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
    QueueSteerRequest,
    QueueSteerResponse,
    StatusResponse,
    SteeringQueueItem,
    SteeringWindow,
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
        self._current_timestep = 0
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
        self._steering_lock = threading.Lock()
        self._steering_pending = deque(maxlen=20)
        self._steering_ready = deque()
        self._steering_items: Dict[str, SteeringQueueItem] = {}

    def set_event_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    def queue_steering(self, request: QueueSteerRequest) -> QueueSteerResponse:
        with self._steering_lock:
            if request.request_id in self._steering_items:
                return QueueSteerResponse(request_id=request.request_id, state="duplicate", message="Steering request already queued")
            if any(item.instruction == request.instruction for item in self._steering_pending):
                return QueueSteerResponse(request_id=request.request_id, state="duplicate", message="An identical steering request is already queued")
            if len(self._steering_pending) + len(self._steering_ready) >= 20:
                return QueueSteerResponse(request_id=request.request_id, state="rejected", message="Steering queue is full")
            self._steering_pending.append(request)
            self._steering_items[request.request_id] = SteeringQueueItem(
                request_id=request.request_id,
                instruction=request.instruction,
                requested_at_timestep=request.requested_at_timestep,
                state="queued",
            )
            position = len(self._steering_pending)
        self._broadcast({"type": "steering_queued", "request_id": request.request_id, "instruction": request.instruction, "requested_at_timestep": request.requested_at_timestep})
        return QueueSteerResponse(request_id=request.request_id, state="queued", queue_position=position, message="Steering request queued")

    def process_safe_point(self, timestep: int) -> None:
        self._current_timestep = timestep
        with self._steering_lock:
            if not self._steering_pending:
                return
            request = self._steering_pending.popleft()
            self._pause_event.set()
            self.state = RunState.PAUSED
            item = self._steering_items[request.request_id].model_copy(update={"state": "window_open", "safe_point_timestep": timestep})
            self._steering_items[request.request_id] = item
            self._steering_ready.append((request, timestep))
        self._broadcast({"type": "steering_window_open", **SteeringWindow(request_id=request.request_id, safe_point_timestep=timestep).model_dump()})

    def get_steering_queue(self) -> List[SteeringQueueItem]:
        with self._steering_lock:
            return list(self._steering_items.values())[-20:]

    def take_ready_steering(self):
        with self._steering_lock:
            return self._steering_ready.popleft() if self._steering_ready else None

    def update_steering_item(self, request_id: str, **updates: Any) -> Optional[SteeringQueueItem]:
        with self._steering_lock:
            item = self._steering_items.get(request_id)
            if item is None:
                return None
            updated = item.model_copy(update=updates)
            self._steering_items[request_id] = updated
            return updated

    def resume_after_steering(self) -> None:
        self._pause_event.clear()
        if self.state == RunState.PAUSED:
            self.state = RunState.TRAINING

    def _broadcast(self, message: Any) -> None:
        if not self._loop or self._loop.is_closed():
            return
        for q in list(self._subscribers):
            self._loop.call_soon_threadsafe(q.put_nowait, message)

    def _emit_telemetry(self, event: TelemetryEvent) -> None:
        self.latest_telemetry = event
        self._current_timestep = event.timesteps
        self._broadcast(event.model_dump())

    def get_status(self) -> StatusResponse:
        timesteps = self._current_timestep
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
        if self._thread is not None and self._thread.is_alive():
            raise RuntimeError("Cannot start a new run while the previous training thread is still stopping")
        if self.state in (RunState.TRAINING, RunState.STARTING, RunState.PAUSED):
            raise RuntimeError(f"Cannot start training while in state {self.state}")

        self.state = RunState.STARTING
        self.current_config = config
        self.latest_telemetry = None
        self._current_timestep = 0
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

    def apply_steering(self, new_reward_code: str, new_hyperparameters: Optional[Dict[str, Any]] = None, checkpoint: bool = True) -> None:
        """Apply steering changes - update reward code and optionally hyperparameters."""
        if self._model is None:
            raise RuntimeError("No active model to steer")

        # Save checkpoint before applying changes
        if checkpoint:
            self.save_checkpoint()

        # Keep source and live wrapper aligned if hot reload fails.
        previous_code = self._read_reward_code()
        self._write_reward_code(new_reward_code)
        try:
            self._apply_live_reward_code(new_reward_code)
        except Exception:
            self._write_reward_code(previous_code)
            raise
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
            path = Path("reward.py")
            temporary = path.with_suffix(".py.tmp")
            temporary.write_text(code)
            temporary.replace(path)
        except Exception as e:
            raise RuntimeError(f"Failed to write reward.py: {e}") from e

    def _apply_live_reward_code(self, code: str) -> None:
        """Reload the validated reward function in the active wrapper."""
        if self._model is None:
            return
        import importlib.util
        import types

        spec = importlib.util.spec_from_file_location("exterm_live_reward", Path("reward.py"))
        if spec is None or spec.loader is None:
            raise RuntimeError("Could not load reward.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        reward_class = getattr(module, "RewardShapingWrapper", None)
        if reward_class is None:
            raise RuntimeError("reward.py does not define RewardShapingWrapper")

        def find_wrapper(value: Any, seen: set[int]) -> Any:
            if value is None or id(value) in seen:
                return None
            seen.add(id(value))
            if value.__class__.__name__ == "RewardShapingWrapper":
                return value
            for attribute in ("env", "venv"):
                found = find_wrapper(getattr(value, attribute, None), seen)
                if found is not None:
                    return found
            for child in getattr(value, "envs", []) or []:
                found = find_wrapper(child, seen)
                if found is not None:
                    return found
            return None

        wrapper = find_wrapper(self._model.get_env(), set())
        if wrapper is None:
            raise RuntimeError("active training environment is not using RewardShapingWrapper")
        wrapper.reward_fn = types.MethodType(reward_class.reward_fn, wrapper)

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

        # Publish the restored model only after source restoration succeeds.
        restored_model = self._model.__class__.load(str(model_path), env=self._env)
        if checkpoint.reward_code:
            previous_code = self._read_reward_code()
            try:
                self._write_reward_code(checkpoint.reward_code)
            except Exception:
                self._write_reward_code(previous_code)
                raise
        self._model = restored_model
        if checkpoint.reward_code:
            self._apply_live_reward_code(checkpoint.reward_code)
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

            # Load the project-owned reward wrapper so steering changes affect training.
            import importlib.util
            reward_path = Path("reward.py")
            if reward_path.exists():
                spec = importlib.util.spec_from_file_location("exterm_reward", reward_path)
                if spec is None or spec.loader is None:
                    raise RuntimeError("Could not load reward.py")
                reward_module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(reward_module)
                record_video = True
                try:
                    base_env = reward_module.make_env(config.env_id, render_mode="rgb_array")
                except TypeError:
                    base_env = reward_module.make_env(config.env_id)
                    record_video = False
            else:
                base_env = gym.make(config.env_id, render_mode="rgb_array")
                record_video = True
            self._env = Monitor(base_env)

            # Wrap with RecordVideo for episode replay
            # Record every episode (episode_trigger=lambda x: True)
            if record_video:
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

            if not self._stop_event.is_set():
                self.state = RunState.TRAINING
            self._broadcast({
                "type": "status",
                **self.get_status().model_dump()
            })

            # Read initial reward code
            self._current_reward_code = self._read_reward_code()

            cb = StreamingCallback(
                run_id=config.run_id,
                total_timesteps=config.total_timesteps,
                emit_fn=self._emit_telemetry,
                stop_event=self._stop_event,
                pause_event=self._pause_event,
                safe_point_fn=self.process_safe_point,
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
