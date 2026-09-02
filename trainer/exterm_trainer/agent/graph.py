"""LangGraph agent for training analysis and steering."""
import json
import logging
import time
from typing import Any, Dict, List, Optional, TypedDict

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langchain_ollama import ChatOllama
from langgraph.graph import END, StateGraph

from ..protocol.messages import AgentActionLog, SteeringSuggestion, HyperparamSuggestion

logger = logging.getLogger("exterm.agent")


class AgentState(TypedDict):
    """State for the agent graph."""
    current_code: str
    instruction: str
    env_id: str
    algorithm: str
    telemetry: Optional[Dict[str, Any]]
    reward_history: List[float]
    step_history: List[int]
    
    # Outputs
    analysis: Optional[str]
    steering_suggestions: List[SteeringSuggestion]
    hyperparam_suggestions: List[HyperparamSuggestion]
    new_code: Optional[str]
    diff: Optional[str]
    rationale: Optional[str]
    requires_confirmation: bool
    risk_level: str
    error: Optional[str]


# Initialize LLM
def get_llm() -> ChatOllama:
    """Get configured Ollama LLM."""
    import os
    base_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
    model = os.environ.get("OLLAMA_MODEL", "qwen3.5:9b")
    return ChatOllama(
        base_url=base_url,
        model=model,
        temperature=0.2,
        top_p=0.9,
        timeout=60,
    )


def analyze_training_node(state: AgentState) -> Dict[str, Any]:
    """Analyze training performance and identify issues."""
    llm = get_llm()
    
    telemetry = state.get("telemetry", {})
    reward_history = state.get("reward_history", [])
    step_history = state.get("step_history", [])
    
    if not reward_history or len(reward_history) < 5:
        return {
            "analysis": "Insufficient data for analysis (need at least 5 episodes)",
            "steering_suggestions": [],
            "hyperparam_suggestions": [],
        }
    
    # Calculate trends
    recent_rewards = reward_history[-10:]
    older_rewards = reward_history[-20:-10] if len(reward_history) >= 20 else reward_history[:-10]
    
    recent_mean = sum(recent_rewards) / len(recent_rewards)
    older_mean = sum(older_rewards) / len(older_rewards) if older_rewards else recent_mean
    
    trend = "improving" if recent_mean > older_mean * 1.05 else \
            "degrading" if recent_mean < older_mean * 0.95 else "stable"
    
    # Check volatility
    import statistics
    volatility = statistics.stdev(recent_rewards) if len(recent_rewards) > 1 else 0
    
    issues = []
    if trend == "degrading":
        issues.append("Reward trend is degrading")
    if volatility > recent_mean * 0.5:
        issues.append("High reward volatility - unstable learning")
    if telemetry.get("fps", 0) < 10:
        issues.append("Low training throughput")
    
    system_prompt = """You are an expert RL engineer analyzing training performance.
Given the training metrics, identify specific issues and suggest steering instructions."""
    
    user_prompt = f"""Training Analysis:
- Environment: {state['env_id']}
- Algorithm: {state['algorithm']}
- Progress: {telemetry.get('progress', 0)*100:.1f}%
- Episodes: {telemetry.get('episode_count', 0)}
- Mean Reward (100 ep): {telemetry.get('mean_reward_100', 'N/A')}
- Recent Reward Trend: {trend} (recent: {recent_mean:.2f}, older: {older_mean:.2f})
- Volatility: {volatility:.2f}
- FPS: {telemetry.get('fps', 0)}
- Issues Detected: {issues if issues else 'None'}

Provide a brief analysis and 3 specific steering suggestions with rationale.
Return as JSON with keys: analysis, suggestions (list of {{instruction, rationale, confidence, risk_level}})"""
    
    try:
        response = llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt)
        ])
        
        import json
        result = json.loads(response.content)
        suggestions = [
            SteeringSuggestion(
                instruction=s["instruction"],
                rationale=s["rationale"],
                confidence=s["confidence"],
                risk_level=s["risk_level"]
            )
            for s in result.get("suggestions", [])
        ]
        
        return {
            "analysis": result.get("analysis", "Analysis complete"),
            "steering_suggestions": suggestions,
            "hyperparam_suggestions": [],
        }
    except Exception as e:
        logger.warning(f"LLM analysis failed: {e}")
        # Fallback suggestions based on heuristics
        suggestions = []
        if trend == "degrading":
            suggestions.append(SteeringSuggestion(
                instruction="increase exploration",
                rationale="Reward degrading - need more exploration",
                confidence=0.7,
                risk_level="low"
            ))
        if volatility > recent_mean * 0.5:
            suggestions.append(SteeringSuggestion(
                instruction="penalize jerky movements",
                rationale="High volatility - encourage smoother actions",
                confidence=0.7,
                risk_level="low"
            ))
        if not suggestions:
            suggestions.append(SteeringSuggestion(
                instruction="reward longer episodes",
                rationale="Encourage episode length for stable learning",
                confidence=0.5,
                risk_level="low"
            ))
        
        return {
            "analysis": f"Trend: {trend}, Volatility: {volatility:.2f}, Issues: {issues}",
            "steering_suggestions": suggestions,
            "hyperparam_suggestions": [],
        }


def generate_steering_node(state: AgentState) -> Dict[str, Any]:
    """Generate reward code modification from steering instruction."""
    llm = get_llm()
    
    system_prompt = f"""You are an expert RL engineer. Modify a reward shaping wrapper for Gymnasium.

Environment: {state['env_id']}
Algorithm: {state['algorithm']}

The reward.py contains a `RewardShapingWrapper` class with `reward_fn` method taking:
- obs: np.ndarray
- action: int or np.ndarray
- original_reward: float
- terminated: bool
- truncated: bool
- info: dict

Modify ONLY the reward_fn method body to implement the instruction.
Rules:
1. Only modify reward calculation logic
2. No imports, class changes, method signature changes
3. No observation_space, action_space, gym.make modifications
4. Use numpy (np) for math
5. Return JSON only with keys `reward_fn`, `rationale`, `risk_tier`, and optional `hyperparameters`.
6. Use `auto` for reward-only edits and `confirm` for observation/action shape, wrapper, import, or training-loop changes.

Current reward_fn body:
```python
# ----- Edit below this line -----
return original_reward
# --------------------------------
```"""
    
    user_prompt = f"Steering instruction: {state['instruction']}\n\nModify reward_fn to implement this."
    
    try:
        response = llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt)
        ])
        
        structured = extract_steering_response(response.content)
        new_reward_fn = structured["reward_fn"]
        new_code = replace_reward_fn_in_code(state["current_code"], new_reward_fn)
        diff = generate_diff(state["current_code"], new_code)
        requires_confirmation = structured["risk_tier"] == "confirm" or is_risky_change(state["current_code"], new_code)
        
        return {
            "new_code": new_code,
            "diff": diff,
            "rationale": structured["rationale"],
            "requires_confirmation": requires_confirmation,
            "risk_level": "high" if requires_confirmation else "low",
            "error": None,
        }
    except Exception as e:
        logger.warning(f"LLM steering failed, using fallback: {e}")
        new_code = apply_fallback_steering(state["current_code"], state["instruction"])
        diff = generate_diff(state["current_code"], new_code)
        return {
            "new_code": new_code,
            "diff": diff,
            "rationale": "Fallback reward edit generated because the configured LLM response could not be parsed.",
            "requires_confirmation": is_risky_change(state["current_code"], new_code),
            "risk_level": "low",
            "error": str(e),
        }


def suggest_hyperparams_node(state: AgentState) -> Dict[str, Any]:
    """Suggest hyperparameter adjustments based on training state."""
    llm = get_llm()
    
    telemetry = state.get("telemetry", {})
    reward_history = state.get("reward_history", [])
    
    if not reward_history or len(reward_history) < 10:
        return {"hyperparam_suggestions": []}
    
    system_prompt = """You are an RL expert. Given training metrics, suggest hyperparameter changes.
Return JSON with key: suggestions (list of {{param, current_value, suggested_value, rationale}})."""
    
    user_prompt = f"""Training State:
- Algorithm: {state['algorithm']}
- Mean Reward: {telemetry.get('mean_reward_100', 'N/A')}
- Recent Trend: {sum(reward_history[-10:])/10:.2f} vs {sum(reward_history[-20:-10])/10:.2f if len(reward_history) >= 20 else 'N/A'}
- Progress: {telemetry.get('progress', 0)*100:.1f}%

Suggest hyperparameter adjustments for {state['algorithm']}."""
    
    try:
        response = llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt)
        ])
        
        import json
        result = json.loads(response.content)
        suggestions = [
            HyperparamSuggestion(
                param=s["param"],
                current_value=s["current_value"],
                suggested_value=s["suggested_value"],
                rationale=s["rationale"]
            )
            for s in result.get("suggestions", [])
        ]
        return {"hyperparam_suggestions": suggestions}
    except Exception as e:
        logger.warning(f"Hyperparam suggestion failed: {e}")
        return {"hyperparam_suggestions": []}


def log_action_node(state: AgentState) -> Dict[str, Any]:
    """Log agent action to audit trail."""
    from ..server import log_agent_action
    log_agent_action(AgentActionLog(
        timestamp=time.time(),
        action_type="analyze" if state.get("telemetry") else "steer",
        instruction=state.get("instruction"),
        applied=not state.get("requires_confirmation", True),
        requires_confirmation=state.get("requires_confirmation", False),
        checkpoint_id=None,
        diff=state.get("diff"),
        metadata={
            "env_id": state["env_id"],
            "algorithm": state["algorithm"],
            "risk_level": state.get("risk_level", "unknown"),
        }
    ))
    return {}


# Helper functions
def extract_reward_fn_from_response(response: str) -> str:
    import re
    code_blocks = re.findall(r'```python\n(.*?)\n```', response, re.DOTALL)
    if code_blocks:
        return code_blocks[0].strip()
    code_blocks = re.findall(r'```\n(.*?)\n```', response, re.DOTALL)
    if code_blocks:
        return code_blocks[0].strip()
    return response.strip()


def extract_steering_response(response: str) -> Dict[str, Any]:
    """Parse constrained JSON while retaining compatibility with old code-block responses."""
    candidate = response.strip()
    if candidate.startswith("```"):
        candidate = candidate.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    try:
        payload = json.loads(candidate)
        reward_fn = payload.get("reward_fn") or payload.get("code")
        risk_tier = payload.get("risk_tier", "auto")
        if not isinstance(reward_fn, str) or not reward_fn.strip():
            raise ValueError("missing reward_fn")
        if risk_tier not in {"auto", "confirm"}:
            raise ValueError("risk_tier must be auto or confirm")
        return {
            "reward_fn": reward_fn.strip(),
            "rationale": str(payload.get("rationale", "No rationale provided.")),
            "risk_tier": risk_tier,
            "hyperparameters": payload.get("hyperparameters", {}),
        }
    except (ValueError, json.JSONDecodeError):
        return {
            "reward_fn": extract_reward_fn_from_response(response),
            "rationale": "Legacy code response; restricted to the reward function body.",
            "risk_tier": "auto",
            "hyperparameters": {},
        }


def replace_reward_fn_in_code(code: str, new_reward_fn: str) -> str:
    lines = code.split('\n')
    in_reward_fn = False
    found_marker = False
    result_lines = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if 'def reward_fn' in line:
            in_reward_fn = True
            result_lines.append(line)
            i += 1
            continue
        if in_reward_fn and '# ----- Edit below this line -----' in line:
            found_marker = True
            result_lines.append(line)
            for new_line in new_reward_fn.split('\n'):
                result_lines.append('        ' + new_line)
            while i < len(lines) and '# --------------------------------' not in lines[i]:
                i += 1
            if i < len(lines):
                result_lines.append(lines[i])
            in_reward_fn = False
            i += 1
            continue
        if not in_reward_fn or not found_marker:
            result_lines.append(line)
        i += 1
    return '\n'.join(result_lines)


def generate_diff(old_code: str, new_code: str) -> str:
    import difflib
    old_lines = old_code.splitlines(keepends=True)
    new_lines = new_code.splitlines(keepends=True)
    diff = difflib.unified_diff(old_lines, new_lines, lineterm='')
    return '\n'.join(diff)


def is_risky_change(old_code: str, new_code: str) -> bool:
    risky_patterns = [
        'import', 'class ', 'def make_env', 'def step', 'def reset',
        'observation_space', 'action_space', 'gym.make', 'Wrapper',
    ]
    for pattern in risky_patterns:
        if pattern in new_code and pattern not in old_code:
            return True
        if pattern in old_code and pattern not in new_code:
            return True
    return False


def apply_fallback_steering(code: str, instruction: str) -> str:
    lines = code.split('\n')
    modified = False
    for i, line in enumerate(lines):
        if 'return original_reward' in line and not modified:
            instr = instruction.lower()
            if 'penalize' in instr and 'jerk' in instr:
                lines[i] = line.replace('return original_reward',
                    'return original_reward - 0.1 * np.sum(np.square(action))  # penalize jerky actions')
                modified = True
            elif 'cautious' in instr or 'safe' in instr:
                lines[i] = line.replace('return original_reward',
                    'return original_reward - 0.05 * np.sum(np.square(action))  # cautious: penalize large actions')
                modified = True
            elif 'reward' in instr and 'long' in instr:
                lines[i] = line.replace('return original_reward',
                    'return original_reward + 0.01 * (1.0 - terminated)  # reward longer episodes')
                modified = True
            elif 'explore' in instr:
                lines[i] = line.replace('return original_reward',
                    'return original_reward + 0.001 * np.random.randn()  # encourage exploration')
                modified = True
    if not modified:
        for i, line in enumerate(lines):
            if 'return original_reward' in line:
                lines[i] = line + f'  # steering: {instruction}'
                break
    return '\n'.join(lines)


# Build the graph
def create_agent_graph() -> StateGraph:
    """Create the LangGraph agent for training analysis and steering."""
    graph = StateGraph(AgentState)
    
    # Add nodes
    graph.add_node("analyze", analyze_training_node)
    graph.add_node("generate_steering", generate_steering_node)
    graph.add_node("suggest_hyperparams", suggest_hyperparams_node)
    graph.add_node("log_action", log_action_node)
    
    # Define edges
    graph.add_edge("analyze", "generate_steering")
    graph.add_edge("generate_steering", "suggest_hyperparams")
    graph.add_edge("suggest_hyperparams", "log_action")
    graph.add_edge("log_action", END)
    
    # Set entry point
    graph.set_entry_point("analyze")
    
    return graph.compile()


# Create compiled graph instance
agent_graph = create_agent_graph()


async def run_analysis(current_code: str, env_id: str, algorithm: str, 
                       telemetry: Dict[str, Any], reward_history: List[float],
                       step_history: List[int]) -> Dict[str, Any]:
    """Run training analysis and get steering suggestions."""
    initial_state = AgentState(
        current_code=current_code,
        instruction="",
        env_id=env_id,
        algorithm=algorithm,
        telemetry=telemetry,
        reward_history=reward_history,
        step_history=step_history,
    )
    result = await agent_graph.ainvoke(initial_state)
    return {
        "analysis": result.get("analysis"),
        "steering_suggestions": result.get("steering_suggestions", []),
        "hyperparam_suggestions": result.get("hyperparam_suggestions", []),
    }


async def run_steering(current_code: str, instruction: str, env_id: str, algorithm: str) -> Dict[str, Any]:
    """Run steering code generation."""
    initial_state = AgentState(
        current_code=current_code,
        instruction=instruction,
        env_id=env_id,
        algorithm=algorithm,
        telemetry=None,
        reward_history=[],
        step_history=[],
    )
    result = await agent_graph.ainvoke(initial_state)
    return {
        "new_code": result.get("new_code"),
        "diff": result.get("diff"),
        "requires_confirmation": result.get("requires_confirmation", False),
        "risk_level": result.get("risk_level", "low"),
        "error": result.get("error"),
    }
