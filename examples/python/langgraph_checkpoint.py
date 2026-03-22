"""
LangGraph human-in-the-loop checkpoint example.

Instead of using LangGraph's built-in interrupt mechanism (which requires a
checkpointer), this example shows how to integrate turn-mcp-web as a node
in a LangGraph workflow — pausing execution until the human responds.

Install:
    pip install langgraph langchain-openai turn-mcp-client

Run:
    npx turn-mcp-web &
    OPENAI_API_KEY=... python examples/python/langgraph_checkpoint.py
"""

import os
import sys
from typing import TypedDict, Annotated
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../python-client'))

from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from turn_mcp_client import TurnMcpClient, TurnMcpTimeout

_client = TurnMcpClient("http://127.0.0.1:3737")
_llm = ChatOpenAI(model="gpt-4o", temperature=0)


class AgentState(TypedDict):
    task: str
    plan: str
    human_reply: str
    result: str


def plan_node(state: AgentState) -> AgentState:
    """Agent creates an execution plan."""
    response = _llm.invoke(
        f"Create a brief step-by-step plan for: {state['task']}\n"
        "Keep it to 3-5 bullet points."
    )
    return {**state, "plan": response.content}


def approval_node(state: AgentState) -> AgentState:
    """Block execution and wait for human to approve the plan."""
    try:
        reply = _client.wait(
            context=f"Task: {state['task']}\n\nProposed plan:\n{state['plan']}",
            question="Should I proceed with this plan?",
            options=["Yes, proceed", "No, revise the plan", "Cancel"],
            agent_name="PlannerAgent",
            session_id="langgraph-demo",
        )
    except TurnMcpTimeout:
        reply = "[timeout — proceeding with original plan]"

    return {**state, "human_reply": reply}


def execute_node(state: AgentState) -> AgentState:
    """Execute based on human feedback."""
    if "cancel" in state["human_reply"].lower():
        return {**state, "result": "Task canceled by human."}

    response = _llm.invoke(
        f"Task: {state['task']}\nPlan: {state['plan']}\n"
        f"Human feedback: {state['human_reply']}\n\n"
        "Execute the plan and provide a summary of what was done."
    )
    return {**state, "result": response.content}


def build_graph() -> StateGraph:
    graph = StateGraph(AgentState)
    graph.add_node("plan", plan_node)
    graph.add_node("approval", approval_node)
    graph.add_node("execute", execute_node)
    graph.set_entry_point("plan")
    graph.add_edge("plan", "approval")
    graph.add_edge("approval", "execute")
    graph.add_edge("execute", END)
    return graph.compile()


def main() -> None:
    app = build_graph()
    final = app.invoke({
        "task": "Migrate user data from PostgreSQL v12 to v15 in production",
        "plan": "",
        "human_reply": "",
        "result": "",
    })
    print("\n=== Result ===")
    print(final["result"])


if __name__ == "__main__":
    main()
