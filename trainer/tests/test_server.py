import httpx
import pytest
import pytest_asyncio

from exterm_trainer.protocol.messages import RunConfig, RunState
from exterm_trainer.server import app, get_status, runner


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


@pytest.mark.asyncio
async def test_short_run_execution():
    config = RunConfig(env_id="CartPole-v1", algorithm="PPO", total_timesteps=200)
    runner.start(config)
    try:
        assert runner.get_status().state in [RunState.STARTING, RunState.TRAINING, RunState.COMPLETED]
    finally:
        runner.stop()
