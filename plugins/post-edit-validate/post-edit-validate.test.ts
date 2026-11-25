import { describe, it } from "node:test";
import assert from "node:assert";

// Import pure helpers from the plugin module
import {
  findProjectRoot,
  normalizePath,
  domainOf,
  resolveProjectRoot,
  expandEnvVars,
  matchesIgnorePattern,
} from "./post-edit-validate.ts";

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

describe("findProjectRoot", () => {
  it("returns null for non-existent directory", () => {
    assert.strictEqual(findProjectRoot("/nonexistent/path"), null);
  });
});

describe("domainOf", () => {
  it("detects contracts domain from relative path", () => {
    assert.strictEqual(domainOf("contracts/schema.yaml"), "contracts/");
  });
  it("detects core domain from relative path", () => {
    assert.strictEqual(domainOf("core/main.go"), "core/");
  });
  it("detects web domain from relative path", () => {
    assert.strictEqual(domainOf("interface/web/app.tsx"), "interface/web/");
  });
  it("detects database domain from relative path", () => {
    assert.strictEqual(domainOf("database/sqlc/schema.sql"), "database/");
  });
  it("returns null for unknown domain", () => {
    assert.strictEqual(domainOf("unknown/file.ts"), null);
  });
  it("returns null for paths without domain prefix", () => {
    assert.strictEqual(domainOf("config/settings.json"), null);
  });
});

describe("resolveProjectRoot", () => {
  it("returns configured root when provided", () => {
    const result = resolveProjectRoot("/any/path", "/configured/root");
    assert.strictEqual(result, "/configured/root");
  });
  it("falls back to cwd when no marker found", () => {
    const result = resolveProjectRoot("/home/user/random/file.ts");
    assert.strictEqual(result, process.cwd());
  });
});

describe("expandEnvVars", () => {
  it("replaces {env:VAR} with environment value", () => {
    process.env.TEST_GATE_VAR = "my-value";
    const result = expandEnvVars("echo {env:TEST_GATE_VAR}");
    assert.strictEqual(result, "echo my-value");
    delete process.env.TEST_GATE_VAR;
  });
  it("leaves unknown vars empty", () => {
    const result = expandEnvVars("echo {env:NONEXISTENT_VAR_12345}");
    assert.strictEqual(result, "echo ");
  });
  it("leaves command unchanged when no env vars", () => {
    const result = expandEnvVars("go build ./...");
    assert.strictEqual(result, "go build ./...");
  });
});

describe("matchesIgnorePattern", () => {
  it("returns false for empty patterns", () => {
    assert.strictEqual(matchesIgnorePattern("src/file.ts", []), false);
  });
  it("matches suffix pattern (*.test.ts)", () => {
    assert.strictEqual(matchesIgnorePattern("src/component.test.ts", ["*.test.ts"]), true);
    assert.strictEqual(matchesIgnorePattern("src/component.ts", ["*.test.ts"]), false);
  });
  it("matches prefix pattern (node_modules/)", () => {
    assert.strictEqual(matchesIgnorePattern("node_modules/lodash/index.js", ["node_modules/"]), true);
    assert.strictEqual(matchesIgnorePattern("src/file.ts", ["node_modules/"]), false);
  });
  it("matches exact pattern", () => {
    assert.strictEqual(matchesIgnorePattern("README.md", ["README.md"]), true);
    assert.strictEqual(matchesIgnorePattern("readme.md", ["README.md"]), false);
  });
  it("matches substring pattern", () => {
    assert.strictEqual(matchesIgnorePattern("dist/bundle.js", ["dist/"]), true);
  });
});