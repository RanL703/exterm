"""Stateful LangGraph router for the interactive CLI."""
import json
import uuid
from typing import Any, Dict, List, Literal, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.graph import END, START, StateGraph

from .graph import get_llm
from ..protocol.messages import QueueSteerRequest


class SessionState(TypedDict):
    session_id: str
    input: str
    route: str
    response: str
    model: str
    history: List[Dict[str, str]]


def classify_input(text: str) -> Literal["steering", "scaffolding", "question"]:
    value = text.lower()
    if value.startswith(("what ", "how ", "why ", "when ", "where ", "show ", "is ", "are ")) or value.endswith("?"):
        return "question"
    if any(word in value for word in ("steer", "reward", "penalize", "landing", "explor", "hyperparameter", "learning rate")):
        return "steering"
    if any(phrase in value for phrase in ("create a project", "scaffold", "new rl project", "initialize a project")):
        return "scaffolding"
    return "question"


def build_session_graph():
    graph = StateGraph(SessionState)
    graph.add_node("classify", lambda state: {"route": classify_input(state["input"])})
    graph.add_node("steering", steering_node)
    graph.add_node("scaffolding", lambda _state: {"response": "Use `/init` to scaffold a project, then return here to train and steer it."})
    graph.add_node("question", question_node)
    graph.add_conditional_edges("classify", lambda state: state["route"], ["steering", "scaffolding", "question"])
    graph.add_edge(START, "classify")
    graph.add_edge("steering", END)
    graph.add_edge("scaffolding", END)
    graph.add_edge("question", END)
    return graph.compile()


def steering_node(state: SessionState) -> Dict[str, str]:
    from ..server import runner, validate_instruction

    status = runner.get_status()
    if status.state.value not in {"training", "paused", "starting"}:
        return {"response": "No active training run. Start one with `/train` before sending runtime steering."}
    valid, error = validate_instruction(state["input"])
    if not valid:
        return {"response": f"Steering rejected: {error}"}
    request_id = str(uuid.uuid4())[:8]
    requested_at = status.timesteps
    response = runner.queue_steering(QueueSteerRequest(request_id=request_id, instruction=state["input"], requested_at_timestep=requested_at))
    return {"response": f"Steering queued · request {response.request_id} · position {response.queue_position or 'ready'}"}


def question_node(state: SessionState) -> Dict[str, str]:
    from ..server import runner

    status = runner.get_status()
    prompt = f"Current exterm run status: {status.model_dump()}\nConversation: {state['history'][-6:]}\nQuestion: {state['input']}"
    try:
        return {"response": run_tool_agent(state["model"], prompt)}
    except Exception as error:
        return {"response": f"Agent question handling is unavailable: {error}. Current run: {status.state.value} at {status.timesteps}/{status.total_timesteps} steps."}


def run_tool_agent(model: str, prompt: str) -> str:
    from ..server import runner

    @tool
    def trainer_status() -> dict:
        """Read current trainer state and metrics."""
        return runner.get_status().model_dump(mode="json")

    @tool
    def trainer_control(action: Literal["pause", "resume", "stop", "checkpoint"]) -> dict:
        """Control the current run or create a checkpoint."""
        if action == "pause": runner.pause()
        elif action == "resume": runner.resume()
        elif action == "stop": runner.stop()
        else: return runner.save_checkpoint().model_dump(mode="json")
        return runner.get_status().model_dump(mode="json")

    @tool
    def trainer_rollback(checkpoint_id: str) -> dict:
        """Restore code and model weights from a checkpoint."""
        return runner.load_checkpoint(checkpoint_id).model_dump(mode="json")

    tools = [trainer_status, trainer_control, trainer_rollback]
    tool_map = {item.name: item for item in tools}
    messages = [
        SystemMessage(content="You are exterm, an RL training assistant. Use tools for trainer facts and mutations. Never claim an action succeeded unless its tool returned success. Runtime reward changes must use /steer or the steering route; do not invent file edits."),
        HumanMessage(content=prompt),
    ]
    model_with_tools = get_llm(model).bind_tools(tools)
    for _ in range(6):
        response = model_with_tools.invoke(messages)
        messages.append(response)
        if not response.tool_calls:
            return str(response.content or "Agent completed without a response.")
        for call in response.tool_calls:
            selected = tool_map.get(call["name"])
            if selected is None:
                result = {"ok": False, "error": f"unknown tool: {call['name']}"}
            else:
                try:
                    result = selected.invoke(call.get("args", {}))
                except Exception as error:
                    result = {"ok": False, "error": str(error)}
            messages.append(ToolMessage(content=json.dumps(result), tool_call_id=call["id"]))
    return "Agent reached the tool-turn limit before completing the request."


session_graph = build_session_graph()
session_history: Dict[str, List[Dict[str, str]]] = {}


async def run_session_turn(session_id: str, text: str, model: str = "") -> Dict[str, Any]:
    history = session_history.setdefault(session_id, [])
    result = session_graph.invoke({"session_id": session_id, "input": text, "route": "", "response": "", "history": history, "model": model})
    response = str(result["response"])
    history.extend([{"role": "user", "content": text}, {"role": "assistant", "content": response}])
    return {"session_id": session_id, "route": result["route"], "message": response}
