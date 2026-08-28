import pytest
from fastapi.testclient import TestClient
from exterm_trainer.server import app
from exterm_trainer.protocol.messages import RunConfig, RunState


def test_health():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["version"] == "0.1.0"


def test_status_idle():
    client = TestClient(app)
    response = client.get("/api/v1/status")
    assert response.status_code == 200
    data = response.json()
    assert data["state"] in [s.value for s in RunState]


def test_short_run_execution():
    client = TestClient(app)
    # Start a 200-step test run
    config = RunConfig(
        env_id="CartPole-v1",
        algorithm="PPO",
        total_timesteps=200,
    )
    response = client.post("/api/v1/run", json=config.model_dump())
    assert response.status_code == 200
    status = response.json()
    assert status["state"] in ["starting", "training", "completed"]
