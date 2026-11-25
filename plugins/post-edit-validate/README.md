# @opencode-hardness/post-edit-validate

Runs the appropriate domain gate command (build, lint, vet) automatically after every file write/edit. If the gate fails, the error is surfaced to the subagent immediately.

## Install

Add to your `opencode.json`:

```json
{
  "plugins": [
    {
      "package": "file:///home/emanuel/Projects/AI/opencode-hardness/plugins/post-edit-validate",
      "options": {
        "projectRoot": "/path/to/project",
        "gateCommands": {
          "contracts/": "make contracts-lint",
          "core/": "cd core && go build ./... && go vet ./...",
          "interface/web/": "cd interface/web && npm run build && npm run lint",
          "database/": "cd database/sqlc && sqlc diff && sqlc vet"
        }
      }
    }
  ]
}
```

## Default Gate Commands

| Domain | Command |
|--------|---------|
| `contracts/` | `make contracts-lint` |
| `core/` | `cd core && go build ./... && go vet ./...` |
| `interface/web/` | `cd interface/web && npm run build && npm run lint` |
| `database/` | `cd database/sqlc && sqlc diff && sqlc vet` |

## Options

| Option | Type | Description |
|--------|------|-------------|
| `projectRoot` | string | Project root directory (auto-detected via `.git/`, `package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml` if not provided) |
| `gateCommands` | object | Override default gate commands per domain prefix |

## Behavior

1. After every `edit`, `write`, or `patch`, determines the file's domain by path prefix
2. Finds the project root (uses `projectRoot` option, or auto-detects via project markers)
3. Runs the corresponding gate command in the project root
4. On failure, throws an error that surfaces to the subagent — they must fix before continuing

## Project Root Detection

The plugin auto-detects the project root by searching upward from the edited file for:
- `.git/`
- `package.json`
- `go.mod`
- `Cargo.toml`
- `pyproject.toml`

## License

MIT