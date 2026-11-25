# opencode-hardness

OpenCode plugins, configuration, and install scripts for the `opencode-hardness` setup.

## Overview

This repository contains OpenCode v2 plugins (`@opencode/plugin` Promise API), an install script, and an example `opencode.json` configuration. The plugins enforce trustworthy subagent delegation, dynamic model catalog publishing, persistent memory, knowledge-graph hygiene, tool-level scoping, and automatic post-edit validation.

## Plugins

| Plugin | Description |
|--------|-------------|
| [delegation](plugins/delegation/) | Structured receipts and shape validation for subagent delegation |
| [freellm](plugins/freellm/) | Discovers FreeLLMAPI models and publishes them into the OpenCode provider catalog |
| [memory-store](plugins/memory-store/) | SQLite-backed memory and checkpoints with FTS5 search |
| [graphify-navigator](plugins/graphify-navigator/) | Graphify knowledge graph availability and freshness checks |
| [scope-guard](plugins/scope-guard/) | Tool-level gate: directory/extension per agent, concurrency, loop detection |
| [post-edit-validate](plugins/post-edit-validate/) | Domain gate commands after every write/edit |

## Install

```sh
git clone https://github.com/EmanuProds/opencode-hardness.git
cd opencode-hardness
./install.sh
```

The installer copies `plugins/delegation/delegation.ts` to `~/.config/opencode/plugins/delegation.ts` and backs up any existing `~/.config/opencode/opencode.json` before overwriting it.

Other plugins can be added to `opencode.json` manually by referencing their local folder:

```json
{
  "plugins": [
    {
      "package": "file:///home/emanuel/Projects/AI/opencode-hardness/plugins/freellm",
      "options": {
        "providerId": "freellm",
        "baseURL": "http://127.0.0.1:31415"
      }
    }
  ]
}
```

## Testing

```sh
cd plugins/<plugin-name>
node --experimental-strip-types --test <plugin-name>.test.ts
```

## Development

Work on `develop`. Merge selectively to `main` when ready for release. Tag only when requested.

## License

MIT
