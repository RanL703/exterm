import asyncio
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen

import pytest
import websockets


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class OllamaFixture(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/api/chat":
            self.send_error(404)
            return
        request = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        prompt = json.dumps(request.get("messages", []))
        if "speed" in prompt.lower():
            reward_fn = "return original_reward + 0.25 * float(abs(obs[1])) if terminated else original_reward"
            rationale = "Prioritize speed over gentle landings."
            risk_tier = "auto"
        elif "extremely gentle" in prompt.lower():
            reward_fn = "return original_reward - 5.0 * float(abs(obs[1])) if terminated else original_reward"
            rationale = "This aggressive shaping may destabilize learning."
            risk_tier = "confirm"
        else:
            reward_fn = "return original_reward - 0.25 * float(abs(obs[1])) if terminated else original_reward"
            rationale = "Increase the cost of high vertical velocity at terminal landing."
            risk_tier = "auto"
        payload = {
            "message": {
                "role": "assistant",
                "content": json.dumps({
                    "reward_fn": reward_fn,
                    "rationale": rationale,
                    "risk_tier": risk_tier,
                }),
            }
        }
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


def post_json(url: str, payload: dict) -> dict:
    request = Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urlopen(request, timeout=10) as response:
        return json.load(response)


@pytest.mark.parametrize("instruction", [
    "penalize hard landings more",
    "prioritize speed over gentle landings",
    "make landings extremely gentle above all else",
])
def test_real_trainer_applies_lunar_lander_steering_at_safe_point(instruction):
    try:
        trainer_port = free_port()
        ollama_port = free_port()
    except PermissionError:
        pytest.skip("sandbox does not permit test-created local sockets")
    ollama = ThreadingHTTPServer(("127.0.0.1", ollama_port), OllamaFixture)
    ollama_thread = threading.Thread(target=ollama.serve_forever, daemon=True)
    ollama_thread.start()

    trainer_root = Path(__file__).parents[1]
    with tempfile.TemporaryDirectory() as project:
        shutil.copy(trainer_root / "reward.py", Path(project) / "reward.py")
        environment = {
            **os.environ,
            "PYTHONPATH": str(trainer_root),
            "OLLAMA_BASE_URL": f"http://127.0.0.1:{ollama_port}",
        }
        process = subprocess.Popen(
            [sys.executable, "-m", "exterm_trainer", "--host", "127.0.0.1", "--port", str(trainer_port), "--token", "integration-token"],
            cwd=project,
            env=environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            deadline = time.time() + 15
            while time.time() < deadline:
                try:
                    with urlopen(f"http://127.0.0.1:{trainer_port}/health", timeout=1):
                        break
                except Exception:
                    time.sleep(0.1)
            else:
                raise AssertionError("trainer did not become healthy")
            asyncio.run(_exercise_training(process, trainer_port, instruction))
        finally:
            process.terminate()
            process.wait(timeout=10)

    ollama.shutdown()
    ollama.server_close()


async def _exercise_training(process: subprocess.Popen, trainer_port: int, instruction: str):
    ws_url = f"ws://127.0.0.1:{trainer_port}/ws?token=integration-token"
    async with websockets.connect(ws_url, open_timeout=5) as websocket:
        initial = json.loads(await websocket.recv())
        assert initial["type"] == "status"
        await asyncio.to_thread(post_json, f"http://127.0.0.1:{trainer_port}/api/v1/run", {
            "run_id": "lunar-steering-" + instruction[:3],
            "env_id": "LunarLander-v3",
            "algorithm": "DQN",
            "total_timesteps": 1500,
            "seed": 7,
            "hyperparameters": {"learning_starts": 10, "train_freq": 4},
        })
        await websocket.send(json.dumps({"action": "steer", "payload": {"instruction": instruction}}))

        events = []
        applied = False
        for _ in range(300):
            message = json.loads(await asyncio.wait_for(websocket.recv(), timeout=1))
            events.append(message)
            if message.get("type") == "steering_pending":
                await asyncio.to_thread(post_json, f"http://127.0.0.1:{trainer_port}/api/v1/steer/queue/{message['request_id']}/approve", {})
            if message.get("type") == "steering_applied":
                applied = True
                break
            if message.get("type") == "steering_failed":
                raise AssertionError(message.get("message"))
        assert any(event.get("type") == "steering_queued" for event in events)
        assert any(event.get("type") == "steering_window_open" for event in events)
        assert applied

        status = await asyncio.to_thread(
            urlopen,
            Request(f"http://127.0.0.1:{trainer_port}/api/v1/status", headers={"Authorization": "Bearer integration-token"}),
        )
        data = json.loads(status.read())
        assert data["timesteps"] >= 1
