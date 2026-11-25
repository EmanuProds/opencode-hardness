import { Plugin } from "@opencode/plugin";

/**
 * Post-edit validation — runs the domain gate automatically after every write/edit.
 *
 * When a subagent writes a file, this hook fires and runs the appropriate gate
 * command for the file's domain. If the gate fails, the error is surfaced to
 * the subagent immediately, forcing it to fix the issue before continuing.
 *
 * This prevents the "I wrote it, it must be fine" pattern where subagents
 * deliver code that doesn't pass the gate.
 *
 * Configuration via plugin options:
 * - `projectRoot`: Optional project root directory (auto-detected if not provided)
 * - `gateCommands`: Optional override of default gate commands per domain
 */

interface PluginOptions {
  projectRoot?: string;
  gateCommands?: Record<string, string>;
}

const DEFAULT_GATE_COMMANDS: Record<string, string> = {
  "contracts/": "make contracts-lint",
  "core/": "cd core && go build ./... && go vet ./...",
  "interface/web/": "cd interface/web && npm run build && npm run lint",
  "database/": "cd database/sqlc && sqlc diff && sqlc vet",
};

const PROJECT_MARKERS = [".git/", "package.json", "go.mod", "Cargo.toml", "pyproject.toml"];

function findProjectRoot(startDir: string): string | null {
  let dir = startDir;
  while (dir !== "/") {
    for (const marker of PROJECT_MARKERS) {
      try {
        const fs = require("node:fs");
        if (fs.existsSync(dir + "/" + marker)) {
          return dir;
        }
      } catch {
        // ignore
      }
    }
    const parent = dir.substring(0, dir.lastIndexOf("/"));
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function normalizePath(target: string): string {
  let p = target.replace(/^\.\//, "").replace(/^\/+/, "");
  for (const marker of PROJECT_MARKERS) {
    const idx = p.indexOf(marker);
    if (idx >= 0) {
      const beforeMarker = p.slice(0, idx).replace(/\/$/, "");
      const lastSlash = beforeMarker.lastIndexOf("/");
      if (lastSlash >= 0) {
        p = p.slice(lastSlash + 1);
      }
      break;
    }
  }
  return p;
}

function domainOf(target: string): string | null {
  const normalized = normalizePath(target);
  for (const prefix of Object.keys(DEFAULT_GATE_COMMANDS)) {
    if (normalized.startsWith(prefix)) return prefix;
  }
  return null;
}

function resolveProjectRoot(target: string, configuredRoot?: string): string {
  if (configuredRoot) return configuredRoot;

  // Try to find project root from the target path
  const normalized = target.replace(/^\.\//, "").replace(/^\/+/, "");
  for (const marker of PROJECT_MARKERS) {
    const idx = normalized.indexOf(marker);
    if (idx >= 0) {
      const beforeMarker = normalized.slice(0, idx).replace(/\/$/, "");
      const lastSlash = beforeMarker.lastIndexOf("/");
      if (lastSlash >= 0) {
        const projectDir = normalized.slice(0, lastSlash + 1);
        // Convert back to absolute path
        return require("node:path").resolve(projectDir);
      }
    }
  }

  // Fallback to current working directory
  return process.cwd();
}

export default Plugin.define({
  id: "post-edit-validate",
  async setup(ctx) {
    const options: PluginOptions = (ctx.options as PluginOptions) ?? {};
    const gateCommands = options.gateCommands ?? DEFAULT_GATE_COMMANDS;
    const projectRoot = options.projectRoot;

    await ctx.tool.hook("execute.after", async (event) => {
      if (event.status !== "completed") return;
      if (!["edit", "write", "patch"].includes(event.tool)) return;

      const input = event.input as Record<string, unknown> | undefined;
      if (!input) return;
      const target =
        typeof input.filePath === "string"
          ? input.filePath
          : typeof input.path === "string"
            ? input.path
            : undefined;
      if (!target) return;

      const domain = domainOf(target);
      if (!domain) return;

      const gateCmd = gateCommands[domain];
      if (!gateCmd) return;

      const { execSync } = await import("node:child_process");

      try {
        // Resolve project root
        const cwd = resolveProjectRoot(target, projectRoot);

        const output = execSync(gateCmd, {
          cwd,
          encoding: "utf8",
          timeout: 120000,
          stdio: ["pipe", "pipe", "pipe"],
        });

        // Gate passed — log success
        await ctx.session.log?.({
          level: "info",
          message: `post-edit-validate: gate passed for ${domain}: ${gateCmd}`,
        });
      } catch (err: any) {
        const stderr = err.stderr || "";
        const stdout = err.stdout || "";
        const output = `${stdout}\n${stderr}`.trim();

        // Gate failed — throw to surface the error to the subagent
        throw new Error(
          `post-edit-validate: gate FAILED for ${domain}.\n` +
            `Command: ${gateCmd}\n` +
            `Output:\n${output.slice(0, 2000)}\n` +
            `Fix the error before continuing. Do not deliver the receipt until the gate passes.`
        );
      }
    });
  },
});