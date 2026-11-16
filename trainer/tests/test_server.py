import httpx
import pytest
import pytest_asyncio
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from exterm_trainer.protocol.messages import RunConfig, RunState
from exterm_trainer.server import app, get_status, runner
import exterm_trainer.server as server_module


@pytest_asyncio.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as value:
        yield value


@pytest.mark.asyncio
async def test_health(client):
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["version"] == "0.1.0"


@pytest.mark.asyncio
async def test_status_idle(client):
    response = await get_status()
    assert response.state in list(RunState)


def test_bearer_token_rejects_missing_or_invalid_credentials(monkeypatch):
    monkeypatch.setattr(server_module, "BEARER_TOKEN", "integration-token")

    with pytest.raises(HTTPException) as missing:
        server_module.verify_token(None)
    assert missing.value.status_code == 401

    with pytest.raises(HTTPException) as invalid:
        server_module.verify_token(HTTPAuthorizationCredentials(scheme="Bearer", credentials="wrong-token"))
    assert invalid.value.status_code == 401

    server_module.verify_token(HTTPAuthorizationCredentials(scheme="Bearer", credentials="integration-token"))


@pytest.mark.asyncio
async def test_short_run_execution():
    config = RunConfig(env_id="CartPole-v1", algorithm="PPO", total_timesteps=200)
    runner.start(config)
    try:
        assert runner.get_status().state in [RunState.STARTING, RunState.TRAINING, RunState.COMPLETED]
    finally:
        runner.stop()
