import { describe, it } from "node:test";
import assert from "node:assert";
import {
  targetOf,
  missingRequiredIdentifiers,
  validateCriteria,
  validateAllowedFiles,
  validateGateCommand,
  isSpecExpired,
} from "./delegation.ts";

describe("targetOf", () => {
  it("extracts filePath", () => {
    assert.strictEqual(targetOf({ filePath: "src/a.ts" }), "src/a.ts");
  });
  it("extracts path", () => {
    assert.strictEqual(targetOf({ path: "src/b.ts" }), "src/b.ts");
  });
  it("extracts file", () => {
    assert.strictEqual(targetOf({ file: "src/c.ts" }), "src/c.ts");
  });
  it("returns undefined for non-objects", () => {
    assert.strictEqual(targetOf(null), undefined);
    assert.strictEqual(targetOf("string"), undefined);
    assert.strictEqual(targetOf({}), undefined);
  });
});

describe("missingRequiredIdentifiers", () => {
  it("returns empty when all identifiers are present", () => {
    assert.deepStrictEqual(
      missingRequiredIdentifiers("export const Foo = 1; class Bar {}", [
        "Foo",
        "Bar",
      ]),
      []
    );
  });
  it("returns missing identifiers", () => {
    assert.deepStrictEqual(
      missingRequiredIdentifiers("export const Foo = 1;", ["Foo", "Bar"]),
      ["Bar"]
    );
  });
  it("returns empty for empty required", () => {
    assert.deepStrictEqual(missingRequiredIdentifiers("anything", []), []);
  });
});

describe("validateCriteria", () => {
  it("accepts valid criteria", () => {
    assert.strictEqual(
      validateCriteria([
        { criterion: "x", verdict: "PASS", evidence: "file.ts:1" },
      ]),
      true
    );
  });
  it("rejects empty array", () => {
    assert.strictEqual(validateCriteria([]), false);
  });
  it("rejects non-array", () => {
    assert.strictEqual(validateCriteria(null), false);
    assert.strictEqual(validateCriteria(undefined), false);
    assert.strictEqual(validateCriteria("string"), false);
  });
  it("rejects entry missing criterion", () => {
    assert.strictEqual(
      validateCriteria([{ verdict: "PASS", evidence: "e" }]),
      false
    );
  });
  it("rejects entry missing verdict", () => {
    assert.strictEqual(
      validateCriteria([{ criterion: "x", evidence: "e" }]),
      false
    );
  });
  it("rejects entry missing evidence", () => {
    assert.strictEqual(
      validateCriteria([{ criterion: "x", verdict: "PASS" }]),
      false
    );
  });
});

describe("validateAllowedFiles", () => {
  it("returns empty when all files are allowed", () => {
    assert.deepStrictEqual(
      validateAllowedFiles(["src/a.ts", "src/b.ts"], ["src/"]),
      []
    );
  });
  it("returns unauthorized files", () => {
    assert.deepStrictEqual(
      validateAllowedFiles(["src/a.ts", "etc/passwd"], ["src/"]),
      ["etc/passwd"]
    );
  });
  it("returns empty when allowedFiles is undefined", () => {
    assert.deepStrictEqual(validateAllowedFiles(["anything"], undefined), []);
  });
  it("returns empty when allowedFiles is empty", () => {
    assert.deepStrictEqual(validateAllowedFiles(["anything"], []), []);
  });
});

describe("validateGateCommand", () => {
  it("returns undefined when commands match", () => {
    assert.strictEqual(validateGateCommand("make build", "make build"), undefined);
  });
  it("returns undefined when specGateCommand is undefined", () => {
    assert.strictEqual(validateGateCommand("anything", undefined), undefined);
  });
  it("returns mismatch message when commands differ", () => {
    assert.strictEqual(
      validateGateCommand("make test", "make build"),
      'gateCommand "make test" does not match spec "make build"'
    );
  });
});

describe("isSpecExpired", () => {
  const now = Date.now();
  it("returns false when no ttlMs", () => {
    assert.strictEqual(isSpecExpired({ createdAt: now }), false);
  });
  it("returns false when within ttl", () => {
    assert.strictEqual(
      isSpecExpired({ createdAt: now - 1000, ttlMs: 60_000 }),
      false
    );
  });
  it("returns true when past ttl", () => {
    assert.strictEqual(
      isSpecExpired({ createdAt: now - 100_000, ttlMs: 60_000 }),
      true
    );
  });
});
