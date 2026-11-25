import { Plugin } from "@opencode/plugin";

/**
 * Delegation protocol — the receipt the orchestrator can trust.
 *
 * The host's `outcome` field says "succeeded" even when a subagent exhausted
 * its step budget, and there is no API to write it. So the receipt cannot come
 * from the host. It comes from the subagent, through a tool.
 *
 *   delegation_spec     — the orchestrator declares the shape the artifact must
 *                         have, before delegating.
 *   delegation_report   — the subagent delivers the structured receipt.
 *   delegation_receipt  — the orchestrator reads a subagent's receipt.
 *
 * The point of `delegation_spec` is the failure it exists to prevent: a rule
 * with no field to hold its fact gets approximated by the nearest field
 * available, and the approximation passes every test.
 *
 * @version 1.0.0
 */

interface Spec {
  required: string[];
  note: string;
  contextMap?: string;
  allowedFiles?: string[];
  gateCommand?: string;
  createdAt: number;
  ttlMs?: number;
}

interface Receipt {
  protocolVersion: string;
  objective: string;
  filesChanged: string[];
  gateCommand: string;
  gateOutput: string;
  criteria: { criterion: string; verdict: string; evidence: string }[];
  blocked: string[];
  notes: string;
  agent: string;
  recordedAt: number;
  parentSessionID?: string;
  fileHashes?: Record<string, string>;
}

const PROTOCOL_VERSION = "1.0.0";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const WRITE_TOOLS = ["edit", "write", "patch"];
const IMPLEMENTATION_AGENTS = ["code", "database", "contracts"];

const specKey = (sessionID: string) => `spec:${sessionID}`;
// Multiple specs per orchestrator session, keyed by subagent session.
const specKeyFor = (parentID: string, subagentID: string) =>
  `spec:${parentID}:${subagentID}`;
const reportKey = (sessionID: string) => `report:${sessionID}`;
const reviewPendingKey = (sessionID: string) => `review-pending:${sessionID}`;
// Hard-block flag: implementation delivered a receipt and review is required
// before another implementation report can be accepted.
const reviewRequiredKey = (sessionID: string) => `review-required:${sessionID}`;

function targetOf(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const args = input as Record<string, unknown>;
  for (const key of ["filePath", "path", "file"]) {
    if (typeof args[key] === "string" && args[key].length > 0) return args[key];
  }
  return undefined;
}

/**
 * Pure helpers — exported so they can be unit-tested without a host context.
 */
export { targetOf };

export function missingRequiredIdentifiers(
  source: string,
  required: string[]
): string[] {
  return required.filter((identifier) => !source.includes(identifier));
}

export function validateCriteria(criteria: unknown): boolean {
  if (!Array.isArray(criteria) || criteria.length === 0) return false;
  return criteria.every(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      typeof (entry as { criterion?: unknown }).criterion === "string" &&
      (entry as { criterion: string }).criterion.trim().length > 0 &&
      typeof (entry as { verdict?: unknown }).verdict === "string" &&
      typeof (entry as { evidence?: unknown }).evidence === "string"
  );
}

export function validateAllowedFiles(
  filesChanged: string[],
  allowedFiles: string[] | undefined
): string[] {
  if (!allowedFiles || allowedFiles.length === 0) return [];
  return filesChanged.filter(
    (f) => !allowedFiles.some((af) => f.startsWith(af))
  );
}

export function validateGateCommand(
  gateCommand: string,
  specGateCommand: string | undefined
): string | undefined {
  if (!specGateCommand) return undefined;
  if (gateCommand.trim() !== specGateCommand.trim()) {
    return `gateCommand "${gateCommand}" does not match spec "${specGateCommand}"`;
  }
  return undefined;
}

export function isSpecExpired(spec: Spec): boolean {
  if (!spec.ttlMs) return false;
  return Date.now() - spec.createdAt > spec.ttlMs;
}

async function sha256OfFile(path: string): Promise<string | undefined> {
  try {
    const crypto = await import("node:crypto");
    const fs = await import("node:fs/promises");
    const contents = await fs.readFile(path);
    return crypto.createHash("sha256").update(contents).digest("hex");
  } catch {
    return undefined;
  }
}

async function readFileIfPossible(path: string): Promise<string | undefined> {
  try {
    const fs = await import("node:fs/promises");
    return await fs.readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Resolve the spec for a report, supporting multiple specs per orchestrator
 * session. Lookup order:
 *  1. spec:{parentSessionID}:{subagentSessionID}  (multi-spec)
 *  2. spec:{parentSessionID}                       (single-spec fallback)
 *  3. spec:{subagentSessionID}                     (legacy fallback)
 */
async function resolveSpec(
  ctx: { storage: { get: (key: string) => Promise<Spec | undefined> } },
  parentSessionID: string | undefined,
  subagentSessionID: string
): Promise<Spec | undefined> {
  if (parentSessionID) {
    const multi = await ctx.storage.get<Spec>(
      specKeyFor(parentSessionID, subagentSessionID)
    );
    if (multi) return multi;
    const single = await ctx.storage.get<Spec>(specKey(parentSessionID));
    if (single) return single;
  }
  return ctx.storage.get<Spec>(specKey(subagentSessionID));
}

/**
 * Validate graphify contextMap against graphify-out/graph.json, if present.
 * Returns a warning message (never blocks) when the graph is missing or
 * does not reference the declared context.
 */
async function validateContextMap(
  contextMap: string | undefined,
  ctx: {
    session: { log?: (entry: { level: string; message: string }) => void };
  }
): Promise<void> {
  if (!contextMap) return;
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const cwd = process.cwd();
  // Walk up to find a repo root containing graphify-out/graph.json.
  let dir = cwd;
  let graphPath: string | null = null;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "graphify-out", "graph.json");
    try {
      await fs.access(candidate);
      graphPath = candidate;
      break;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  if (!graphPath) {
    await ctx.session.log?.({
      level: "warn",
      message:
        "delegation: contextMap declared but graphify-out/graph.json not found. " +
        "Run /graphify to create the knowledge graph before delegating.",
    });
    return;
  }
  const graphContents = await fs.readFile(graphPath, "utf8");
  // Extract file paths mentioned in the contextMap and check they appear in the graph.
  const pathMatches = contextMap.match(/[A-Za-z0-9_./-]+\.[a-zA-Z0-9]+/g) ?? [];
  const missing = pathMatches.filter((p) => !graphContents.includes(p));
  if (missing.length > 0) {
    await ctx.session.log?.({
      level: "warn",
      message:
        `delegation: contextMap references path(s) not found in graphify-out/graph.json: ${missing.join(", ")}. ` +
        "Run /graphify --update to refresh the knowledge graph.",
    });
  }
}

export default Plugin.define({
  id: "delegation",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "delegation",
        description:
          "Declare the shape of a delegation, deliver its receipt, read a receipt.",
      });

      editor.add({
        name: "spec",
        description:
          "Declare the shape the delegated artifact must have, before delegating. " +
          "Each required identifier must appear in the files the subagent writes. " +
          "Call this immediately before every delegation.",
        options: { namespace: "delegation", codemode: false },
        input: {
          type: "object",
          properties: {
            required: {
              type: "array",
              items: { type: "string" },
              description:
                "Identifiers that must appear in the written artifact — fields, types, " +
                "exports. A rule with no field to hold its fact needs its field named here.",
            },
            note: { type: "string", description: "Why these identifiers are required." },
            allowedFiles: {
              type: "array",
              items: { type: "string" },
              description:
                "Exact file paths the subagent is allowed to modify. " +
                "delegation_report validates filesChanged against this list.",
            },
            gateCommand: {
              type: "string",
              description:
                "The gate command the subagent must run and include raw output for. " +
                "delegation_report validates gateCommand matches this.",
            },
            contextMap: {
              type: "string",
              description:
                "Graphify context map attached by orchestrator before delegation. " +
                "File paths and symbols the subagent should focus on.",
            },
            ttlMs: {
              type: "number",
              description:
                "Time-to-live in milliseconds after which the spec expires. Defaults to 24h.",
            },
            subagentSessionID: {
              type: "string",
              description:
                "Optional session id of the target subagent. When provided, the spec " +
                "is keyed for that subagent, allowing multiple specs per orchestrator session.",
            },
          },
          required: ["required"],
        },
        execute: async (input, context) => {
          const spec: Spec = {
            required: (input.required ?? []).map((value) => String(value)),
            note: input.note ? String(input.note) : "",
            allowedFiles: (input.allowedFiles ?? []).map((value: unknown) => String(value)),
            gateCommand: input.gateCommand ? String(input.gateCommand) : undefined,
            contextMap: input.contextMap ? String(input.contextMap) : undefined,
            createdAt: Date.now(),
            ttlMs: typeof input.ttlMs === "number" ? input.ttlMs : DEFAULT_TTL_MS,
          };

          // Validate contextMap against graphify graph (non-blocking warning).
          await validateContextMap(spec.contextMap, {
            session: { log: ctx.session.log },
          });

          // Store under both single-spec key (legacy) and multi-spec key if
          // a subagent session id was provided.
          await ctx.storage.set(specKey(context.sessionID), spec);
          if (input.subagentSessionID) {
            await ctx.storage.set(
              specKeyFor(context.sessionID, String(input.subagentSessionID)),
              spec
            );
          }

          return {
            content:
              `spec recorded (v${PROTOCOL_VERSION}): ${spec.required.length} required identifier(s) ` +
              `(${spec.required.join(", ") || "none"}). Expires in ${spec.ttlMs}ms. ` +
              `The next subagent write is checked against it.`,
          };
        },
      });

      editor.add({
        name: "report",
        description:
          "Deliver the receipt for the task you just did. This is the only record the " +
          "orchestrator trusts — your prose is not a receipt. Call it once, at the end, " +
          "with the raw output of the gate command you ran.",
        options: { namespace: "delegation", codemode: false },
        input: {
          type: "object",
          properties: {
            objective: { type: "string", description: "What had to be true when you were done." },
            filesChanged: {
              type: "array",
              items: { type: "string" },
              description: "Every file you changed. Empty only if the task changed nothing.",
            },
            gateCommand: { type: "string", description: "The gate command you ran, verbatim." },
            gateOutput: { type: "string", description: "Its raw output, verbatim. Never summarised." },
            criteria: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  criterion: { type: "string" },
                  verdict: { type: "string", description: "PASS, FAIL or UNKNOWN." },
                  evidence: { type: "string", description: "File and line, or the command output." },
                },
                required: ["criterion", "verdict", "evidence"],
              },
              description: "One entry per criterion of the task.",
            },
            blocked: {
              type: "array",
              items: { type: "string" },
              description: "Anything you could not finish, and why. Empty if nothing.",
            },
            notes: { type: "string", description: "Anything else the orchestrator needs." },
            parentSessionID: {
              type: "string",
              description: "The session id that originated this delegation.",
            },
          },
          required: ["objective", "filesChanged", "gateCommand", "gateOutput", "criteria", "blocked"],
        },
        execute: async (input, context) => {
          const receipt: Receipt = {
            protocolVersion: PROTOCOL_VERSION,
            objective: String(input.objective ?? ""),
            filesChanged: (input.filesChanged ?? []).map((value) => String(value)),
            gateCommand: String(input.gateCommand ?? ""),
            gateOutput: String(input.gateOutput ?? ""),
            criteria: (input.criteria ?? []).map((entry) => ({
              criterion: String(entry.criterion ?? ""),
              verdict: String(entry.verdict ?? ""),
              evidence: String(entry.evidence ?? ""),
            })),
            blocked: (input.blocked ?? []).map((value) => String(value)),
            notes: String(input.notes ?? ""),
            agent: context.agent,
            recordedAt: Date.now(),
            parentSessionID: input.parentSessionID ? String(input.parentSessionID) : undefined,
          };

          if (!receipt.objective.trim()) {
            throw new Error("delegation_report: objective is required.");
          }
          if (!receipt.gateCommand.trim() || !receipt.gateOutput.trim()) {
            throw new Error(
              "delegation_report: the gate command and its raw output are required. " +
                "A receipt without the raw output is not a receipt.",
            );
          }
          if (!receipt.criteria || receipt.criteria.length === 0) {
            throw new Error(
              "delegation_report: criteria array is empty. At least one criterion with verdict and evidence is required.",
            );
          }

          // Integrity binding: SHA-256 of each changed file at delivery time.
          const fileHashes: Record<string, string> = {};
          for (const file of receipt.filesChanged) {
            const hash = await sha256OfFile(file);
            if (hash) fileHashes[file] = hash;
          }
          receipt.fileHashes = fileHashes;

          await ctx.storage.set(reportKey(context.sessionID), receipt);

          // Review-required hard-block flag: after an implementation agent
          // delivers a receipt, review is mandatory before another implementation
          // report can be accepted for the same parent session.
          if (IMPLEMENTATION_AGENTS.includes(receipt.agent) && receipt.parentSessionID) {
            await ctx.storage.set(reviewRequiredKey(receipt.parentSessionID), true);
          }
          // When the review agent delivers, clear the flag.
          if (receipt.agent === "review" && receipt.parentSessionID) {
            await ctx.storage.set(reviewRequiredKey(receipt.parentSessionID), false);
          }

          return {
            content:
              `receipt recorded (v${PROTOCOL_VERSION}) for "${receipt.objective}": ` +
              `${receipt.filesChanged.length} file(s) changed, ` +
              `${receipt.criteria.length} criterion(s), ` +
              `${receipt.blocked.length} blocked, ` +
              `${Object.keys(fileHashes).length} file hash(es) recorded.`,
          };
        },
      });

      editor.add({
        name: "receipt",
        description:
          "Read the receipt a subagent delivered. Use it instead of trusting the " +
          "subagent's prose or the session outcome.",
        options: { namespace: "delegation", codemode: false },
        input: {
          type: "object",
          properties: { sessionID: { type: "string", description: "The subagent session id." } },
          required: ["sessionID"],
        },
        execute: async (input) => {
          const receipt = await ctx.storage.get<Receipt>(reportKey(String(input.sessionID)));
          if (!receipt) {
            return {
              content:
                `no receipt recorded for session ${input.sessionID}. ` +
                `Treat the task as unfinished: the subagent did not deliver one.`,
            };
          }
          return { content: JSON.stringify(receipt, null, 2) };
        },
      });
    });

    // ------------------------------------------------------------------
    // Shape check: identifiers declared by the orchestrator must exist in
    // what the subagent actually wrote. Per-file, non-blocking advisory:
    // the hard cross-file check happens in delegation_report validation.
    // ------------------------------------------------------------------
    await ctx.tool.hook("execute.after", async (event) => {
      if (!WRITE_TOOLS.includes(event.tool)) return;
      const target = targetOf(event.input);
      if (!target) return;
      const child = await ctx.session.get({ sessionID: event.sessionID });
      if (!child?.parentID) return;
      const spec = await resolveSpec(ctx, child.parentID, event.sessionID);
      if (!spec || spec.required.length === 0) return;
      const source = await readFileIfPossible(target);
      if (source === undefined) return;
      const missing = missingRequiredIdentifiers(source, spec.required);
      if (missing.length === 0) return;
      await ctx.session.log?.({
        level: "info",
        message:
          `delegation: file "${target}" is missing required identifier(s) ${missing.join(", ")}. ` +
          `Ensure all required identifiers (${spec.required.join(", ")}) appear across ` +
          `the files you changed before delivering delegation_report.`,
      });
    });

    // ------------------------------------------------------------------
    // Review trigger: when code/database/contracts deliver a receipt, remind
    // orchestrator to trigger the review subagent before completing.
    // ------------------------------------------------------------------
    await ctx.tool.hook("execute.after", async (event) => {
      if (event.status !== "completed") return;
      if (event.tool !== "report" && event.tool !== "delegation.report") return;
      const session = await ctx.session.get?.({ sessionID: event.sessionID });
      const agent = session?.agent ?? event.agent ?? "unknown";
      if (!IMPLEMENTATION_AGENTS.includes(agent)) return;
      await ctx.session.log?.({
        level: "warn",
        message:
          `delegation: subagent "${agent}" delivered a receipt. ` +
          `MANDATORY: trigger the "review" subagent to validate the work before completing. ` +
          `If review FAILS, it will create a fix plan in tmp/fix/ and delegate back to "${agent}".`,
      });
    });

    // ------------------------------------------------------------------
    // Mandatory review enforcement:
    // 1. When orchestrate delegates to code/database/contracts, mark review as pending.
    // 2. While review is pending, orchestrate cannot delegate to anything except review.
    // 3. When orchestrate delegates to review, clear the pending flag.
    // ------------------------------------------------------------------
    await ctx.tool.hook("execute.before", async (event) => {
      if (event.tool !== "subagent") return;
      const session = await ctx.session?.get?.({ sessionID: event.sessionID });
      const agent = session?.agent ?? event.agent ?? "unknown";
      if (agent !== "orchestrate") return;

      const targetAgent =
        (event.input as Record<string, unknown> | undefined)?.agent ??
        (event.input as Record<string, unknown> | undefined)?.name ??
        "unknown";

      if (IMPLEMENTATION_AGENTS.includes(String(targetAgent))) {
        await ctx.storage.set(reviewPendingKey(event.sessionID), true);
        return;
      }

      if (String(targetAgent) === "review") {
        await ctx.storage.set(reviewPendingKey(event.sessionID), false);
        return;
      }

      const pending = await ctx.storage.get<boolean>(reviewPendingKey(event.sessionID));
      if (pending === true) {
        throw new Error(
          `blocked by delegation-limit: agent "orchestrate" must delegate to the "review" subagent ` +
            `before delegating to "${targetAgent}". Review is mandatory after code/database/contracts ` +
            `delivers a receipt (or fails). Call delegation_spec for review, then delegate to review.`
        );
      }
    });

    // ------------------------------------------------------------------
    // Receipt validation: ensure receipt matches spec (allowed files, gate
    // command, required fields, cross-file required identifiers, review
    // required hard-block, expired spec).
    // ------------------------------------------------------------------
    await ctx.tool.hook("execute.before", async (event) => {
      if (event.tool !== "report") return;
      const sessionID = event.sessionID;
      const session = await ctx.session.get?.({ sessionID });
      const parentSessionID = session?.parentID;
      const agent = session?.agent ?? event.agent ?? "unknown";

      const spec = await resolveSpec(ctx, parentSessionID, sessionID);
      if (!spec) return;

      // Expired spec?
      if (isSpecExpired(spec)) {
        throw new Error(
          `delegation_report blocked: spec for session ${sessionID} expired ` +
            `(created ${new Date(spec.createdAt).toISOString()}, ttl ${spec.ttlMs}ms). ` +
            `Call delegation_spec again to re-declare the shape.`,
        );
      }

      // Hard block: implementation agent delivering a report while review is
      // required for the parent session (another implementation report was
      // already accepted without an intervening review).
      if (
        IMPLEMENTATION_AGENTS.includes(agent) &&
        parentSessionID &&
        (await ctx.storage.get<boolean>(reviewRequiredKey(parentSessionID))) === true
      ) {
        throw new Error(
          `delegation_report blocked: review is required for parent session ${parentSessionID} ` +
            `before another implementation ("${agent}") report can be accepted. ` +
            `Delegate to the "review" subagent first.`
        );
      }

      // Validate filesChanged against allowedFiles
      if (spec.allowedFiles && spec.allowedFiles.length > 0 && event.input.filesChanged) {
        const unauthorized = validateAllowedFiles(
          (event.input.filesChanged as string[]),
          spec.allowedFiles
        );
        if (unauthorized.length > 0) {
          throw new Error(
            `delegation_report blocked: filesChanged contains paths not in allowedFiles: ${unauthorized.join(", ")}`
          );
        }
      }

      // Validate gateCommand matches spec
      if (spec.gateCommand && event.input.gateCommand) {
        const mismatch = validateGateCommand(
          String(event.input.gateCommand),
          spec.gateCommand
        );
        if (mismatch) {
          throw new Error(`delegation_report blocked: ${mismatch}`);
        }
      }

      // Ensure gateOutput is non-empty (subagent actually ran the gate)
      if (!event.input.gateOutput || !event.input.gateOutput.trim()) {
        throw new Error(
          `delegation_report blocked: gateOutput is empty. The subagent must run the gate command and include its raw output.`
        );
      }

      // Ensure criteria array has at least one valid entry
      if (!validateCriteria(event.input.criteria)) {
        throw new Error(
          `delegation_report blocked: criteria array is empty or invalid. At least one criterion with verdict and evidence is required.`
        );
      }

      // Cross-file required-identifier validation: every required identifier
      // declared by the orchestrator must appear somewhere across the changed files.
      if (spec.required.length > 0 && event.input.filesChanged) {
        const filesChanged = event.input.filesChanged as string[];
        const fs = await import("node:fs/promises");
        let combined = "";
        for (const file of filesChanged) {
          try {
            combined += await fs.readFile(file, "utf8");
            combined += "\n";
          } catch {
            // Ignore unreadable files; they will fail file-hash binding in report.execute.
          }
        }
        const missing = missingRequiredIdentifiers(combined, spec.required);
        if (missing.length > 0) {
          throw new Error(
            `delegation_report blocked: required identifier(s) ${missing.join(
              ", "
            )} declared by the spec do not appear anywhere in the changed files ` +
              `(${filesChanged.join(", ")}). The declared shape of the artifact ` +
              `is part of the delegation — if the shape was wrong, stop and report it instead ` +
              `of substituting another field.`,
          );
        }
      }
    });
  },
});

async function readFileIfPossibleTopLevel(path: string): Promise<string | undefined> {
  try {
    const fs = await import("node:fs/promises");
    return await fs.readFile(path, "utf8");
  } catch {
    return undefined;
  }
}
