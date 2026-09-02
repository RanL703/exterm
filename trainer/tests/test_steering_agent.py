from exterm_trainer.agent.graph import extract_steering_response


def test_structured_steering_response_preserves_rationale_and_risk():
    result = extract_steering_response('{"reward_fn":"return original_reward - 1.0","rationale":"discourage hard landings","risk_tier":"auto"}')
    assert result["reward_fn"] == "return original_reward - 1.0"
    assert result["rationale"] == "discourage hard landings"
    assert result["risk_tier"] == "auto"


def test_legacy_code_block_response_remains_supported():
    result = extract_steering_response("```python\nreturn original_reward + 1.0\n```")
    assert result["reward_fn"] == "return original_reward + 1.0"
    assert result["risk_tier"] == "auto"
