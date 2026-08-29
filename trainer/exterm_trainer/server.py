import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Optional

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .engine.runner import TrainingRunner
from .protocol.messages import (
    CheckpointInfo,
    CheckpointListResponse,
    CommandMessage,
    RollbackRequest,
    RollbackResponse,
    RunConfig,
    StatusResponse,
    SteerRequest,
    SteerResponse,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("exterm.server")

runner = TrainingRunner()

# Bearer token for authentication (set via environment or CLI)
BEARER_TOKEN: Optional[str] = os.environ.get("EXTERM_BEARER_TOKEN")


def set_bearer_token(token: Optional[str]) -> None:
    """Set the bearer token for authentication."""
    global BEARER_TOKEN
    BEARER_TOKEN = token

# Security scheme
security = HTTPBearer(auto_error=False)


def verify_token(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> None:
    """Verify bearer token if one is configured."""
    if BEARER_TOKEN is None:
        # No token configured - allow all (local development mode)
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
    logger.info("exterm-trainer initialized")
    yield
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
        # For now, we'll use a simple approach: apply the instruction directly
        # In a full implementation, this would use an LLM to translate NL to code changes
        # For v1, we'll simulate this with a basic reward modification

        # Create a checkpoint before steering
        checkpoint = runner.save_checkpoint()

        # Read current reward code
        current_code = runner._read_reward_code()

        # Apply a simple steering transformation (placeholder for LLM integration)
        new_code = apply_steering_instruction(current_code, request.instruction)

        # Check if change is risky (changes action/observation space, core training loop)
        requires_confirmation = is_risky_change(current_code, new_code)

        if requires_confirmation:
            return SteerResponse(
                diff=generate_diff(current_code, new_code),
                applied=False,
                requires_confirmation=True,
                checkpoint_id=checkpoint.checkpoint_id,
                message="Change requires confirmation due to risk level",
            )

        # Apply the change
        runner.apply_steering(new_code)

        return SteerResponse(
            diff=generate_diff(current_code, new_code),
            applied=True,
            requires_confirmation=False,
            checkpoint_id=checkpoint.checkpoint_id,
            message="Steering applied successfully",
        )
    except Exception as e:
        logger.exception(f"Steering failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/steer/confirm", response_model=SteerResponse, dependencies=[Depends(verify_token)])
async def confirm_steer(request: SteerRequest):
    try:
        current_code = runner._read_reward_code()
        new_code = apply_steering_instruction(current_code, request.instruction)
        runner.apply_steering(new_code)
        checkpoint = runner.save_checkpoint()
        return SteerResponse(
            diff=generate_diff(current_code, new_code),
            applied=True,
            requires_confirmation=False,
            checkpoint_id=checkpoint.checkpoint_id,
            message="Steering confirmed and applied",
        )
    except Exception as e:
        logger.exception(f"Steering confirmation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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


def apply_steering_instruction(code: str, instruction: str) -> str:
    """Apply a natural language steering instruction to reward code.
    This is a simplified implementation - in production would use LLM."""
    # Simple keyword-based transformations for demo
    lines = code.split('\n')
    modified = False

    for i, line in enumerate(lines):
        if 'return original_reward' in line and not modified:
            instruction_lower = instruction.lower()
            if 'penalize' in instruction_lower and 'jerk' in instruction_lower:
                lines[i] = line.replace(
                    'return original_reward',
                    'return original_reward - 0.1 * np.sum(np.square(action))  # penalize jerky actions'
                )
                modified = True
            elif 'cautious' in instruction_lower or 'safe' in instruction_lower:
                lines[i] = line.replace(
                    'return original_reward',
                    'return original_reward - 0.05 * np.sum(np.square(action))  # cautious: penalize large actions'
                )
                modified = True
            elif 'reward' in instruction_lower and 'long' in instruction_lower:
                lines[i] = line.replace(
                    'return original_reward',
                    'return original_reward + 0.01 * (1.0 - terminated)  # reward longer episodes'
                )
                modified = True
            elif 'explore' in instruction_lower:
                lines[i] = line.replace(
                    'return original_reward',
                    'return original_reward + 0.001 * np.random.randn()  # encourage exploration'
                )
                modified = True

    if not modified:
        # Default: add a comment showing the instruction was received
        for i, line in enumerate(lines):
            if 'return original_reward' in line:
                lines[i] = line + f'  # steering: {instruction}'
                break

    return '\n'.join(lines)


def is_risky_change(old_code: str, new_code: str) -> bool:
    """Determine if a code change is risky and requires confirmation."""
    # Check for changes to observation/action space, imports, class structure
    risky_patterns = [
        'import', 'class ', 'def make_env', 'def step', 'def reset',
        'observation_space', 'action_space', 'gym.make', 'Wrapper',
    ]
    for pattern in risky_patterns:
        if pattern in new_code and pattern not in old_code:
            return True
        if pattern in old_code and pattern not in new_code:
            return True
    return False


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
            # Check Authorization header
            auth_header = websocket.headers.get("authorization", "")
            if auth_header.startswith("Bearer "):
                token = auth_header[7:]
        if token != BEARER_TOKEN:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token")
            return

    await websocket.accept()
    queue = runner.subscribe()

    # Send current status immediately upon connection
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
