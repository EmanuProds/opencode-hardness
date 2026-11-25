# opencode-hardness — AGENTS.md

This repository holds OpenCode plugins, configuration, and install scripts for the `opencode-hardness` setup.

## Repository structure

```
plugins/
  delegation/          — Delegation protocol: structured receipts and shape validation
  freellm/             — FreeLLMAPI model catalog publisher (provider.transform)
  memory-store/        — Persistent memory and session checkpoints (SQLite + FTS5)
  graphify-navigator/  — Graphify knowledge graph hygiene checks
  scope-guard/         — Tool-level gate: scope per agent, concurrency, loop detection
  post-edit-validate/  — Domain gate commands after every write/edit
  lib/                 — Shared libraries (jev-client.ts)
install.sh             — Shell installer: copies plugin and backs up opencode.json
opencode.json          — OpenCode configuration (example)
```

## Plugins

| Plugin | Purpose |
|--------|---------|
| `delegation` | Receipt protocol for subagent delegation; enforces artifact shape and gate output before trust |
| `freellm` | Discovers models from local FreeLLMAPI gateway and publishes them into the OpenCode provider catalog |
| `memory-store` | Durable facts and session checkpoints in SQLite with FTS5 search and optional Jev reranking |
| `graphify-navigator` | Warns if `graphify-out/graph.json` is missing or stale before/after delegation |
| `scope-guard` | Directory/extension scope per agent, concurrency limit (5 subagents), loop detection, known-tool allowlist |
| `post-edit-validate` | Runs domain gate commands (build/lint/vet) automatically after every write/edit |

## Conventions

- **Code** (variables, functions, classes, types, files, configs): English
- **Code comments**: English — explain _why_, not _what_
- **Internal technical docs** (this file, ADRs, dev READMEs): English
- **Commits**: English, title only, single line, no body, with user confirmation
- **PRs / issues**: English, conventional

## No versions

This repository intentionally does not use version numbers in code, `package.json`, commit messages, or tags. Versions are managed externally via git tags only when requested.

## Installing

Run the shell installer from the repo root:

```sh
./install.sh
```

This copies `plugins/delegation/delegation.ts` to `~/.config/opencode/plugins/delegation.ts` and backs up any existing `~/.config/opencode/opencode.json` before overwriting it with `opencode.json` from this repo.

## Testing

Each plugin folder contains a `*.test.ts` file. Run tests with:

```sh
cd plugins/<plugin-name>
node --experimental-strip-types --test <plugin-name>.test.ts
```

Some plugins also include integration tests (e.g. `freellm.integration.test.ts`) that call the local FreeLLMAPI gateway at `http://127.0.0.1:31415/v1/models`.

## Development flow

1. Work on the `develop` branch.
2. When a change is ready for release, merge selectively from `develop` to `main`.
3. Tag the release commit on `main` only when requested.

## Security

- Never commit secrets, tokens, or API keys.
- The FreeLLMAPI key lives in `~/.config/opencode/secrets/freellm.key` and is referenced via `{file:...}` in `opencode.json`, never written in plain text.
