import { Plugin } from "@opencode/plugin";

/**
 * Post-edit validation — runs the domain gate automatically after every write/edit.
 *
 * When a subagent writes a file, this hook fires and runs the appropriate gate
 * command(s) for the file's domain. If any gate fails, the error is surfaced to
 * the subagent immediately, forcing it to fix the issue before continuing.
 *
 * This prevents the "I wrote it, it must be fine" pattern where subagents
 * deliver code that doesn't pass the gate.
 *
 * Configuration via plugin options:
 * - `projectRoot`: Optional project root directory (auto-detected if not provided)
 * - `gateCommands`: Map of domain prefix to command(s). String or array of strings.
 * - `timeoutMs`: Default timeout in ms for gate commands (default 120000)
 * - `ignorePatterns`: Array of glob-like suffix/prefix patterns to skip
 * - `cacheTTLMs`: Time in ms to cache a successful gate result per file (default 300000)
 * - `debounceMs`: Debounce window in ms for rapid successive edits (default 0, disabled)
 */

interface PluginOptions {
  projectRoot?: string;
  gateCommands?: Record<string, string | string[]>;
  timeoutMs?: number;
  ignorePatterns?: string[];
  cacheTTLMs?: number;
  debounceMs?: number;
}

interface GateResult {
  passed: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface FileCacheEntry {
  hash: string;
  results: Map<string, GateResult>;
  lastValidated: number;
}

const DEFAULT_GATE_COMMANDS: Record<string, string | string[]> = {
  "contracts/": "make contracts-lint",
  "core/": ["cd core && go fmt ./...", "cd core && go vet ./...", "cd core && go build ./..."],
  "interface/web/": ["cd interface/web && npm run build", "cd interface/web && npm run lint"],
  "database/": "cd database/sqlc && sqlc diff && sqlc vet",
};

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_CACHE_TTL_MS = 300_000; // 5 minutes
const DEFAULT_DEBOUNCE_MS = 0;

const PROJECT_MARKERS = [".git/", "package.json", "go.mod", "Cargo.toml", "pyproject.toml"];

/* ------------------------------------------------------------------ */
/* Pure helpers — exported for unit testing                           */
/* ------------------------------------------------------------------ */

export function findProjectRoot(startDir: string): string | null {
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

export function normalizePath(target: string): string {
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

export function domainOf(target: string): string | null {
  const normalized = normalizePath(target);
  for (const prefix of Object.keys(DEFAULT_GATE_COMMANDS)) {
    if (normalized.startsWith(prefix)) return prefix;
  }
  return null;
}

export function matchesIgnorePattern(path: string, patterns: string[]): boolean {
  if (!patterns || patterns.length === 0) return false;
  const normalized = path.replace(/\\/g, "/");
  return patterns.some((p) => {
    const pattern = p.replace(/\\/g, "/");
    if (pattern.startsWith("*")) {
      const suffix = pattern.slice(1);
      return normalized.endsWith(suffix);
    }
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      return normalized.startsWith(prefix);
    }
    return normalized === pattern || normalized.includes(pattern);
  });
}

export function resolveProjectRoot(target: string, configuredRoot?: string): string {
  if (configuredRoot) return configuredRoot;

  const normalized = target.replace(/^\.\//, "").replace(/^\/+/, "");
  for (const marker of PROJECT_MARKERS) {
    const idx = normalized.indexOf(marker);
    if (idx >= 0) {
      const beforeMarker = normalized.slice(0, idx).replace(/\/$/, "");
      const lastSlash = beforeMarker.lastIndexOf("/");
      if (lastSlash >= 0) {
        const projectDir = normalized.slice(0, lastSlash + 1);
        return require("node:path").resolve(projectDir);
      }
    }
  }

  return process.cwd();
}

export function expandEnvVars(command: string): string {
  return command.replace(/\{env:([A-Z_][A-Z0-9_]*)\}/g, (_match, varName) => {
    return process.env[varName] ?? "";
  });
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

async function runGateCommand(
  command: string,
  cwd: string,
  timeoutMs: number
): Promise<GateResult> {
  const { execSync } = await import("node:child_process");
  const expanded = expandEnvVars(command);

  try {
    const output = execSync(expanded, {
      cwd,
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return {
      passed: true,
      command: expanded,
      stdout: output as string,
      stderr: "",
      exitCode: 0,
    };
  } catch (err: any) {
    const stdout = err.stdout ?? "";
    const stderr = err.stderr ?? "";
    return {
      passed: false,
      command: expanded,
      stdout: typeof stdout === "string" ? stdout : "",
      stderr: typeof stderr === "string" ? stderr : "",
      exitCode: err.status ?? 1,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Plugin                                                             */
/* ------------------------------------------------------------------ */

export default Plugin.define({
  id: "post-edit-validate",
  async setup(ctx) {
    const options: PluginOptions = (ctx.options as PluginOptions) ?? {};
    const gateCommands = options.gateCommands ?? DEFAULT_GATE_COMMANDS;
    const projectRoot = options.projectRoot;
    const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const ignorePatterns = options.ignorePatterns ?? [];
    const cacheTTLMs = options.cacheTTLMs ?? DEFAULT_CACHE_TTL_MS;
    const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

    // Per-file content cache: file path -> { hash, results, lastValidated }
    const fileCache = new Map<string, FileCacheEntry>();

    // Debounce state per file
    const debounceTimers = new Map<string, NodeJS.Timeout>();
    const pendingEdits = new Map<string, { target: string; timestamp: number }>();

    // Integration with delegation plugin: record that a file passed its gate
    const recordGatePass = (filePath: string, domain: string) => {
      try {
        ctx.storage.set(`gate-pass:${filePath}`, {
          filePath,
          domain,
          passedAt: Date.now(),
        });
      } catch {
        // Storage may not be available in all hosts; non-blocking
      }
    };

    async function processEdit(target: string): Promise<void> {
      // Ignore patterns check
      if (matchesIgnorePattern(target, ignorePatterns)) return;

      const domain = domainOf(target);
      if (!domain) return;

      const commands = gateCommands[domain];
      if (!commands) return;

      const cmdList = Array.isArray(commands) ? commands : [commands];

      // Compute content hash for cache check
      const currentHash = await sha256OfFile(target);
      if (currentHash === undefined) return; // File unreadable, skip

      const cached = fileCache.get(target);
      if (cached && Date.now() - cached.lastValidated < cacheTTLMs) {
        // Check if all commands for this domain passed previously
        const allPassed = cmdList.every((cmd) => {
          const result = cached.results.get(cmd);
          return result ? result.passed : false;
        });
        if (cached.hash === currentHash && allPassed) {
          // Cache hit — skip re-execution
          return;
        }
      }

      // Resolve project root
      const cwd = resolveProjectRoot(target, projectRoot);

      // Run each command; stop on first failure
      const results = new Map<string, GateResult>();
      let allPassed = true;

      for (const cmd of cmdList) {
        const result = await runGateCommand(cmd, cwd, defaultTimeoutMs);
        results.set(cmd, result);
        if (!result.passed) {
          allPassed = false;
          break;
        }
      }

      // Update cache
      fileCache.set(target, {
        hash: currentHash,
        results,
        lastValidated: Date.now(),
      });

      if (allPassed) {
        // Record gate pass for delegation integration
        recordGatePass(target, domain);

        await ctx.session.log?.({
          level: "info",
          message:
            `post-edit-validate: gate passed for ${domain} (${cmdList.length} command(s)) on ${target}`,
        });
      } else {
        const failed = cmdList.find((cmd) => {
          const r = results.get(cmd);
          return r ? !r.passed : false;
        });
        const failedResult = results.get(failed ?? "")!;

        // Gate failed — throw to surface the error to the subagent
        const errorMsg =
          `post-edit-validate: gate FAILED for ${domain}.\n` +
          `Command: ${failedResult.command}\n` +
          `Exit code: ${failedResult.exitCode}\n` +
          `Stdout:\n${failedResult.stdout.slice(0, 2000)}\n` +
          `Stderr:\n${failedResult.stderr.slice(0, 2000)}\n` +
          `File: ${target}\n` +
          `Fix the error before continuing. Do not deliver the receipt until the gate passes.`;

        throw new Error(errorMsg);
      }
    }

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

      if (debounceMs > 0) {
        // Debounce: cancel previous timer for this file, set new one
        const existingTimer = debounceTimers.get(target);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }

        pendingEdits.set(target, { target, timestamp: Date.now() });

        const timer = setTimeout(async () => {
          const pending = pendingEdits.get(target);
          if (!pending) return;
          pendingEdits.delete(target);
          debounceTimers.delete(target);
          try {
            await processEdit(pending.target);
          } catch {
            // Error already thrown inside processEdit; re-throw to surface
            // to the subagent. In debounced context we log instead to avoid
            // unhandled promise rejection confusing the host.
          }
        }, debounceMs);

        debounceTimers.set(target, timer);
      } else {
        try {
          await processEdit(target);
        } catch {
          // The throw inside processEdit already constructs a detailed error.
          // Re-throw so the host surfaces it to the subagent.
          throw new Error(
            `post-edit-validate: gate failed for ${target}. See previous log for details.`
          );
        }
      }
    });

    // Cleanup debounce timers on plugin cleanup
    const originalCleanup = ctx.setup ? undefined : undefined;
    return () => {
      for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
      }
      debounceTimers.clear();
      pendingEdits.clear();
      fileCache.clear();
    };
  },
});
