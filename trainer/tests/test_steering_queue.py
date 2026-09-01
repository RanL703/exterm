from exterm_trainer.engine.runner import TrainingRunner
from exterm_trainer.protocol.messages import QueueSteerRequest


def test_steering_waits_for_a_safe_point():
    runner = TrainingRunner()
    request = QueueSteerRequest(
        request_id="r1",
        instruction="penalize jerky actions",
        requested_at_timestep=6600,
    )

    response = runner.queue_steering(request)
    assert response.state == "queued"
    assert runner.get_steering_queue()[0].safe_point_timestep is None

    runner.process_safe_point(6700)
    item = runner.get_steering_queue()[0]
    assert item.state == "window_open"
    assert item.safe_point_timestep == 6700
    assert item.safe_point_timestep > item.requested_at_timestep


def test_identical_pending_steering_is_coalesced():
    runner = TrainingRunner()
    request = QueueSteerRequest(request_id="r1", instruction="increase exploration")
    assert runner.queue_steering(request).state == "queued"
    assert runner.queue_steering(request.model_copy(update={"request_id": "r2"})).state == "duplicate"
