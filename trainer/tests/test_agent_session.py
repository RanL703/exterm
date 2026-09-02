import asyncio

from exterm_trainer.agent.session import classify_input, run_session_turn, session_history


def test_session_router_classifies_the_three_cli_intents():
    assert classify_input("penalize hard landings more") == "steering"
    assert classify_input("create a new RL project") == "scaffolding"
    assert classify_input("what is the current mean reward?") == "question"


def test_session_history_survives_multiple_turns():
    session_history.pop("test-session", None)
    async def exercise():
        await run_session_turn("test-session", "penalize hard landings more")
        await run_session_turn("test-session", "penalize hard landings less")

    asyncio.run(exercise())
    assert len(session_history["test-session"]) == 4
