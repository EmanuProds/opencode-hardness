import { Plugin } from "@opencode/plugin";

/**
 * Delegation protocol — the receipt the orchestrator can trust.
 *
 * The host's `outcome` field says "succeeded" even when a subagent exhausted
 * its step budget, and there is no API to write it. So the receipt cannot come
 * from the host. It comes from the subagent, through a tool.
 *
 *   delegation_spec     — the orchestrator declares the shape the artifact must
 *                         have, before delegating. The hook below enforces it.
 *   delegation_report   — the subagent delivers the structured receipt. The
 *                         orchestrator trusts this record and nothing else.
 *   delegation_read     — the orchestrator reads a subagent's receipt.
 *
 * The point of `delegation_spec` is the failure it exists to prevent: a rule
 * with no field to hold its fact gets approximated by the nearest field
 * available, and the approximation passes every test.
 */

interface Spec {
  required: string[];
  note: string;
  // Graphify context map attached by orchestrator before delegation
  contextMap?: string;
  // The exact file paths the subagent is allowed to modify
  allowedFiles?: string[];
  // The gate command that must pass
  gateCommand?: string;
}

interface Receipt {
  objective: string;
  filesChanged: string[];
  gateCommand: string;
  gateOutput: string;
  criteria: { criterion: string; verdict: string; evidence: string }[];
  blocked: string[];
  notes: string;
  agent: string;
  recordedAt: number;
}

const specKey = (sessionID: string) => `spec:${sessionID}`;
const reportKey = (sessionID: string) => `report:${sessionID}`;
// Track whether review is pending for an orchestrate session.
// Set when orchestrate delegates to code/database/contracts.
// Cleared when orchestrate delegates to review.
const reviewPendingKey = (sessionID: string) => `review-pending:${sessionID}`;

const WRITE_TOOLS = ["edit", "write", "patch"];

function targetOf(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const args = input as Record<string, unknown>;
  for (const key of ["filePath", "path", "file"]) {
    if (typeof args[key] === "string" && args[key].length > 0) return args[key];
  }
  return undefined;
}

export default Plugin.define({
  id: "delegation",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "delegation",
        description: "Declare the shape of a delegation, deliver its receipt, read a receipt.",
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
          };
          await ctx.storage.set(specKey(context.sessionID), spec);
          return {
            content:
              `spec recorded: ${spec.required.length} required identifier(s) ` +
              `(${spec.required.join(", ") || "none"}). The next subagent write is checked against it.`,
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
          },
          required: ["objective", "filesChanged", "gateCommand", "gateOutput", "criteria", "blocked"],
        },
        execute: async (input, context) => {
          const receipt: Receipt = {
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
          await ctx.storage.set(reportKey(context.sessionID), receipt);
          return {
            content:
              `receipt recorded for "${receipt.objective}": ` +
              `${receipt.filesChanged.length} file(s) changed, ` +
              `${receipt.criteria.length} criterion(s), ` +
              `${receipt.blocked.length} blocked.`,
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

    // The shape check: an identifier the orchestrator declared must exist in
    // what the subagent actually wrote.
    await ctx.tool.hook("execute.after", async (event) => {
      if (!WRITE_TOOLS.includes(event.tool)) return;
      const target = targetOf(event.input);
      if (!target) return;
      const spec = await ctx.storage.get<Spec>(specKey(event.sessionID));
      if (!spec || spec.required.length === 0) return;
      const child = await ctx.session.get({ sessionID: event.sessionID });
      if (!child?.parentID) return;
      const parentSpec = await ctx.storage.get<Spec>(specKey(child.parentID));
      if (!parentSpec || parentSpec.required.length === 0) return;
      const source = await readFileIfPossible(target);
      if (source === undefined) return;
      const missing = parentSpec.required.filter((identifier) => !source.includes(identifier));
      if (missing.length === 0) return;
      throw new Error(
        `blocked by scope-guard: the artifact written at "${target}" does not contain the ` +
          `required identifier(s) ${missing.join(", ")}. The declared shape of the artifact ` +
          `is part of the delegation — if the shape was wrong, stop and report it instead ` +
          `of substituting another field.`,
      );
    });

    // Review trigger: when code/database/contracts deliver a receipt, remind orchestrator
    // to trigger the review subagent for validation before considering the task complete.
    await ctx.tool.hook("execute.after", async (event) => {
      if (event.status !== "completed") return;
      if (event.tool !== "report" && event.tool !== "delegation.report") return;
      const session = await ctx.session.get?.({ sessionID: event.sessionID });
      const agent = session?.agent ?? event.agent ?? "unknown";
      if (!["code", "database", "contracts"].includes(agent)) return;
      await ctx.session.log?.({
        level: "warn",
        message:
          `delegation: subagent "${agent}" delivered a receipt. ` +
          `MANDATORY: trigger the "review" subagent to validate the work before completing. ` +
          `If review FAILS, it will create a fix plan in tmp/fix/ and delegate back to "${agent}".`,
      });
    });

    // Mandatory review enforcement:
    // 1. When orchestrate delegates to code/database/contracts, mark review as pending.
    // 2. While review is pending, orchestrate cannot delegate to anything except review.
    // 3. When orchestrate delegates to review, clear the pending flag.
    // This covers both success AND failure cases — even if code fails without delivering
    // a receipt, orchestrate must still route through review before continuing.
    await ctx.tool.hook("execute.before", async (event) => {
      if (event.tool !== "subagent") return;
      const session = await ctx.session?.get?.({ sessionID: event.sessionID });
      const agent = session?.agent ?? event.agent ?? "unknown";
      if (agent !== "orchestrate") return;

      const targetAgent = (event.input as Record<string, unknown> | undefined)?.agent ??
        (event.input as Record<string, unknown> | undefined)?.name ??
        "unknown";

      if (["code", "database", "contracts"].includes(String(targetAgent))) {
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

    // Receipt validation: ensure receipt matches spec (allowed files, gate command, required fields)
    await ctx.tool.hook("execute.before", async (event) => {
      if (event.tool !== "report") return;
      const sessionID = event.sessionID;
      const spec = await ctx.storage.get<Spec>(specKey(sessionID));
      if (!spec) return;

      // Validate filesChanged against allowedFiles
      if (spec.allowedFiles && spec.allowedFiles.length > 0 && event.input.filesChanged) {
        const unauthorized = event.input.filesChanged.filter(
          (f: string) => !spec.allowedFiles!.some((af) => f.startsWith(af)),
        );
        if (unauthorized.length > 0) {
          throw new Error(
            `delegation_report blocked: filesChanged contains paths not in allowedFiles: ${unauthorized.join(", ")}`
          );
        }
      }

      // Validate gateCommand matches spec
      if (spec.gateCommand && event.input.gateCommand) {
        if (event.input.gateCommand.trim() !== spec.gateCommand.trim()) {
          throw new Error(
            `delegation_report blocked: gateCommand "${event.input.gateCommand}" does not match spec "${spec.gateCommand}"`
          );
        }
      }

      // Ensure gateOutput is non-empty (subagent actually ran the gate)
      if (!event.input.gateOutput || !event.input.gateOutput.trim()) {
        throw new Error(
          `delegation_report blocked: gateOutput is empty. The subagent must run the gate command and include its raw output.`
        );
      }

      // Ensure criteria array has at least one entry
      if (!event.input.criteria || event.input.criteria.length === 0) {
        throw new Error(
          `delegation_report blocked: criteria array is empty. At least one criterion with verdict and evidence is required.`
        );
      }
    });
  },
});

async function readFileIfPossible(path: string): Promise<string | undefined> {
  try {
    const fs = await import("node:fs/promises");
    return await fs.readFile(path, "utf8");
  } catch {
    return undefined;
  }
}
