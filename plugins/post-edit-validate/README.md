# @opencode-hardness/post-edit-validate

Runs the appropriate domain gate command(s) automatically after every file write/edit. If any gate fails, the error is surfaced to the subagent immediately.

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
          "core/": ["cd core && go fmt ./...", "cd core && go vet ./...", "cd core && go build ./..."],
          "interface/web/": ["cd interface/web && npm run build", "cd interface/web && npm run lint"],
          "database/": "cd database/sqlc && sqlc diff && sqlc vet"
        },
        "timeoutMs": 120000,
        "ignorePatterns": ["*.test.ts", "node_modules/", "dist/", "*.md"],
        "cacheTTLMs": 300000,
        "debounceMs": 500
      }
    }
  ]
}
```

## Default Gate Commands

| Domain | Command(s) |
|--------|-----------|
| `contracts/` | `make contracts-lint` |
| `core/` | `cd core && go fmt ./...`, `cd core && go vet ./...`, `cd core && go build ./...` |
| `interface/web/` | `cd interface/web && npm run build`, `cd interface/web && npm run lint` |
| `database/` | `cd database/sqlc && sqlc diff && sqlc vet` |

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `projectRoot` | string | auto-detected | Project root directory |
| `gateCommands` | object | see table | Map of domain prefix to command(s) (string or array) |
| `timeoutMs` | number | 120000 | Default timeout in ms per command |
| `ignorePatterns` | string[] | [] | Glob-like suffix/prefix patterns to skip |
| `cacheTTLMs` | number | 300000 | Content cache TTL in ms per file (0 = disabled) |
| `debounceMs` | number | 0 | Debounce window in ms for rapid edits (0 = disabled) |

## Features

- **Multiple commands per domain**: Execute an ordered list; stop on first failure.
- **Content caching**: SHA-256 hash per file; skip re-execution if content unchanged within TTL.
- **Ignore patterns**: Skip files matching suffix/prefix patterns (e.g., `*.test.ts`, `node_modules/`).
- **Debounce**: Group rapid successive edits into a single gate run.
- **Env var substitution**: `{env:VAR}` in commands is resolved at runtime.
- **Separate stdout/stderr**: Error output keeps stdout and stderr distinct for easier debugging.
- **Delegation integration**: Records gate-pass events in `ctx.storage` for cross-plugin verification.

## Project Root Detection

The plugin auto-detects the project root by searching upward from the edited file for:
- `.git/`
- `package.json`
- `go.mod`
- `Cargo.toml`
- `pyproject.toml`

## Behavior

1. After every `edit`, `write`, or `patch`, determine the file's domain by path prefix.
2. Check ignore patterns; skip if matched.
3. Compute SHA-256 content hash; check cache TTL to skip re-execution.
4. Resolve project root (option or auto-detect via project markers).
5. Run each command in order; stop on first failure.
6. On failure, throw a detailed error with stdout/stderr separated.
7. On success, log and record a gate-pass event for delegation integration.

## License

MIT