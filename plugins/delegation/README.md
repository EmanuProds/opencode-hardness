# opencode-hardness / plugins / delegation

Versioned copy of the `delegation` plugin for OpenCode.

## Files

| File | Purpose |
|------|---------|
| `delegation.ts` | Current version (v1.1.0), with improvements applied |
| `delegation.original.ts` | Original copy from `~/.config/opencode/plugins/delegation.ts` |
| `README.md` | This document |

## 1. What the plugin does (validation)

**Problem it solves.** OpenCode's host `outcome` field reports `"succeeded"` even when a subagent exhausted its step budget, and there is no API for the host to write a trustworthy outcome. So the receipt cannot come from the host — it must come from the subagent, through a tool.

**Contract.** Three tools under the `delegation` namespace:

| Tool | Role |
|------|------|
| `delegation_spec` | Orchestrator declares the shape the artifact must have *before* delegating: required identifiers, allowed files, gate command, graphify context map, note, TTL. Stored under `spec:{sessionID}`. |
| `delegation_report` | Subagent delivers a structured receipt: objective, files changed, gate command, raw gate output, criteria (verdict + evidence), blocked items, notes, agent, timestamp. Stored under `report:{sessionID}`. |
| `delegation_receipt` | Orchestrator reads a previously delivered receipt by session ID. |

**Enforcement hooks (4):**

1. **Shape check** (`execute.after` on write tools). When a child session writes a file, the plugin verifies the file contains every `required` identifier declared by the parent's spec. If any are missing, the write is blocked. This prevents "field approximation" — a rule with no field to hold its fact cannot pass by substituting a nearby field.
2. **Review trigger** (`execute.after` on completed reports). When a `code`/`database`/`contracts` subagent delivers a receipt, a warning log reminds the orchestrator to run the `review` subagent before considering the task complete.
3. **Mandatory review** (`execute.before` on `subagent`). While `review-pending` is set for an `orchestrate` session, it may only delegate to `review`. Delegating to `code`/`database`/`contracts` sets the flag; delegating to `review` clears it.
4. **Receipt validation** (`execute.before` on `report`). Before accepting a receipt, the plugin checks: spec not expired, `filesChanged ⊆ allowedFiles`, `gateCommand` matches the spec exactly, `gateOutput` is non-empty, and `criteria` is non-empty.

**Storage.** Uses `ctx.storage` (key-value JSON), namespaced per session ID (`spec:`, `report:`, `review-pending:`).

**Config wiring (from `~/.config/opencode/opencode.json`).** Permissions `delegation_spec`, `delegation_report`, `delegation_receipt` are all `allow` on `*`.

## 2. Strengths

- Trustworthy receipt independent of the host's unreliable `outcome`.
- Shape check blocks field substitution / approximation.
- Mandatory four-eyes review after implementation subagents.
- Receipt validated against the spec at delivery time (files, gate command, output, criteria).
- Session-scoped storage isolates delegations.
- Explicit protocol with required fields (`objective`, `gateCommand`, `gateOutput`, `criteria`).

## 3. Weaknesses / limitations observed

1. **No cross-file required-identifier check.** Each written file is checked against the parent spec in isolation. If the spec requires identifiers A and B, and the subagent writes A in file X and B in file Y, neither file alone fails — but the artifact as a whole is incomplete.
2. **No integrity binding of changed files.** `filesChanged` is self-declared; there is no hash/checksum proving the listed files were actually written or that they match what was checked.
3. **Spec is single-slot per session.** Calling `delegation_spec` overwrites the previous spec; there is no support for multiple concurrent subdelegations with different shapes.
4. **No TTL in the original.** Specs and reports persist indefinitely in `ctx.storage` (the v1.1.0 copy adds a `ttlMs` defaulting to 24h).
5. **Review trigger is a log, not a block.** The `execute.after` hook only logs a warning; the real enforcement is the separate `execute.before` hook. If the orchestrator ignores the warning and completes anyway, nothing stops it (other than host-level behavior).
6. **No protocol versioning** in the original receipt/spec (added in v1.1.0).
7. **No graphify integration.** `contextMap` is stored but never validated against `graphify-out/graph.json`.
8. **No tests.** No unit/integration test suite for the plugin exists in the repo.
9. **Agent identity trust.** `receipt.agent` comes from `context.agent`, which is not cryptographically bound to the subagent session.

## 4. Suggested improvements (applied in v1.1.0 where marked)

| # | Improvement | Status in v1.1.0 | Rationale |
|---|-------------|------------------|-----------|
| 1 | Protocol version field (`protocolVersion`) in receipt | ✅ Added | Lets the orchestrator reject receipts from older/newer protocol versions. |
| 2 | TTL/expiration for specs (default 24h) | ✅ Added | Prevents stale specs from being reused across unrelated delegations. |
| 3 | Expired-spec rejection in `delegation_report` | ✅ Added | Forces re-declaration of shape when a spec has lapsed. |
| 4 | `parentSessionID` on receipt | ✅ Added | Traceability from receipt back to the delegating session. |
| 5 | SHA-256 file hashes (`fileHashes`) on receipt | ⬜ Not yet | Bind `filesChanged` to actual file contents at delivery time. |
| 6 | Cross-file required-identifier validation | ⬜ Not yet | Verify all required identifiers appear somewhere across `filesChanged`, not just per-file. |
| 7 | Make review trigger a hard block on task completion | ⬜ Not yet | Currently only a warning; completion without review should be blocked. |
| 8 | Support multiple specs per session (keyed by subagent) | ⬜ Not needed now | Only if concurrent multi-shape delegations are required. |
| 9 | Graphify `contextMap` validation | ⬜ Not yet | Verify the declared context map matches `graphify-out/graph.json`. |
| 10 | Unit/integration tests | ⬜ Not yet | Shape check, receipt validation, and review enforcement need coverage. |

## 5. Comparison with existing OpenCode plugins

### Plugins found locally (`~/.config/opencode/plugins/`)

| Plugin | Focus | Relationship to `delegation` |
|--------|-------|------------------------------|
| `scope-guard` | Tool-level gating: directory/extension per agent, concurrency limit (5 subagents), loop detection, known-tool allowlist. | **Complementary.** `scope-guard` gates *how* and *where* agents write; `delegation` gates *what shape* the artifact takes and *whether* a receipt was delivered. `scope-guard` references `delegation_report` to free concurrency slots. |
| `graphify-navigator` | Knowledge-graph hygiene: warns if `graphify-out/graph.json` is missing or stale before/after delegation. | **Complementary.** `delegation` stores `contextMap` but never validates it; `graphify-navigator` could validate it. Both run pre/post-delegation checks. |
| `post-edit-validate` | Runs a domain gate command (build/lint) automatically after every write/edit. | **Overlapping but different timing.** `post-edit-validate` runs the gate *immediately after each write*; `delegation` requires the gate output *at report time*. They can stack: post-edit-validate catches breakage early, delegation proves the gate was run before receipt. |
| `memory-store` | Persistent facts and session checkpoints in SQLite. | **Independent.** `delegation` uses the host's `ctx.storage`, not `memory-store`. |

### Plugins found on the internet

**No public OpenCode plugins named `delegation` were found** via web search. The OpenCode plugin ecosystem appears to be largely internal/custom to this installation; the official plugin registry/catalog did not return public results for `delegation_spec`, `delegation_report`, or OpenCode `Plugin.define` examples.

This means `delegation` should be treated as a **local/custom plugin**, not a drop-in from a public registry. When comparing to "existing OpenCode plugins on the internet," the only existing implementations are the local ones listed above (`scope-guard`, `graphify-navigator`, `post-edit-validate`, `memory-store`).

### Dimensional comparison (delegation vs local plugins)

| Dimension | delegation | scope-guard | graphify-navigator | post-edit-validate |
|-----------|-----------|-------------|-------------------|--------------------|
| Enforcement point | `execute.after` (writes), `execute.before` (subagent, report) | `permission.hook("evaluate")`, `execute.before`, `agent.transform` | `execute.before` (task), `execute.after` (report) | `execute.after` (writes) |
| What it guarantees | Artifact shape + receipt delivery | Write scope + concurrency + no loops | Graph availability/freshness | Gate passes after every write |
| Trust model | Receipt from subagent, not host | Host permission decisions | AI-run graphify command | Host-side gate execution |
| Session-scoped state | Yes (`ctx.storage`) | Yes (`ctx.storage`) | No (filesystem/git) | No |

## 6. How to use (orchestrator flow)

1. Before delegating to a subagent, call `delegation_spec` with `required` identifiers, `allowedFiles`, `gateCommand`, optional `contextMap`, `note`, `ttlMs`.
2. Delegate to the subagent (`code`, `database`, `contracts`, or `review`).
3. The subagent writes files; the shape check verifies required identifiers appear.
4. The subagent runs the gate command and calls `delegation_report` with the raw output and criteria.
5. The plugin validates the report against the spec (files, gate command, output, criteria, TTL).
6. Orchestrator reads the receipt with `delegation_receipt` and decides PASS/FAIL.
7. After `code`/`database`/`contracts`, route through `review` before completing (mandatory).

## 7. Versioning notes

- Original: `~/.config/opencode/plugins/delegation.ts` (no version header).
- This repo: `delegation.ts` v1.1.0 (improved), `delegation.original.ts` (verbatim copy of original).
- Future versions should bump `PROTOCOL_VERSION` and document breaking changes here.
