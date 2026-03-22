"""
LangChain tool integration example.

Install:
    pip install langchain langchain-openai turn-mcp-client

Run:
    npx turn-mcp-web &
    OPENAI_API_KEY=... python examples/python/langchain_tool.py
"""

import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../python-client'))

from langchain.tools import tool
from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.prompts import ChatPromptTemplate
from turn_mcp_client import TurnMcpClient

_client = TurnMcpClient("http://127.0.0.1:3737")


@tool
def human_checkpoint(context: str, question: str = "") -> str:
    """
    Pause and ask a human for approval or guidance before proceeding.
    Use this whenever you are about to take a consequential or irreversible action.
    Returns the human's reply.
    """
    return _client.wait(
        context=context,
        question=question or None,
        agent_name="LangChainAgent",
    )


def main() -> None:
    llm = ChatOpenAI(model="gpt-4o", temperature=0)
    tools = [human_checkpoint]

    prompt = ChatPromptTemplate.from_messages([
        ("system", (
            "You are a helpful assistant with access to a human_checkpoint tool. "
            "Before taking any significant action, use human_checkpoint to ask for approval."
        )),
        ("human", "{input}"),
        ("placeholder", "{agent_scratchpad}"),
    ])

    agent = create_tool_calling_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

    result = executor.invoke({
        "input": (
            "I need to clean up the database. "
            "There are 500 rows in the `old_sessions` table older than 90 days. "
            "Please check with the human before running the DELETE query."
        )
    })
    print("\nFinal answer:", result["output"])


if __name__ == "__main__":
    main()
