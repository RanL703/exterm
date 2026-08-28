import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .engine.runner import TrainingRunner
from .protocol.messages import (
    CommandMessage,
    RunConfig,
    StatusResponse,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("exterm.server")

runner = TrainingRunner()


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


@app.get("/api/v1/status", response_model=StatusResponse)
async def get_status():
    return runner.get_status()


@app.post("/api/v1/run", response_model=StatusResponse)
async def start_run(config: RunConfig):
    try:
        runner.start(config)
        return runner.get_status()
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/v1/run/pause", response_model=StatusResponse)
async def pause_run():
    runner.pause()
    return runner.get_status()


@app.post("/api/v1/run/resume", response_model=StatusResponse)
async def resume_run():
    runner.resume()
    return runner.get_status()


@app.post("/api/v1/run/stop", response_model=StatusResponse)
async def stop_run():
    runner.stop()
    return runner.get_status()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
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
