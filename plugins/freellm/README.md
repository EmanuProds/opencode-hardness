# @opencode-hardness/freellm-plugin

OpenCode v2 plugin that discovers models from the local FreeLLMAPI gateway
and publishes them into the OpenCode provider catalog via `ctx.provider.transform`.

Models appear under the `freellm` provider id (e.g. `freellm/auto`, `freellm/gpt-4o`,
`freellm/nemotron-3-super-120b-a12b`, …).

## Install

Add to your `opencode.json`:

```json
{
  "plugins": [
    {
      "package": "@opencode-hardness/freellm-plugin",
      "options": {
        "providerId": "freellm",
        "baseURL": "http://127.0.0.1:31415",
        "apiKey": "{file:~/.config/opencode/secrets/freellm.key}"
      }
    }
  ]
}
```

Or install locally from this repo:

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

## Credentials

Resolved in this order:

1. **Credential connected via OpenCode integration** (`opencode auth` / Connect action)
2. **`apiKey` in the plugin options**
3. **`FREELLM_API_KEY` environment variable**

## Options

| Key | Default | Notes |
|-----|---------|-------|
| `providerId` | `"freellm"` | Provider id; models publish as `<providerId>/<modelId>` |
| `baseURL` | `http://127.0.0.1:31415` | FreeLLMAPI gateway root (no `/v1` suffix needed) |
| `apiKey` | — | API key for `GET /v1/models` |
| `displayName` | `"FreeLLM"` | Provider display name in the model picker |
| `timeoutMs` | `10000` | Per-fetch timeout in ms |
| `modelCacheTtlMs` | `300000` | Catalog cache TTL (5 minutes) |
| `visibleModels` | `[]` | Exact-or-suffix allowlist (`*` = all) |
| `hiddenModels` | `[]` | Exact-or-suffix deny list (deny wins) |
| `providersAllow` | `[]` | Provider id prefix allowlist (empty = all) |
| `usableOnly` | `false` | Filter to healthy/provisioned providers |
| `freeOnly` | `false` | Filter to free-tier models only |
| `toolsOnly` | `false` | Filter to tool-calling models only |
| `visionOnly` | `false` | Filter to vision/image-input models only |

## Behavior

- Does **not** modify `opencode.json`. Uses OpenCode's `provider.transform` /
  `integration.transform` APIs (same pattern as `@omniroute/opencode-plugin-v2`).
- Caches the catalog in memory with a TTL; cold starts are served from the
  in-memory snapshot.
- Calls `ctx.provider.reload()` when the catalog fingerprint changes.
- Models with `available: false` and `unavailable_reason: "no_key"` are marked
  as free-tier (`isFree`) and shown with a `[Free]` prefix.

## License

MIT