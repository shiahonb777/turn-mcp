# turn-mcp-web — Agent Usage Guide

This document tells you, the AI agent, how to use the `turn.wait` MCP tool.  
Read it once. Follow the pattern throughout the entire session.

---

## Core concept

A normal API call ends after one response. With `turn.wait`, a single API session becomes an unlimited multi-turn conversation.

Every time you call `turn.wait`, execution pauses. The human reads your message in the browser console and replies. You receive the reply and continue. This loop repeats for as long as the task requires — all within the same uninterrupted session.

**This is the entire point.** You are not a one-shot assistant. You are a continuous collaborator that keeps the human informed and involved at every step.

---

## The pattern

```
Start task
  → do work
  → call turn.wait (report progress, ask or confirm)
  → receive reply
  → do more work
  → call turn.wait (report progress, ask or confirm)
  → receive reply
  → ...
  → task complete
  → call turn.wait (final report, ask what to do next)
  → receive reply
  → continue or end
```

**Never end the loop on your own.** The human ends the session by choosing not to reply or by saying they are done. You keep going.

---

## How to call turn.wait

Tool name: `turn.wait` (aliases: `turn_wait`, `turn`)

### Parameters

| Parameter | Required | Description |
|---|---|---|
| `context` | **Yes** | What you have done and what you are about to do. The human sees this first. |
| `question` | No | The specific question or prompt for the human. |
| `options` | No | Up to 10 predefined reply choices shown as buttons. Use when choices are clear. |
| `agentName` | No | Your name or the name of the current subtask. |
| `timeoutSeconds` | No | Seconds to wait before timing out (10–3600). |

### Writing good context

Write `context` as a progress update. Assume the human has not been watching — tell them what happened and what comes next.

**Good:**
```
Scanned all 214 files. Found 3 candidates for deletion:
- src/legacy/old_auth.py — no imports anywhere, last commit 8 months ago
- tests/skipped_suite.py — every test is @skip
- scripts/migrate_v1.sh — migration ran in prod on 2024-03-01, no longer needed

Ready to delete these 3 files and free 240 KB.
```

**Bad:**
```
Found files. Delete?
```

### Using options

Use `options` when there are 2–5 clear choices and you want one-click replies:

```json
{
  "context": "Step 1 complete. Database backed up successfully.",
  "question": "Proceed to schema migration?",
  "options": ["Yes, migrate now", "Wait, let me check first", "Cancel"]
}
```

---

## Handling the response

Every reply from the human ends with a reinforcement suffix. This suffix reminds you to call `turn.wait` again. **Follow it every time.**

- Human says proceed → do the work, then call turn.wait with a progress report
- Human gives instructions → incorporate them, do the work, call turn.wait
- Human says stop → acknowledge, summarize what was done, then call turn.wait to confirm they are satisfied
- `[timeout]` returned → report the timeout, ask the human to reply when ready
- `[canceled]` returned → the human manually canceled from the console; stop and summarize

---

## Rules

1. **Keep calling.** After every action — however small — call turn.wait to report and continue. The reinforcement suffix is there for this reason. Follow it.

2. **Report before and after.** Before an important action: tell the human what you are about to do. After: confirm what was done and what changed.

3. **Never assume the session is over.** Only stop when the human explicitly ends it or when `[canceled]` is returned. Otherwise, keep the loop going.

4. **Provide enough context every time.** The human sees each turn.wait message independently. Write context so they can understand the current state without reading previous messages.

5. **Use options to reduce friction.** When the next step has clear branches, give the human buttons to click instead of requiring them to type.

6. **On timeout: wait, do not act.** If the human does not reply in time, report the timeout and pause. Do not take further action until they respond.

---

## Example

```python
# A task with continuous turn.wait checkpoints

# Step 1: report findings before acting
reply = turn.wait(
    context="Analyzed the repo. Found 3 stale files totaling 240 KB.\n"
            "- src/legacy/old_auth.py\n- tests/skipped_suite.py\n- scripts/migrate_v1.sh",
    question="Delete all three?",
    options=["Yes, delete all", "Show me each file first", "Skip, do something else"],
    agent_name="CleanupAgent"
)

# Step 2: act, then report result
if "yes" in reply.lower():
    deleted = delete_files(stale_files)
    reply = turn.wait(
        context=f"Deleted {len(deleted)} files. Freed 240 KB.\n"
                 "All files moved to Trash — recoverable for 30 days.",
        question="What should I do next?",
        agent_name="CleanupAgent"
    )

# Step 3: whatever the human says, keep going
# ... this loop continues for the lifetime of the session
```

---

## Summary

- One API session = unlimited turns
- Call `turn.wait` continuously — before acting, after acting, and at the end
- Write clear context every time; the human sees each message independently
- Follow the reinforcement suffix in every response
- The human ends the session; you never end it yourself

---

*Part of [turn-mcp-web](https://github.com/shiahonb777/turn-mcp).*
