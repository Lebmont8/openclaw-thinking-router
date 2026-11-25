# OpenClaw Thinking Router

An OpenClaw plugin that selects GPT-5.6 reasoning effort from task complexity,
supports per-session manual routes, inherits the route for approvals and
follow-ups, and returns automatic sessions to their base policy after a run.

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

## Verification scope

GitHub Actions runs the existing network-free checks on Node.js 22 and 24. These tests do not log into a provider, restart a Gateway, or prove compatibility with every OpenClaw release. Verify your installed runtime API before deployment; model identifiers in configuration examples must exist in your own account.
