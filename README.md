# OpenClaw Thinking Router

Keep routine work on the configured GPT-5.6 route and raise reasoning effort
when a task meets the routing rules. You can override the route for one session.
Approvals and follow-ups reuse the current choice, and automatic routes return
to the base policy after a run.

## Features

- automatic `high`, `max`, and `ultra` routing
- `/route status|auto|high|max|ultra`
- explicit `sol`, `terra`, and `luna` routes
- per-agent base and low-cost policies
- atomic session updates without provider pinning
- fallback disclosure in the final response
- privacy-preserving JSONL audit with hashed identifiers

## Install

```bash
openclaw plugins install git:github.com/Lebmont8/openclaw-thinking-router
```

```json
{
  "plugins": {
    "entries": {
      "thinking-router": {
        "enabled": true,
        "config": {
          "enabledAgents": ["main", "reminder"],
          "lowCostAgents": ["reminder"],
          "baseModel": "gpt-5.6-sol",
          "baseEffort": "high",
          "autoMax": true,
          "autoUltra": true
        }
      }
    }
  }
}
```

Reload OpenClaw through the normal safe path, then use `/route status`.

## Routing policy

Routine work stays on the configured base route. Cohesive high-risk or
cross-system tasks can escalate to `max`. A large task reaches `ultra` only when
it is both complex and decomposable into independent branches. Short approvals
and replies inherit the previous decision.

## Development

```bash
npm run verify
npm pack --dry-run
```

MIT licensed.
