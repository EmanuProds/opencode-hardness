# @opencode-hardness/memory-store

Persistent memory and session checkpoints for OpenCode, backed by SQLite with FTS5 full-text search and optional Jev (System One) reranking.

## Install

Add to your `opencode.json`:

```json
{
  "plugins": [
    {
      "package": "file:///home/emanuel/Projects/AI/opencode-hardness/plugins/memory-store",
      "options": {}
    }
  ]
}
```

## Tools

| Tool | Description |
|------|-------------|
| `memory.store` | Store a durable fact with key, value, namespace, tags, confidence. Refuses to overwrite divergent values unless `overwrite=true`. |
| `memory.recall` | Retrieve facts by free-text query (FTS5), namespace, or both. Optional Jev reranking via `MEMORY_RERANK_JEV=1`. |
| `memory.forget` | Delete a stored fact by key and namespace. |
| `memory.checkpoint_save` | Persist a session checkpoint (name, summary, payload). |
| `memory.checkpoint_list` | List checkpoints, newest first. |
| `memory.checkpoint_restore` | Retrieve full checkpoint payload by name. |

## Features

- **SQLite + FTS5**: Full-text search across keys and values with proper MATCH syntax.
- **Conflict handling**: `store` detects divergent values and requires explicit `overwrite=true`.
- **Content hashing**: SHA-256 of values detects actual changes vs idempotent writes.
- **Checkpoints**: Session state persisted as JSON with working directory tracking.
- **Jev reranking** (opt-in): Set `MEMORY_RERANK_JEV=1` and provide `OPENCODE_ZEN_API_KEY` to rerank recall results with TypeSafe's System One model.

## Database

Location: `~/.config/opencode/memory/memory.db`

Tables:
- `memories` — facts with key, value, namespace, tags, confidence, source, timestamps
- `memories_fts` — FTS5 virtual table for full-text search
- `checkpoints` — session checkpoints
- `memory_conflicts` — audit log of overwritten values
- `memory_meta` — schema version tracking (FTS shape + SQLite version)

## Reranker (optional)

```bash
export MEMORY_RERANK_JEV=1
export OPENCODE_ZEN_API_KEY=your_key
```

The reranker is safe: it only reorders, never truncates. A failed/unavailable call degrades to FTS5 order.

## License

MIT