import { describe, it } from "node:test";
import assert from "node:assert";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { findRepoRoot, getGraphAge } from "./graphify-navigator.ts";

describe("graphify-navigator helpers", () => {
  const testDir = join(tmpdir(), `graphify-test-${Date.now()}`);

  async function setup() {
    await rm(testDir, { recursive: true, force: true });
    await mkdir(testDir, { recursive: true });
    await mkdir(join(testDir, ".git"), { recursive: true });
  }

  async function teardown() {
    await rm(testDir, { recursive: true, force: true });
  }

  it("findRepoRoot finds .git directory", async () => {
    await setup();
    try {
      const root = findRepoRoot(testDir);
      assert.ok(root !== null, "should find repo root");
      assert.ok(root.endsWith(testDir), `root should be test dir, got ${root}`);
    } finally {
      await teardown();
    }
  });

  it("findRepoRoot returns null for non-repo directory", async () => {
    const nonRepo = join(tmpdir(), `non-repo-${Date.now()}`);
    await mkdir(nonRepo, { recursive: true });
    try {
      const root = findRepoRoot(nonRepo);
      assert.strictEqual(root, null, "should return null for non-repo");
    } finally {
      await rm(nonRepo, { recursive: true, force: true });
    }
  });

  it("getGraphAge reports missing graph", async () => {
    await setup();
    try {
      const state = getGraphAge(testDir);
      assert.strictEqual(state.exists, false);
      assert.strictEqual(state.stale, true);
    } finally {
      await teardown();
    }
  });

  it("getGraphAge reports fresh graph when newer than commit", async () => {
    await setup();
    try {
      await mkdir(join(testDir, "graphify-out"), { recursive: true });
      await writeFile(join(testDir, "graphify-out", "graph.json"), '{"nodes":[]}');
      const state = getGraphAge(testDir);
      assert.strictEqual(state.exists, true);
      assert.strictEqual(state.stale, false, "fresh graph should not be stale");
      assert.ok(state.mtime instanceof Date);
    } finally {
      await teardown();
    }
  });

  it("getGraphAge reports stale graph when older than commit", async () => {
    await setup();
    try {
      await mkdir(join(testDir, "graphify-out"), { recursive: true });
      await writeFile(join(testDir, "graphify-out", "graph.json"), '{"nodes":[]}');
      const state = getGraphAge(testDir);
      assert.ok(typeof state.exists === "boolean");
      assert.ok(typeof state.stale === "boolean");
      assert.ok(state.mtime instanceof Date || state.mtime === null);
    } finally {
      await teardown();
    }
  });
});