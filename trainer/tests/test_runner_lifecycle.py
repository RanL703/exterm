import threading
import time

import gymnasium as gym
import pytest

from exterm_trainer.engine import runner as runner_module
from exterm_trainer.engine.runner import TrainingRunner
from exterm_trainer.protocol.messages import RunConfig, RunState


def test_runner_stays_starting_until_model_is_ready(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    constructing_model = threading.Event()
    release_model = threading.Event()

    class DelayedModel:
        def __init__(self, _policy, _env, **_kwargs):
            constructing_model.set()
            assert release_model.wait(timeout=5)

        def learn(self, **_kwargs):
            pass

    monkeypatch.setitem(runner_module.ALGO_MAP, "PPO", DelayedModel)
    runner = TrainingRunner()
    runner.start(RunConfig(run_id="startup-state", total_timesteps=10))
    try:
        assert constructing_model.wait(timeout=10)
        assert runner.get_status().state == RunState.STARTING
    finally:
        release_model.set()

    deadline = time.monotonic() + 5
    while runner.get_status().state not in (RunState.COMPLETED, RunState.FAILED) and time.monotonic() < deadline:
        time.sleep(0.01)
    assert runner.get_status().state == RunState.COMPLETED


def test_runner_rejects_restart_until_stopped_worker_exits(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    constructing_model = threading.Event()
    release_model = threading.Event()
    learning_started = threading.Event()
    release_learning = threading.Event()

    class BlockingModel:
        def __init__(self, _policy, _env, **_kwargs):
            constructing_model.set()
            assert release_model.wait(timeout=5)

        def learn(self, **_kwargs):
            learning_started.set()
            assert release_learning.wait(timeout=5)

    monkeypatch.setitem(runner_module.ALGO_MAP, "PPO", BlockingModel)
    runner = TrainingRunner()
    runner.start(RunConfig(run_id="stopping-state", total_timesteps=10))
    try:
        assert constructing_model.wait(timeout=10)
        release_model.set()
        assert learning_started.wait(timeout=10)
        runner.stop()
        with pytest.raises(RuntimeError, match="still stopping"):
            runner.start(RunConfig(run_id="overlapping-state", total_timesteps=10))
    finally:
        release_model.set()
        release_learning.set()
        if runner._thread is not None:
            runner._thread.join(timeout=5)

    assert not runner._thread.is_alive()
