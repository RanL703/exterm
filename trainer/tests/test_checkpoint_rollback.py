from pathlib import Path

from exterm_trainer.engine.runner import TrainingRunner
from exterm_trainer.protocol.messages import RunConfig


BASE = '''class RewardShapingWrapper:
    def reward_fn(self, obs, action, original_reward, terminated, truncated, info):
        return original_reward
'''
EDITED = BASE.replace("return original_reward", "return original_reward - 1.0")


class RewardShapingWrapper:
    def reward_fn(self, *_args):
        return 0.0


class FakeModel:
    def __init__(self, env, value="base"):
        self.env = env
        self.value = value

    def save(self, path):
        Path(path).write_text(self.value)

    @classmethod
    def load(cls, path, env):
        return cls(env, Path(path).read_text())

    def get_env(self):
        return self.env


class VecEnv:
    def __init__(self, wrapper):
        self.envs = [wrapper]


def test_rollback_restores_code_and_model_from_pre_edit_checkpoint(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    Path("reward.py").write_text(BASE)
    runner = TrainingRunner()
    runner.current_config = RunConfig(run_id="rollback", total_timesteps=10)
    runner._env = VecEnv(RewardShapingWrapper())
    runner._model = FakeModel(runner._env)

    checkpoint = runner.save_checkpoint("before-edit")
    runner.apply_steering(EDITED)
    assert Path("reward.py").read_text() == EDITED
    assert (tmp_path / "checkpoints" / "before-edit.zip").read_text() == "base"

    runner.load_checkpoint(checkpoint.checkpoint_id)
    assert Path("reward.py").read_text() == BASE
    assert runner._model.value == "base"


def test_checkpoint_restore_works_without_project_reward_file(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    runner = TrainingRunner()
    runner.current_config = RunConfig(run_id="no-reward-file", total_timesteps=10)
    runner._env = VecEnv(RewardShapingWrapper())
    runner._model = FakeModel(runner._env)

    checkpoint = runner.save_checkpoint("no-reward-code")
    runner._model.value = "changed"
    runner.load_checkpoint(checkpoint.checkpoint_id)

    assert runner._model.value == "base"
    assert not Path("reward.py").exists()
