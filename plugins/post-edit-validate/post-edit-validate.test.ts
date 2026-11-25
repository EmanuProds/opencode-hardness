import { describe, it } from "node:test";
import assert from "node:assert";

const DEFAULT_GATE_COMMANDS: Record<string, string> = {
  "contracts/": "make contracts-lint",
  "core/": "cd core && go build ./... && go vet ./...",
  "interface/web/": "cd interface/web && npm run build && npm run lint",
  "database/": "cd database/sqlc && sqlc diff && sqlc vet",
};

const PROJECT_MARKERS = [".git/", "package.json", "go.mod", "Cargo.toml", "pyproject.toml"];

function findProjectRootFromPath(target: string): string | null {
  let p = target.replace(/^\.\//, "").replace(/^\/+/, "");
  for (const marker of PROJECT_MARKERS) {
    const idx = p.indexOf(marker);
    if (idx >= 0) {
      const upToMarker = p.slice(0, idx);
      if (marker.endsWith("/")) {
        const markerDirPath = upToMarker;
        const lastSlash = markerDirPath.lastIndexOf("/");
        if (lastSlash >= 0) {
          return markerDirPath.slice(0, lastSlash + 1);
        }
        return "";
      } else {
        const lastSlash = upToMarker.lastIndexOf("/");
        if (lastSlash >= 0) {
          return upToMarker.slice(0, lastSlash + 1);
        }
        return "";
      }
    }
  }
  return null;
}

function getProjectRelativePath(target: string): string {
  let p = target.replace(/^\.\//, "").replace(/^\/+/, "");
  const projectRoot = findProjectRootFromPath(p);
  if (projectRoot) {
    if (p.startsWith(projectRoot)) {
      return p.slice(projectRoot.length);
    }
  }
  return p;
}

// Note: domainOf requires filesystem walking to find markers at the project root
// from arbitrary file paths. The string-only version below only works when the
// marker appears in the path string BEFORE the domain path (unnatural structure).
// In the real plugin, ctx.tool.hook receives the target file path and walks the
// actual filesystem to find the project root.
function domainOf(target: string): string | null {
  const relativePath = getProjectRelativePath(target);
  for (const prefix of Object.keys(DEFAULT_GATE_COMMANDS)) {
    if (relativePath.startsWith(prefix)) return prefix;
  }
  return null;
}

describe("post-edit-validate helpers", () => {
  describe("findProjectRootFromPath", () => {
    it("finds project root when .git/ is present", () => {
      const result = findProjectRootFromPath("/home/user/project/.git/config");
      assert.strictEqual(result, "home/user/project/");
    });
    it("finds project root when package.json is present", () => {
      const result = findProjectRootFromPath("/home/user/project/package.json");
      assert.strictEqual(result, "home/user/project/");
    });
    it("finds project root when go.mod is present", () => {
      const result = findProjectRootFromPath("/home/user/project/go.mod");
      assert.strictEqual(result, "home/user/project/");
    });
    it("returns null when no marker found", () => {
      const result = findProjectRootFromPath("/home/user/random/path/file.ts");
      assert.strictEqual(result, null);
    });
  });

  describe("getProjectRelativePath", () => {
    it("returns relative path when project root found via .git/", () => {
      const result = getProjectRelativePath("/home/user/project/.git/config");
      assert.strictEqual(result, ".git/config");
    });
    it("returns relative path when project root found via package.json", () => {
      const result = getProjectRelativePath("/home/user/project/package.json");
      assert.strictEqual(result, "package.json");
    });
    it("returns full path when no project root found", () => {
      const result = getProjectRelativePath("/home/user/random/path/file.ts");
      assert.strictEqual(result, "home/user/random/path/file.ts");
    });
  });

  describe("domainOf (string-only, limited - for documentation)", () => {
    // Note: These tests demonstrate the LIMITATION of string-only domain detection.
    // The real plugin uses filesystem walking from the target file path.
    it("returns null for typical paths without marker in string", () => {
      // Without a marker in the path string, domainOf cannot detect the domain
      assert.strictEqual(domainOf("/home/user/project/contracts/schema.yaml"), null);
      assert.strictEqual(domainOf("/home/user/project/core/main.go"), null);
      assert.strictEqual(domainOf("/home/user/project/interface/web/app.tsx"), null);
      assert.strictEqual(domainOf("/home/user/project/database/sqlc/schema.sql"), null);
    });
    it("returns null for unknown domain", () => {
      assert.strictEqual(domainOf("/home/user/project/.git/config/unknown/file.ts"), null);
    });
  });
});