# turn-mcp-web — Agent Usage Guide

This document tells you, the AI agent, how to use the `turn.wait` MCP tool correctly.  
Read it once, follow the rules throughout the entire task.

---

## What turn.wait does

`turn.wait` pauses your execution and sends a message to the human operator's browser console.  
You block until the human replies. When they reply, you receive their message and continue.

This is a **mandatory human-in-the-loop checkpoint**. Use it to get approval, clarification, or guidance before taking actions the human needs to review.

---

## When to call turn.wait

**Always call before:**
- Deleting, overwriting, or moving files or data
- Running database migrations or schema changes
- Deploying to any environment (staging or production)
- Making API calls with side effects (payments, emails, webhooks)
- Taking any action that is irreversible or hard to undo
- Committing and pushing code on behalf of the user

**Call when:**
- Multiple valid approaches exist and you need the human to choose
- You encounter ambiguity that cannot be resolved from context alone
- A subtask is complete and the human should review before you proceed to the next
- You are about to start a long autonomous task — confirm scope first
- The task is complete — report results and ask if anything else is needed

**Do not call when:**
- You are asking something you can infer from the conversation or context
- The action is trivially reversible (e.g., reading a file, analyzing code)
- You would be asking the same question you already asked in the same session

---

## How to call turn.wait

Tool name: `turn.wait` (aliases: `turn_wait`, `turn`)

### Parameters

| Parameter | Required | Description |
|---|---|---|
| `context` | **Yes** | What you have done so far and what you are about to do. Be specific and concise. |
| `question` | No | The specific question you need answered. If omitted, the human sees only context. |
| `options` | No | Array of up to 10 predefined reply choices shown as buttons. Use when there are 2–5 clear options. |
| `agentName` | No | Your name or the name of this subtask. Helps the human identify who is asking. |
| `timeoutSeconds` | No | How long to wait before timing out (10–3600). Default is set by the server. |

### Writing good context

The `context` field is what the human sees first. Write it so the human can make an informed decision without needing to ask follow-up questions.

**Good context:**
```
Completed code analysis. Found 3 unused files:
- src/legacy/old_auth.py — last commit 8 months ago, no imports found
- tests/skipped_suite.py — all 12 tests marked @skip
- scripts/migrate_v1.sh — migration already ran in prod on 2024-03-01

About to permanently delete these 3 files.
```

**Bad context:**
```
Found some files to delete. Should I proceed?
```

### Using options

Use `options` when there are a small number of clear choices:

```json
{
  "context": "...",
  "question": "Which environment should I deploy to first?",
  "options": ["staging", "production", "both", "cancel"]
}
```

Do not use options for open-ended questions where the human needs to type a free answer.

---

## Handling the response

When the human replies, you receive their message with a reinforcement suffix appended.  
The suffix reminds you to call `turn.wait` again at the next checkpoint — follow it.

- If the human says **proceed / yes / confirm** → continue with the action
- If the human says **cancel / stop / no** → abort and explain what you did not do
- If the human gives instructions or corrections → incorporate them and continue
- If `[timeout]` is returned → the human did not respond; do not proceed with irreversible actions, report the timeout and wait for the next instruction
- If `[canceled]` is returned → the human canceled; stop the current task

---

## Rules

1. **One checkpoint per major decision point.** Do not batch unrelated questions across one call; call once per decision point, not once for the entire task.

2. **Call turn.wait again after you act.** After completing a step, call turn.wait to report progress and confirm next steps before continuing.

3. **Provide enough context to decide.** The human cannot see your reasoning. Tell them: what you found, what you are about to do, and what the risk or impact is.

4. **Respect the reinforcement suffix.** After the human replies, the suffix at the end of their message reminds you to keep calling turn.wait. Do not ignore it.

5. **Never end a session silently.** When the task is complete, call turn.wait one final time to report the outcome and ask if anything else is needed.

6. **Do not loop on timeouts.** If turn.wait times out, do not retry automatically. Report the timeout and pause.

---

## Anti-patterns

| Pattern | Problem | Fix |
|---|---|---|
| Call turn.wait once at the start, never again | Human loses visibility after first checkpoint | Call at each major step |
| Asking "Should I continue?" with no context | Human cannot make an informed decision | Describe exactly what you are about to do and why |
| Calling turn.wait for every minor action | Interrupts the human too frequently | Group related actions; checkpoint before consequential steps only |
| Proceeding after a timeout | Takes action without human approval | Halt and notify |
| Ending the session without final report | Human doesn't know what was done | Always close with a summary call |

---

## Minimal example

```python
# Python pseudocode showing correct checkpoint usage

result = analyze_codebase()

# Checkpoint 1: before taking action
reply = turn.wait(
    context=f"Analysis complete. Found {len(result.deletable)} files safe to delete:\n{result.summary}",
    question="Confirm deletion?",
    options=["Yes, delete", "No, skip", "Show full list first"],
    agent_name="CleanupAgent"
)

if "yes" in reply.lower():
    deleted = delete_files(result.deletable)
    
    # Checkpoint 2: after action, before finishing
    turn.wait(
        context=f"Deleted {len(deleted)} files. Freed {deleted.size_mb:.1f} MB.\nAll changes are in the trash, restorable within 30 days.",
        question="Task complete. Anything else?",
        agent_name="CleanupAgent"
    )
```

---

## Summary

- `turn.wait` is how you communicate with the human during a task
- Call it **before** irreversible actions, **after** completing steps, and **at the end** of the task
- Write `context` as if the human has no other information — they probably don't
- Follow the reinforcement suffix in every response
- When in doubt, checkpoint

---

*This document is part of [turn-mcp-web](https://github.com/shiahonb777/turn-mcp).*
