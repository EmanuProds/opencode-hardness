# @opencode-hardness/graphify-navigator

Ensures the Graphify knowledge graph (`graphify-out/graph.json`) is available and up-to-date before and after subagent delegations.

## Install

Add to your `opencode.json`:

```json
{
  "plugins": [
    {
      "package": "file:///home/emanuel/Projects/AI/opencode-hardness/plugins/graphify-navigator",
      "options": {}
    }
  ]
}
```

## Behavior

Three enforcement points:

1. **Pre-delegation check** (`execute.before` on `task`): Before a subagent is spawned, verifies that `graphify-out/graph.json` exists. If missing, logs a warning to run `/graphify`.

2. **Staleness check**: Compares `graph.json` mtime with the latest git commit timestamp. If the graph is older than the latest commit, warns that it needs `/graphify --update`.

3. **Post-delegation reminder** (`execute.after` on `delegation_report`): After a subagent delivers a receipt, reminds the orchestrator to run `/graphify --update` to keep the graph current.

## Notes

- Graphify is an AI skill (not a CLI), so the plugin can only check and warn.
- The actual create/update must be done by the AI invoking `/graphify`.
- The plugin walks up the directory tree to find the repo root (looks for `graphify-out/graph.json` or `.git`).

## License

MIT