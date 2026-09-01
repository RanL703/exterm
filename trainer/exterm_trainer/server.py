import asyncio
import json
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator, List, Optional

import httpx
from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .agent.graph import run_analysis, run_steering
from .engine.runner import TrainingRunner
from .protocol.messages import (
    AgentActionLog,
    AgentLogResponse,
    AnalysisResponse,
    AutoSteerConfig,
    AutoSteerStatus,
    CheckpointInfo,
    CheckpointListResponse,
    CommandMessage,
    QueueSteerRequest,
    QueueSteerResponse,
    HyperparamSuggestion,
    RollbackRequest,
    RollbackResponse,
    RunConfig,
    RunState,
    StatusResponse,
    SteerRequest,
    SteerResponse,
    SteeringSuggestion,
    SteeringQueueResponse,
    TrainingAnalysis,
    VideoInfo,
    VideoListResponse,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("exterm.server")

# Ollama configuration
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen3.5:9b")

runner = TrainingRunner()

# Bearer token for authentication (set via environment or CLI)
BEARER_TOKEN: Optional[str] = os.environ.get("EXTERM_BEARER_TOKEN")


# === Guardrails Configuration ===
class GuardrailsConfig:
    """Centralized guardrails configuration."""
    # Rate limiting
    MAX_LLM_CALLS_PER_MINUTE: int = 10
    MAX_STEER_ACTIONS_PER_HOUR: int = 10
    MAX_ANALYSIS_CALLS_PER_MINUTE: int = 5
    
    # Auto-steer limits
    AUTO_STEER_MAX_ACTIONS_PER_HOUR: int = 3
    AUTO_STEER_MIN_INTERVAL_SECONDS: int = 300  # 5 minutes between auto-actions
    
    # Input validation
    MAX_INSTRUCTION_LENGTH: int = 500
    FORBIDDEN_PATTERNS: List[str] = [
        "import ", "exec(", "eval(", "__import__", "subprocess",
        "os.system", "open(", "file(", "compile(",
        "observation_space", "action_space", "gym.make",
        "def step", "def reset", "def __init__",
        "class ", "Wrapper",
    ]
    
    # Code safety
    ALLOWED_MODULES: List[str] = ["numpy", "np", "math", "random"]
    MAX_CODE_LINES: int = 50
    
    # Confirmation thresholds
    RISKY_CHANGE_PATTERNS: List[str] = [
        'import', 'class ', 'def make_env', 'def step', 'def reset',
        'observation_space', 'action_space', 'gym.make', 'Wrapper',
    ]


GUARDRAILS = GuardrailsConfig()

# Rate limiting state
_llm_call_times: List[float] = []
_steer_action_times: List[float] = []
_analysis_call_times: List[float] = []

# Agent action audit log
_agent_action_log: List[AgentActionLog] = []
_auto_steer_config = AutoSteerConfig()
_auto_steer_action_times: List[float] = []
_pending_steering_proposals: dict[str, dict] = {}


def set_bearer_token(token: Optional[str]) -> None:
    """Set the bearer token for authentication."""
    global BEARER_TOKEN
    BEARER_TOKEN = token


def check_rate_limit(call_times: List[float], max_calls: int, window_seconds: int = 60) -> bool:
    """Check if rate limit is exceeded."""
    now = time.time()
    call_times[:] = [t for t in call_times if now - t < window_seconds]
    return len(call_times) < max_calls


def record_call(call_times: List[float]) -> None:
    """Record a call timestamp."""
    call_times.append(time.time())


def validate_instruction(instruction: str) -> tuple[bool, Optional[str]]:
    """Validate steering instruction for safety."""
    if len(instruction) > GUARDRAILS.MAX_INSTRUCTION_LENGTH:
        return False, f"Instruction too long (max {GUARDRAILS.MAX_INSTRUCTION_LENGTH} chars)"
    
    instruction_lower = instruction.lower()
    for pattern in GUARDRAILS.FORBIDDEN_PATTERNS:
        if pattern in instruction_lower:
            return False, f"Forbidden pattern detected: {pattern}"
    
    return True, None


def is_risky_change(old_code: str, new_code: str) -> bool:
    """Determine if a code change is risky and requires confirmation."""
    for pattern in GUARDRAILS.RISKY_CHANGE_PATTERNS:
        if pattern in new_code and pattern not in old_code:
            return True
        if pattern in old_code and pattern not in new_code:
            return True
    return False


def log_agent_action(action: AgentActionLog) -> None:
    """Log agent action for audit trail."""
    _agent_action_log.append(action)
    if len(_agent_action_log) > 1000:
        _agent_action_log.pop(0)


# Security scheme
security = HTTPBearer(auto_error=False)


async def process_steering_queue() -> None:
    while True:
        ready = runner.take_ready_steering()
        if ready is None:
            await asyncio.sleep(0.05)
            continue

        request, safe_point_timestep = ready
        request_id = request.request_id
        try:
            checkpoint = runner.save_checkpoint()
            current_code = runner._read_reward_code()
            env_id = runner.current_config.env_id if runner.current_config else "CartPole-v1"
            algorithm = runner.current_config.algorithm if runner.current_config else "PPO"
            result = await run_steering(current_code, request.instruction, env_id, algorithm)
            new_code = result.get("new_code", current_code)
            diff = result.get("diff", "")
            requires_confirmation = result.get("requires_confirmation", False)
            if requires_confirmation:
                _pending_steering_proposals[request_id] = {"request": request, "new_code": new_code, "diff": diff, "checkpoint_id": checkpoint.checkpoint_id, "safe_point_timestep": safe_point_timestep}
                item = runner.update_steering_item(request_id, state="pending", checkpoint_id=checkpoint.checkpoint_id, diff=diff, message="Change requires confirmation")
                runner._broadcast({"type": "steering_pending", "request_id": request_id, "checkpoint_id": checkpoint.checkpoint_id, "safe_point_timestep": safe_point_timestep, "diff": diff})
                log_agent_action(AgentActionLog(timestamp=time.time(), action_type="steer", instruction=request.instruction, applied=False, requires_confirmation=True, checkpoint_id=checkpoint.checkpoint_id, diff=diff, metadata={"safe_point_timestep": safe_point_timestep}))
            else:
                runner.apply_steering(new_code)
                item = runner.update_steering_item(request_id, state="applied", checkpoint_id=checkpoint.checkpoint_id, diff=diff, message="Steering applied successfully")
                runner._broadcast({"type": "steering_applied", "request_id": request_id, "checkpoint_id": checkpoint.checkpoint_id, "safe_point_timestep": safe_point_timestep, "diff": diff})
                log_agent_action(AgentActionLog(timestamp=time.time(), action_type="steer", instruction=request.instruction, applied=True, requires_confirmation=False, checkpoint_id=checkpoint.checkpoint_id, diff=diff, metadata={"safe_point_timestep": safe_point_timestep}))
                runner.resume_after_steering()
        except Exception as error:
            runner.update_steering_item(request_id, state="failed", message=str(error))
            runner._broadcast({"type": "steering_failed", "request_id": request_id, "safe_point_timestep": safe_point_timestep, "message": str(error)})
            runner.resume_after_steering()
        runner._broadcast({"type": "status", **runner.get_status().model_dump()})


def verify_token(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> None:
    """Verify bearer token if one is configured."""
    if BEARER_TOKEN is None:
        return
    if credentials is None or credentials.credentials != BEARER_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    loop = asyncio.get_running_loop()
    runner.set_event_loop(loop)
    worker = asyncio.create_task(process_steering_queue())
    logger.info("exterm-trainer initialized")
    try:
        yield
    finally:
        worker.cancel()
        runner.stop()


app = FastAPI(title="exterm-trainer", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}


@app.get("/api/v1/status", response_model=StatusResponse, dependencies=[Depends(verify_token)])
async def get_status():
    return runner.get_status()


@app.post("/api/v1/run", response_model=StatusResponse, dependencies=[Depends(verify_token)])
async def start_run(config: RunConfig):
    try:
        runner.start(config)
        return runner.get_status()
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/v1/run/pause", response_model=StatusResponse, dependencies=[Depends(verify_token)])
async def pause_run():
    runner.pause()
    return runner.get_status()


@app.post("/api/v1/run/resume", response_model=StatusResponse, dependencies=[Depends(verify_token)])
async def resume_run():
    runner.resume()
    return runner.get_status()


@app.post("/api/v1/run/stop", response_model=StatusResponse, dependencies=[Depends(verify_token)])
async def stop_run():
    runner.stop()
    return runner.get_status()


@app.get("/api/v1/checkpoints", response_model=CheckpointListResponse, dependencies=[Depends(verify_token)])
async def list_checkpoints():
    return CheckpointListResponse(checkpoints=runner.list_checkpoints())


@app.post("/api/v1/checkpoints", response_model=CheckpointInfo, dependencies=[Depends(verify_token)])
async def create_checkpoint():
    try:
        return runner.save_checkpoint()
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/v1/checkpoints/{checkpoint_id}/restore", response_model=StatusResponse, dependencies=[Depends(verify_token)])
async def restore_checkpoint(checkpoint_id: str):
    try:
        runner.load_checkpoint(checkpoint_id)
        return runner.get_status()
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/v1/steer", response_model=SteerResponse, dependencies=[Depends(verify_token)])
async def steer(request: SteerRequest):
    try:
        # Guardrails: validate instruction
        valid, error = validate_instruction(request.instruction)
        if not valid:
            raise HTTPException(status_code=400, detail=f"Instruction validation failed: {error}")
        
        # Guardrails: rate limiting
        if not check_rate_limit(_steer_action_times, GUARDRAILS.MAX_STEER_ACTIONS_PER_HOUR, 3600):
            raise HTTPException(status_code=429, detail="Rate limit exceeded: max steer actions per hour reached")
        record_call(_steer_action_times)
        
        if not check_rate_limit(_llm_call_times, GUARDRAILS.MAX_LLM_CALLS_PER_MINUTE):
            raise HTTPException(status_code=429, detail="Rate limit exceeded: max LLM calls per minute reached")
        record_call(_llm_call_times)

        # Create a checkpoint before steering
        checkpoint = runner.save_checkpoint()

        # Read current reward code
        current_code = runner._read_reward_code()

        # Get environment and algorithm info
        env_id = runner.current_config.env_id if runner.current_config else "CartPole-v1"
        algorithm = runner.current_config.algorithm if runner.current_config else "PPO"

        # Apply steering via LangGraph agent
        result = await run_steering(current_code, request.instruction, env_id, algorithm)

        if result.get("error"):
            logger.warning(f"Steering failed, falling back: {result['error']}")

        new_code = result.get("new_code", current_code)
        diff = result.get("diff", "")
        requires_confirmation = result.get("requires_confirmation", False)
        risk_level = result.get("risk_level", "low")

        if requires_confirmation:
            log_agent_action(AgentActionLog(
                timestamp=time.time(),
                action_type="steer",
                instruction=request.instruction,
                applied=False,
                requires_confirmation=True,
                checkpoint_id=checkpoint.checkpoint_id,
                diff=diff,
                metadata={"env_id": env_id, "algorithm": algorithm, "risk_level": risk_level}
            ))
            return SteerResponse(
                diff=diff,
                applied=False,
                requires_confirmation=True,
                checkpoint_id=checkpoint.checkpoint_id,
                message="Change requires confirmation due to risk level",
            )

        # Apply the change
        runner.apply_steering(new_code)

        log_agent_action(AgentActionLog(
            timestamp=time.time(),
            action_type="steer",
            instruction=request.instruction,
            applied=True,
            requires_confirmation=False,
            checkpoint_id=checkpoint.checkpoint_id,
            diff=diff,
            metadata={"env_id": env_id, "algorithm": algorithm, "risk_level": risk_level}
        ))

        return SteerResponse(
            diff=diff,
            applied=True,
            requires_confirmation=False,
            checkpoint_id=checkpoint.checkpoint_id,
            message="Steering applied successfully",
        )
    except Exception as e:
        logger.exception(f"Steering failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/steer/queue", response_model=QueueSteerResponse, dependencies=[Depends(verify_token)])
async def queue_steer(request: SteerRequest):
    valid, error = validate_instruction(request.instruction)
    if not valid:
        raise HTTPException(status_code=400, detail=f"Instruction validation failed: {error}")
    requested_at = runner.latest_telemetry.timesteps if runner.latest_telemetry else 0
    request_id = request.checkpoint_id or str(uuid.uuid4())[:8]
    return runner.queue_steering(QueueSteerRequest(request_id=request_id, instruction=request.instruction, requested_at_timestep=requested_at))


@app.get("/api/v1/steer/queue", response_model=SteeringQueueResponse, dependencies=[Depends(verify_token)])
async def get_steering_queue():
    return SteeringQueueResponse(items=runner.get_steering_queue())


@app.post("/api/v1/steer/queue/{request_id}/approve", response_model=SteerResponse, dependencies=[Depends(verify_token)])
async def approve_queued_steer(request_id: str):
    proposal = _pending_steering_proposals.pop(request_id, None)
    if proposal is None:
        raise HTTPException(status_code=404, detail=f"Steering proposal {request_id} not found")
    try:
        runner.apply_steering(proposal["new_code"])
        runner.update_steering_item(request_id, state="applied", message="Steering confirmed and applied")
        runner.resume_after_steering()
        runner._broadcast({"type": "steering_applied", "request_id": request_id, "checkpoint_id": proposal["checkpoint_id"], "safe_point_timestep": proposal["safe_point_timestep"], "diff": proposal["diff"]})
        runner._broadcast({"type": "status", **runner.get_status().model_dump()})
        log_agent_action(AgentActionLog(timestamp=time.time(), action_type="steer", instruction=proposal["request"].instruction, applied=True, requires_confirmation=False, checkpoint_id=proposal["checkpoint_id"], diff=proposal["diff"], metadata={"safe_point_timestep": proposal["safe_point_timestep"], "confirmed": True}))
        return SteerResponse(diff=proposal["diff"], applied=True, requires_confirmation=False, checkpoint_id=proposal["checkpoint_id"], message="Steering confirmed and applied")
    except Exception as error:
        runner.resume_after_steering()
        raise HTTPException(status_code=500, detail=str(error))


@app.post("/api/v1/steer/confirm", response_model=SteerResponse, dependencies=[Depends(verify_token)])
async def confirm_steer(request: SteerRequest):
    try:
        current_code = runner._read_reward_code()
        env_id = runner.current_config.env_id if runner.current_config else "CartPole-v1"
        algorithm = runner.current_config.algorithm if runner.current_config else "PPO"
        
        result = await run_steering(current_code, request.instruction, env_id, algorithm)
        new_code = result.get("new_code", current_code)
        diff = result.get("diff", "")
        
        runner.apply_steering(new_code)
        checkpoint = runner.save_checkpoint()
        
        log_agent_action(AgentActionLog(
            timestamp=time.time(),
            action_type="steer",
            instruction=request.instruction,
            applied=True,
            requires_confirmation=False,
            checkpoint_id=checkpoint.checkpoint_id,
            diff=diff,
            metadata={"env_id": env_id, "algorithm": algorithm, "confirmed": True}
        ))
        
        return SteerResponse(
            diff=diff,
            applied=True,
            requires_confirmation=False,
            checkpoint_id=checkpoint.checkpoint_id,
            message="Steering confirmed and applied",
        )
    except Exception as e:
        logger.exception(f"Steering confirmation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/analyze", response_model=AnalysisResponse, dependencies=[Depends(verify_token)])
async def analyze_training():
    """Analyze current training performance and suggest improvements."""
    try:
        # Guardrails: rate limiting
        if not check_rate_limit(_analysis_call_times, GUARDRAILS.MAX_ANALYSIS_CALLS_PER_MINUTE):
            raise HTTPException(status_code=429, detail="Rate limit exceeded: max analysis calls per minute reached")
        record_call(_analysis_call_times)

        if runner.state != RunState.TRAINING:
            raise HTTPException(status_code=400, detail="Training not in progress")

        current_code = runner._read_reward_code()
        env_id = runner.current_config.env_id if runner.current_config else "CartPole-v1"
        algorithm = runner.current_config.algorithm if runner.current_config else "PPO"
        
        # Get telemetry and reward history
        telemetry = runner.get_status().model_dump()
        
        # Extract reward history from telemetry (stored in runner)
        # For now, use what's available
        reward_history = []
        step_history = []
        if runner.latest_telemetry:
            # We'd need to track history in the runner
            pass

        result = await run_analysis(current_code, env_id, algorithm, telemetry, reward_history, step_history)

        log_agent_action(AgentActionLog(
            timestamp=time.time(),
            action_type="analyze",
            instruction=None,
            applied=False,
            requires_confirmation=False,
            checkpoint_id=None,
            diff=None,
            metadata={"env_id": env_id, "algorithm": algorithm}
        ))

        return AnalysisResponse(
            analysis=TrainingAnalysis(
                run_id=runner.current_config.run_id if runner.current_config else "",
                status=runner.state,
                progress_pct=telemetry.get("progress", 0) * 100,
                total_timesteps=telemetry.get("total_timesteps", 0),
                episodes=telemetry.get("episodes", 0),
                mean_reward_100=telemetry.get("mean_reward_100"),
                recent_reward_trend="stable",
                fps=telemetry.get("fps", 0),
                issues=[],
                recommendations=[],
            ),
            suggested_steering=[s.instruction for s in result.get("steering_suggestions", [])],
            suggested_hyperparams={s.param: s.suggested_value for s in result.get("hyperparam_suggestions", [])},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/agent/log", response_model=AgentLogResponse, dependencies=[Depends(verify_token)])
async def get_agent_log(limit: int = 100):
    """Get agent action audit log."""
    logs = _agent_action_log[-limit:] if limit else _agent_action_log
    return AgentLogResponse(logs=logs, total=len(_agent_action_log))


@app.get("/api/v1/agent/auto-steer/status", response_model=AutoSteerStatus, dependencies=[Depends(verify_token)])
async def get_auto_steer_status():
    """Get auto-steer configuration and status."""
    return AutoSteerStatus(
        enabled=_auto_steer_config.enabled,
        actions_this_hour=len([t for t in _auto_steer_action_times if time.time() - t < 3600]),
        last_action_time=_auto_steer_action_times[-1] if _auto_steer_action_times else None,
        last_instruction=None,
        config=_auto_steer_config,
    )


@app.post("/api/v1/agent/auto-steer/config", response_model=AutoSteerStatus, dependencies=[Depends(verify_token)])
async def update_auto_steer_config(config: AutoSteerConfig):
    """Update auto-steer configuration."""
    global _auto_steer_config
    _auto_steer_config = config
    return await get_auto_steer_status()


@app.post("/api/v1/rollback", response_model=RollbackResponse, dependencies=[Depends(verify_token)])
async def rollback(request: RollbackRequest):
    try:
        runner.load_checkpoint(request.checkpoint_id)
        return RollbackResponse(
            success=True,
            message=f"Rolled back to checkpoint {request.checkpoint_id}",
        )
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/v1/videos", response_model=VideoListResponse, dependencies=[Depends(verify_token)])
async def list_videos(run_id: Optional[str] = None):
    """List available episode replay videos."""
    videos = runner.list_videos(run_id)
    return VideoListResponse(videos=[VideoInfo(**v) for v in videos])


@app.get("/api/v1/videos/{run_id}/{filename}", dependencies=[Depends(verify_token)])
async def get_video(run_id: str, filename: str):
    """Stream an episode replay video."""
    from fastapi.responses import FileResponse
    video_path = runner.get_video_path(run_id, filename)
    if not video_path:
        raise HTTPException(status_code=404, detail="Video not found")
    return FileResponse(
        path=video_path,
        media_type="video/mp4",
        filename=filename,
    )


def generate_diff(old_code: str, new_code: str) -> str:
    """Generate a simple unified diff between two code strings."""
    import difflib
    old_lines = old_code.splitlines(keepends=True)
    new_lines = new_code.splitlines(keepends=True)
    diff = difflib.unified_diff(old_lines, new_lines, lineterm='')
    return '\n'.join(diff)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    # Verify token from query parameter or header
    if BEARER_TOKEN is not None:
        token = websocket.query_params.get("token")
        if not token:
            auth_header = websocket.headers.get("authorization", "")
            if auth_header.startswith("Bearer "):
                token = auth_header[7:]
        if token != BEARER_TOKEN:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token")
            return

    await websocket.accept()
    queue = runner.subscribe()

    initial_status = {
        "type": "status",
        **runner.get_status().model_dump(),
    }
    await websocket.send_json(initial_status)

    async def sender():
        try:
            while True:
                msg = await queue.get()
                await websocket.send_json(msg)
        except (WebSocketDisconnect, asyncio.CancelledError):
            pass

    async def receiver():
        try:
            while True:
                data = await websocket.receive_text()
                try:
                    payload = json.loads(data)
                    cmd = CommandMessage.model_validate(payload)
                    if cmd.action == "pause":
                        runner.pause()
                    elif cmd.action == "resume":
                        runner.resume()
                    elif cmd.action == "stop":
                        runner.stop()
                    elif cmd.action == "steer" and cmd.payload and cmd.payload.get("instruction"):
                        requested_at = runner.latest_telemetry.timesteps if runner.latest_telemetry else 0
                        runner.queue_steering(QueueSteerRequest(
                            request_id=str(uuid.uuid4())[:8],
                            instruction=cmd.payload["instruction"],
                            requested_at_timestep=requested_at,
                        ))
                except Exception as e:
                    logger.warning(f"Invalid WS command received: {e}")
        except (WebSocketDisconnect, asyncio.CancelledError):
            pass

    sender_task = asyncio.create_task(sender())
    receiver_task = asyncio.create_task(receiver())

    try:
        done, pending = await asyncio.wait(
            [sender_task, receiver_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
    finally:
        runner.unsubscribe(queue)
