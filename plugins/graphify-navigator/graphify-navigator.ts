import { Plugin } from "@opencode/plugin";

/**
 * Graphify navigator — ensures the knowledge graph is available and up-to-date.
 *
 * Three enforcement points:
 *
 *  1. Pre-delegation check: before a subagent is spawned, verify that
 *     graphify-out/graph.json exists. If it doesn't, warn the orchestrator.
 *  2. Staleness check: compare graph.json mtime with the latest git commit.
 *     If the graph is older than the latest commit, warn that it needs --update.
 *  3. Post-delegation reminder: after a subagent delivers a receipt, remind
 *     the orchestrator to run /graphify --update to keep the graph current.
 *
 * Graphify is an AI skill (not a CLI), so the plugin can only check and warn.
 * The actual create/update must be done by the AI invoking /graphify.
 */

import { statSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

export function findRepoRoot(startDir: string): string | null {
  let dir = startDir;
  while (dir !== "/") {
    if (existsSync(dir + "/graphify-out/graph.json") || existsSync(dir + "/.git")) {
      return dir;
    }
    const parent = dir.substring(0, dir.lastIndexOf("/"));
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function getGraphAge(repoRoot: string): { exists: boolean; mtime: Date | null; stale: boolean } {
  const graphPath = repoRoot + "/graphify-out/graph.json";
  if (!existsSync(graphPath)) {
    return { exists: false, mtime: null, stale: true };
  }
  const stat = statSync(graphPath);
  const mtime = stat.mtime;

  // Check if graph is older than latest git commit
  let stale = false;
  try {
    const latestCommit = execSync("git log -1 --format=%ct", { cwd: repoRoot, encoding: "utf8" }).trim();
    const commitTime = new Date(parseInt(latestCommit) * 1000);
    stale = mtime < commitTime;
  } catch {
    // Can't determine git state, assume not stale
    stale = false;
  }

  return { exists: true, mtime, stale };
}

export default Plugin.define({
  id: "graphify-navigator",
  async setup(ctx) {
    // 1. Pre-delegation: check graphify state when a task is spawned.
    await ctx.tool.hook("execute.before", async (event) => {
      if (event.tool !== "task") return;

      const repoRoot = findRepoRoot(process.cwd());
      if (!repoRoot) return;

      const state = getGraphAge(repoRoot);
      if (!state.exists) {
        await ctx.session.log?.({
          level: "warn",
          message:
            "graphify-navigator: graphify-out/graph.json not found. " +
            "Run /graphify to create the knowledge graph before delegating tasks. " +
            "Subagents will use grep/glob instead of graphify query for navigation.",
        });
        return;
      }

      if (state.stale) {
        await ctx.session.log?.({
          level: "warn",
          message:
            `graphify-navigator: graph.json is stale (last updated ${state.mtime?.toISOString()}). ` +
            "Run /graphify --update before delegating to ensure accurate navigation.",
        });
      }
    });

    // 2. Post-delegation: remind to update graphify after a subagent delivers a receipt.
    await ctx.tool.hook("execute.after", async (event) => {
      if (event.status !== "completed") return;
      if (event.tool !== "delegation_report" && event.tool !== "delegation.report") return;

      const repoRoot = findRepoRoot(process.cwd());
      if (!repoRoot) return;

      await ctx.session.log?.({
        level: "info",
        message:
          "graphify-navigator: task completed. Run /graphify --update to keep the " +
          "knowledge graph current for the next delegation.",
      });
    });
  },
});