import threading

from exterm_trainer.engine.callbacks import StreamingCallback


def test_callback_stops_at_timestep_budget():
    callback = StreamingCallback("run", 5, lambda _event: None, stop_event=threading.Event(), pause_event=threading.Event())
    callback.num_timesteps = 4
    assert callback._on_step()
    callback.num_timesteps = 5
    assert not callback._on_step()
