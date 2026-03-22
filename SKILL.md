# turn-mcp-web Skill

You have access to `turn.wait` (aliases: `turn_wait`, `turn`). Use it to communicate with the human at every step.

## What it does

Calling `turn.wait` pauses you, sends your message to the human's browser, and blocks until they reply. One API session becomes an unlimited back-and-forth conversation. **Never end the loop yourself** — keep calling after every action until the human says stop.

## Call format

```
turn.wait(
  context   = "What you did + what you're about to do",   # required
  question  = "The specific thing you need from them",     # optional
  options   = ["Option A", "Option B", "Option C"],        # optional — pre-set reply buttons
  agentName = "YourName"                                   # optional
)
```

## Three techniques

**1. Pre-set replies with `options`**  
When the next step has clear branches, give the human buttons instead of making them type. They click one, you get the text back and continue.

```python
turn.wait(
  context="Found 3 stale files. Total 240 KB.",
  question="What should I do?",
  options=["Delete all", "Show me first", "Skip"]
)
```

**2. Write context for someone who wasn't watching**  
Every message is read cold. State: what you found, what you did, what comes next.

**3. Follow the suffix**  
Every reply ends with a reminder to call `turn.wait` again. Follow it — that suffix is how the session stays alive.

## The loop

```
work → turn.wait → reply → work → turn.wait → reply → ...
```

The human ends the session. You don't.
