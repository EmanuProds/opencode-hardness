import { Plugin } from "@opencode/plugin";

/**
 * Scope guard — the tool-level gate.
 *
 * Three enforcement points, in order of strength:
 *
 *  1. `ctx.permission.hook("evaluate")` — the official one. The event carries the
 *     agent and the resources directly, and the host applies the resulting
 *     effect. This is where an out-of-scope write is denied.
 *  2. `ctx.tool.hook("execute.before")` — the safety net. It throws, and the
 *     host turns the throw into a denial before the tool runs.
 *  3. `ctx.agent.transform` — repairs the host's permission merge order for the
 *     built-in agents, whose native policies land *before* the global rules and
 *     can therefore be overridden by them.
 *
 * A prompt rule is a suggestion. This is not.
 */

// Detecção de loops de execução: limite de chamadas da mesma tool por sessão
// dentro de uma janela de tempo.
const LOOP_WINDOW_MS = 60_000; // 1 minuto
const MAX_CALLS_PER_TOOL = 30; // máximo de chamadas da mesma tool na janela
const MAX_TOTAL_CALLS = 200; // máximo de chamadas totais na janela

interface ToolCallRecord {
  tool: string;
  timestamp: number;
}

interface Rule {
  action: string;
  resource: string;
  effect: "allow" | "ask" | "deny";
}

/** Area of each subagent: directory prefix + allowed extensions. */
const STACK_SCOPES: Record<string, { dir: string; exts: string[] }> = {
  orchestrate: { dir: "tmp/plans", exts: [".md"] },
  review: { dir: "tmp/fix", exts: [".md"] },
  "core-impl": { dir: "core/", exts: [".go"] },
  "core-review": { dir: "core/", exts: [".go"] },
  "web-impl": { dir: "interface/web/", exts: [".ts", ".tsx", ".js", ".jsx", ".json", ".css"] },
  "web-review": { dir: "interface/web/", exts: [".ts", ".tsx", ".js", ".jsx", ".json", ".css"] },
  "db-impl": { dir: "database/", exts: [".sql", ".yaml", ".yml"] },
  "db-review": { dir: "database/", exts: [".sql", ".yaml", ".yml"] },
  "contracts-impl": { dir: "contracts/", exts: [".yaml", ".yml", ".md"] },
  "contracts-review": { dir: "contracts/", exts: [".yaml", ".yml", ".md"] },
};

const WRITE_TOOLS = ["edit", "write", "patch"];

// Conjunto de tools conhecidas pelo host do OpenCode. Qualquer tool fora
// dessa lista (ex.: "finish") é inválida e pode indicar um loop de execução
// do subagent.
const KNOWN_TOOLS = new Set([
  "read", "glob", "grep", "webfetch", "websearch",
  "edit", "write", "patch",
  "shell", "bash",
  "subagent",
  "delegation.spec", "delegation.report", "delegation.receipt",
  "memory.store", "memory.recall", "memory.forget",
  "memory.checkpoint_save", "memory.checkpoint_list", "memory.checkpoint_restore",
  "opencode.session_move", "opencode.worktree_create", "opencode.worktree_list",
  "opencode.worktree_remove", "opencode.list_mcp_resources",
  "browser.back", "browser.check", "browser.click", "browser.console",
  "browser.frames", "browser.files.list", "browser.list", "browser.network.list",
  "browser.trace.start", "browser.trace.stop", "browser.cpu.analyze",
  "image_generate",
  "execute",
  "search",
  "question",
  "delegation_spec",
  "delegation_report",
  "delegation_receipt",
  "memory_store",
  "memory_recall",
  "memory_forget",
  "memory_checkpoint_save",
  "memory_checkpoint_list",
  "memory_checkpoint_restore",
  "opencode_session_move",
  "opencode_worktree_create",
  "opencode_worktree_list",
  "opencode_worktree_remove",
  "opencode_list_mcp_resources",
]);

/**
 * Native policies of the built-in agents, as documented. The host appends the
 * global rules after these, so a global `edit -> allow` silently defeats them.
 * Re-appending here restores the documented behaviour.
 */
const BUILTIN_POLICIES: Record<string, Rule[]> = {
  build: [{ action: "question", resource: "*", effect: "allow" }],
  plan: [
    { action: "question", resource: "*", effect: "allow" },
    { action: "edit", resource: "*", effect: "deny" },
    { action: "edit", resource: "~/.opencode/plan/**", effect: "allow" },
  ],
  explore: [
    { action: "*", resource: "*", effect: "deny" },
    { action: "shell", resource: "*", effect: "allow" },
    { action: "read", resource: "*", effect: "allow" },
    { action: "glob", resource: "*", effect: "allow" },
    { action: "grep", resource: "*", effect: "allow" },
    { action: "webfetch", resource: "*", effect: "allow" },
    { action: "websearch", resource: "*", effect: "allow" },
    { action: "external_directory", resource: "*", effect: "allow" },
    { action: "read", resource: "*.env", effect: "ask" },
    { action: "read", resource: "*.env.*", effect: "ask" },
  ],
  general: [
    { action: "question", resource: "*", effect: "deny" },
  ],
  title: [{ action: "*", resource: "*", effect: "deny" }],
  summary: [{ action: "*", resource: "*", effect: "deny" }],
};

function extensionOf(target: string): string {
  const clean = target.split("?")[0].split("#")[0];
  const slash = clean.lastIndexOf("/");
  const name = slash >= 0 ? clean.slice(slash + 1) : clean;
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function normalizePath(target: string): string {
  // Remove leading ./ or / and normalize
  let p = target.replace(/^\.\//, "").replace(/^\/+/, "");
  // Try to extract project-relative path by finding common project markers
  const markers = [".git/", "package.json", "go.mod", "Cargo.toml", "pyproject.toml"];
  for (const marker of markers) {
    const idx = p.indexOf(marker);
    if (idx >= 0) {
      // Find the path segment before the marker (the project root)
      // Strip trailing slash from beforeMarker to get the actual project directory
      const beforeMarker = p.slice(0, idx).replace(/\/$/, "");
      const lastSlash = beforeMarker.lastIndexOf("/");
      if (lastSlash >= 0) {
        // The project root is the segment after the last slash
        // We want everything from the project root onwards
        p = p.slice(lastSlash + 1);
      } else {
        // No slash before marker, use everything from start
        p = p.slice(0);
      }
      break;
    }
  }
  return p;
}

function isInsideScope(target: string, scope: { dir: string; exts: string[] }): boolean {
  const ext = extensionOf(target);
  if (!ext) return false;
  if (!scope.exts.includes(ext)) return false;
  const normalized = target.replace(/\\/g, "/");
  const dir = scope.dir.replace(/\/$/, "");
  // Match the directory as a path segment anywhere in the path
  return normalized.includes(`/${dir}/`) || normalized.startsWith(`${dir}/`) || normalized === dir;
}

function denialMessage(agent: string, scope: { dir: string; exts: string[] }, target: string): string {
  return (
    `blocked by scope-guard: agent "${agent}" may only modify files under "${scope.dir}" ` +
    `with extensions ${scope.exts.join(", ")}, but the target was "${target}". ` +
    `Delegate to the agent that owns this stack, or report the need to the orchestrator.`
  );
}

export default Plugin.define({
  id: "scope-guard",
  async setup(ctx) {
    // 1. The official gate — check directory + extension.
    if (ctx.permission?.hook) {
      await ctx.permission.hook("evaluate", (event) => {
        if (event.effect === "deny") return;
        if (event.action !== "edit" && event.action !== "write") return;
        const scope = STACK_SCOPES[event.agent ?? ""];
        if (!scope) return;
        const outside = event.resources.filter((resource) => !isInsideScope(resource, scope));
        if (outside.length === 0) return;
        event.effect = "deny";
        event.message = denialMessage(event.agent ?? "", scope, outside[0]);
      });

    }

    // 2. The safety net — throws before the tool runs.
    await ctx.tool.hook("execute.before", async (event) => {
      // 2a. Escrita fora da área do agente.
      if (WRITE_TOOLS.includes(event.tool)) {
        const scope = STACK_SCOPES[event.agent ?? ""] ?? STACK_SCOPES[
          (await ctx.session?.get?.({ sessionID: event.sessionID }))?.agent ?? ""
        ];
        if (scope) {
          const input = event.input as Record<string, unknown> | undefined;
          if (input) {
            const target =
              typeof input.filePath === "string"
                ? input.filePath
                : typeof input.path === "string"
                  ? input.path
                  : undefined;
            if (target) {
              const resolvedAgent =
                event.agent ?? (await ctx.session?.get?.({ sessionID: event.sessionID }))?.agent ?? "unknown";
              if (!isInsideScope(target, scope)) {
                throw new Error(denialMessage(resolvedAgent, scope, target));
              }
            }
          }
        }
      }

      // 2c. Detecção de loops de execução. Rastreia chamadas de tool por
      // sessão e bloqueia quando o mesmo subagent repete a mesma tool
      // excessivamente em uma janela de tempo (ex.: chamar "finish" que não
      // existe, ou qualquer tool infinitamente sem progresso).
      if (!ctx.storage) return;

      const sessionID = event.sessionID;
      const callsKey = `tool-calls:${sessionID}`;
      const now = Date.now();

      // Recupera o histórico de calls da sessão.
      const history: ToolCallRecord[] =
        (await ctx.storage.get<ToolCallRecord[]>(callsKey)) ?? [];

      // Filtra apenas calls dentro da janela de tempo.
      const recent = history.filter((r) => now - r.timestamp < LOOP_WINDOW_MS);

      // Tool desconhecida (ex.: "finish") — bloqueia imediatamente.
      if (!KNOWN_TOOLS.has(event.tool)) {
        throw new Error(
          `blocked by scope-guard: tool "${event.tool}" is not a known OpenCode tool. ` +
            `This may be an execution loop. Check the tool name and try again.`
        );
      }

      // Adiciona a call atual ao histórico.
      recent.push({ tool: event.tool, timestamp: now });
      await ctx.storage.set(callsKey, recent);

      // Loop: mesma tool chamada muitas vezes na janela.
      const callsOfSameTool = recent.filter((r) => r.tool === event.tool).length;
      if (callsOfSameTool > MAX_CALLS_PER_TOOL) {
        throw new Error(
          `blocked by scope-guard: tool "${event.tool}" called ${callsOfSameTool} times ` +
            `in the last ${LOOP_WINDOW_MS / 1000}s (limit ${MAX_CALLS_PER_TOOL}). ` +
            `Possible execution loop. Stop repeating this tool and report to the orchestrator.`
        );
      }

      // Loop: total de calls excede o limite na janela.
      if (recent.length > MAX_TOTAL_CALLS) {
        throw new Error(
          `blocked by scope-guard: ${recent.length} tool calls in the last ` +
            `${LOOP_WINDOW_MS / 1000}s (limit ${MAX_TOTAL_CALLS}). ` +
            `Possible execution loop. Stop and report to the orchestrator.`
        );
      }
    });

    // 3. Repair the merge order of the built-in agents.
    if (ctx.agent?.transform) {
      await ctx.agent.transform((editor) => {
        for (const [id, policy] of Object.entries(BUILTIN_POLICIES)) {
          const agent = editor.get(id);
          if (!agent) continue;
          agent.permissions = [...(agent.permissions ?? []), ...policy];
        }
      });
    }
  },
});