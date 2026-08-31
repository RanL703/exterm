import uuid
from enum import Enum
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field


class RunState(str, Enum):
    IDLE = "idle"
    STARTING = "starting"
    TRAINING = "training"
    PAUSED = "paused"
    COMPLETED = "completed"
    STOPPED = "stopped"
    FAILED = "failed"


class RunConfig(BaseModel):
    run_id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8], description="Unique ID for this run")
    env_id: str = Field(default="CartPole-v1", description="Gymnasium environment ID")
    algorithm: str = Field(default="PPO", description="RL algorithm (PPO, DQN, SAC, etc.)")
    total_timesteps: int = Field(default=50_000, description="Total training timesteps budget")
    seed: Optional[int] = Field(default=None, description="Random seed")
    hyperparameters: Dict[str, Any] = Field(default_factory=dict, description="Algorithm hyperparameters")


class TelemetryEvent(BaseModel):
    type: Literal["telemetry"] = "telemetry"
    run_id: Optional[str] = None
    timestamp: float
    timesteps: int
    total_timesteps: int
    progress: float
    episode_count: int
    episode_reward: Optional[float] = None
    episode_length: Optional[int] = None
    mean_reward_100: Optional[float] = None
    fps: int = 0
    metrics: Dict[str, float] = Field(default_factory=dict)


class StatusResponse(BaseModel):
    run_id: Optional[str] = None
    state: RunState
    current_run: Optional[RunConfig] = None
    timesteps: int = 0
    total_timesteps: int = 0
    episodes: int = 0
    mean_reward_100: Optional[float] = None
    fps: int = 0
    error: Optional[str] = None


class StatusMessage(BaseModel):
    type: Literal["status"] = "status"
    run_id: Optional[str] = None
    state: RunState
    timesteps: int = 0
    total_timesteps: int = 0
    episodes: int = 0
    mean_reward_100: Optional[float] = None
    fps: int = 0
    error: Optional[str] = None
    current_run: Optional[RunConfig] = None


class LogMessage(BaseModel):
    type: Literal["log"] = "log"
    run_id: Optional[str] = None
    level: str = "info"
    message: str
    timestamp: float


class CommandMessage(BaseModel):
    action: Literal["pause", "resume", "stop", "steer"]
    payload: Optional[Dict[str, Any]] = None


class CheckpointInfo(BaseModel):
    checkpoint_id: str
    run_id: str
    timesteps: int
    episode_count: int
    mean_reward_100: Optional[float]
    created_at: float
    reward_code: str
    hyperparameters: Dict[str, Any]
    algorithm: str
    env_id: str


class CheckpointListResponse(BaseModel):
    checkpoints: List[CheckpointInfo]


class SteerRequest(BaseModel):
    instruction: str
    checkpoint_id: Optional[str] = None


class SteerResponse(BaseModel):
    diff: str
    applied: bool
    requires_confirmation: bool
    checkpoint_id: str
    message: str


class RollbackRequest(BaseModel):
    checkpoint_id: str


class RollbackResponse(BaseModel):
    success: bool
    message: str


# === Agentic Features Models ===

class TrainingAnalysis(BaseModel):
    """Analysis of training performance."""
    run_id: str
    status: RunState
    progress_pct: float
    total_timesteps: int
    episodes: int
    mean_reward_100: Optional[float]
    recent_reward_trend: Literal["improving", "stable", "degrading", "volatile"]
    fps: int
    issues: List[str]
    recommendations: List[str]


class AnalysisResponse(BaseModel):
    """Response from training analysis."""
    analysis: TrainingAnalysis
    suggested_steering: List[str]
    suggested_hyperparams: Dict[str, Any]


class AutoSteerConfig(BaseModel):
    """Configuration for autonomous steering."""
    enabled: bool = False
    max_actions_per_hour: int = 3
    min_reward_threshold: Optional[float] = None
    target_reward: Optional[float] = None
    allowed_instructions: List[str] = Field(default_factory=lambda: [
        "penalize jerky movements",
        "encourage exploration",
        "reward longer episodes",
        "be more cautious",
        "increase entropy",
        "reduce learning rate",
    ])


class AutoSteerStatus(BaseModel):
    """Current status of auto-steer."""
    enabled: bool
    actions_this_hour: int
    last_action_time: Optional[float]
    last_instruction: Optional[str]
    config: AutoSteerConfig


class AgentActionLog(BaseModel):
    """Audit log entry for agent actions."""
    timestamp: float
    action_type: Literal["analyze", "steer", "hyperparam_suggest", "auto_steer"]
    instruction: Optional[str]
    applied: bool
    requires_confirmation: bool
    checkpoint_id: Optional[str]
    diff: Optional[str]
    metadata: Dict[str, Any] = Field(default_factory=dict)


class AgentLogResponse(BaseModel):
    logs: List[AgentActionLog]
    total: int


class SteeringSuggestion(BaseModel):
    instruction: str
    rationale: str
    confidence: float
    risk_level: Literal["low", "medium", "high"]


class HyperparamSuggestion(BaseModel):
    param: str
    current_value: Any
    suggested_value: Any
    rationale: str


class VideoInfo(BaseModel):
    run_id: str
    filename: str
    path: str
    size_bytes: int
    created_at: float


class VideoListResponse(BaseModel):
    videos: List[VideoInfo]
