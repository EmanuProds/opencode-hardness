# @opencode-hardness/scope-guard

Tool-level gate for OpenCode: enforces directory/extension scopes per agent, concurrency limits, loop detection, and known-tool allowlist.

## Install

Add to your `opencode.json`:

```json
{
  "plugins": [
    {
      "package": "file:///home/emanuel/Projects/AI/opencode-hardness/plugins/scope-guard",
      "options": {}
    }
  ]
}
```

## Enforcement Points (in order of strength)

1. **`ctx.permission.hook("evaluate")`** — Official gate. Denies out-of-scope writes at the host permission level.
2. **`ctx.tool.hook("execute.before")`** — Safety net. Throws before the tool runs if write is out of scope.
3. **`ctx.agent.transform`** — Repairs the host's permission merge order for built-in agents.

## Scope Rules

| Agent | Allowed Directory | Allowed Extensions |
|-------|-------------------|-------------------|
| `orchestrate` | `tmp/plans` | `.md` |
| `review` | `tmp/fix` | `.md` |
| `core-impl` / `core-review` | `core/` | `.go` |
| `web-impl` / `web-review` | `interface/web/` | `.ts`, `.tsx`, `.js`, `.jsx`, `.json`, `.css` |
| `db-impl` / `db-review` | `database/` | `.sql`, `.yaml`, `.yml` |
| `contracts-impl` / `contracts-review` | `contracts/` | `.yaml`, `.yml`, `.md` |

## Concurrency Control

- `orchestrate` can have at most **5 subagents** running concurrently.
- Tracks each launched subagent and frees the slot when `delegation_report` is delivered.
- Stuck slot recovery: if no report for 2 minutes, resets counter.

## Loop Detection

- Max 30 calls of the same tool per minute per session.
- Max 200 total tool calls per minute per session.
- Unknown tools (e.g., "finish") blocked immediately.

## Built-in Agent Policy Repair

Re-applies native policies of built-in agents (build, plan, explore, general, title, summary) after global rules are applied, preventing silent override.

## License

MIT