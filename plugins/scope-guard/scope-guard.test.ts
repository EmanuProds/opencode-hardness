import { describe, it } from "node:test";
import assert from "node:assert";

// Test pure helpers from scope-guard by copying their logic
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

function extensionOf(target: string): string {
  const clean = target.split("?")[0].split("#")[0];
  const slash = clean.lastIndexOf("/");
  const name = slash >= 0 ? clean.slice(slash + 1) : clean;
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function normalizePath(target: string): string {
  let p = target.replace(/^\.\//, "").replace(/^\/+/, "");
  const markers = [".git/", "package.json", "go.mod", "Cargo.toml", "pyproject.toml"];
  for (const marker of markers) {
    const idx = p.indexOf(marker);
    if (idx >= 0) {
      const beforeMarker = p.slice(0, idx).replace(/\/$/, "");
      const lastSlash = beforeMarker.lastIndexOf("/");
      if (lastSlash >= 0) {
        p = p.slice(lastSlash + 1);
      } else {
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
  return normalized.includes(`/${dir}/`) || normalized.startsWith(`${dir}/`) || normalized === dir;
}

function denialMessage(agent: string, scope: { dir: string; exts: string[] }, target: string): string {
  return (
    `blocked by scope-guard: agent "${agent}" may only modify files under "${scope.dir}" ` +
    `with extensions ${scope.exts.join(", ")}, but the target was "${target}". ` +
    `Delegate to the agent that owns this stack, or report the need to the orchestrator.`
  );
}

describe("scope-guard helpers", () => {
  describe("extensionOf", () => {
    it("extracts extension from path", () => {
      assert.strictEqual(extensionOf("src/main.go"), ".go");
      assert.strictEqual(extensionOf("interface/web/app.tsx"), ".tsx");
      assert.strictEqual(extensionOf("database/schema.sql"), ".sql");
    });
    it("handles query strings and fragments", () => {
      assert.strictEqual(extensionOf("file.ts?query=1"), ".ts");
      assert.strictEqual(extensionOf("file.ts#section"), ".ts");
    });
    it("returns empty for no extension", () => {
      assert.strictEqual(extensionOf("README"), "");
      assert.strictEqual(extensionOf("file"), "");
    });
  });

  describe("normalizePath", () => {
    it("removes leading ./ and /", () => {
      assert.strictEqual(normalizePath("./src/file.ts"), "src/file.ts");
      assert.strictEqual(normalizePath("/src/file.ts"), "src/file.ts");
    });
    it("extracts project-relative path when .git/ is present", () => {
      const result = normalizePath("/home/user/project/.git/config");
      assert.strictEqual(result, "project/.git/config");
    });
    it("extracts project-relative path when package.json is present", () => {
      const result = normalizePath("/home/user/project/package.json");
      assert.strictEqual(result, "project/package.json");
    });
    it("returns as-is when no project marker found", () => {
      const result = normalizePath("/home/user/random/path/file.ts");
      assert.strictEqual(result, "home/user/random/path/file.ts");
    });
  });

  describe("isInsideScope", () => {
    it("allows core files for core-impl", () => {
      assert.ok(isInsideScope("core/main.go", STACK_SCOPES["core-impl"]));
      assert.ok(isInsideScope("core/utils.go", STACK_SCOPES["core-impl"]));
    });
    it("allows web files for web-impl", () => {
      assert.ok(isInsideScope("interface/web/app.tsx", STACK_SCOPES["web-impl"]));
      assert.ok(isInsideScope("interface/web/styles.css", STACK_SCOPES["web-impl"]));
    });
    it("denies wrong extension", () => {
      assert.ok(!isInsideScope("core/main.ts", STACK_SCOPES["core-impl"]));
    });
    it("denies wrong directory", () => {
      assert.ok(!isInsideScope("web/main.go", STACK_SCOPES["core-impl"]));
    });
  });

  describe("KNOWN_TOOLS", () => {
    it("contains standard tools", () => {
      assert.ok(KNOWN_TOOLS.has("read"));
      assert.ok(KNOWN_TOOLS.has("edit"));
      assert.ok(KNOWN_TOOLS.has("shell"));
    });
    it("contains delegation tools", () => {
      assert.ok(KNOWN_TOOLS.has("delegation_spec"));
      assert.ok(KNOWN_TOOLS.has("delegation_report"));
      assert.ok(KNOWN_TOOLS.has("delegation_receipt"));
    });
    it("contains memory tools", () => {
      assert.ok(KNOWN_TOOLS.has("memory_store"));
      assert.ok(KNOWN_TOOLS.has("memory_recall"));
    });
  });

  describe("denialMessage", () => {
    it("formats message correctly", () => {
      const msg = denialMessage("core-impl", STACK_SCOPES["core-impl"], "web/app.tsx");
      assert.ok(msg.includes("core-impl"));
      assert.ok(msg.includes("core/"));
      assert.ok(msg.includes(".go"));
      assert.ok(msg.includes("web/app.tsx"));
    });
  });
});