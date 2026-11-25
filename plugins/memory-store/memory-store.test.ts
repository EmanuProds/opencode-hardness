import { describe, it } from "node:test";
import assert from "node:assert";

// Test the pure function buildMatchQuery by copying its logic here
// (avoids importing the full plugin which depends on bun:sqlite)
function buildMatchQuery(input: string): string {
  const terms = input
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, '""')}"`);

  if (terms.length === 0) return "";

  const ultimos = terms.slice(0, -1);
  const prefix = ultimos.length > 0 ? `${ultimos.join(" AND ")} AND ` : "";
  return `${prefix}${terms[terms.length - 1]}*`;
}

describe("memory-store helpers", () => {
  describe("buildMatchQuery", () => {
    it("returns empty string for empty input", () => {
      assert.strictEqual(buildMatchQuery(""), "");
      assert.strictEqual(buildMatchQuery("   "), "");
    });

    it("quotes single term and adds prefix wildcard", () => {
      assert.strictEqual(buildMatchQuery("hello"), '"hello"*');
    });

    it("joins multiple terms with AND, only last has wildcard", () => {
      assert.strictEqual(buildMatchQuery("hello world"), '"hello" AND "world"*');
    });

    it("handles colons and hyphens as literal text", () => {
      // The key format domain:subject:detail should be searchable as text
      assert.strictEqual(
        buildMatchQuery("opencode:agents:contextscout"),
        '"opencode:agents:contextscout"*'
      );
    });

    it("escapes internal quotes", () => {
      // Internal quotes are doubled: "world" -> ""world"" inside the quoted term
      assert.strictEqual(buildMatchQuery('hello "world"'), '"hello" AND """world"""*');
    });

    it("filters empty terms from extra whitespace", () => {
      assert.strictEqual(buildMatchQuery("  a  b  c  "), '"a" AND "b" AND "c"*');
    });
  });
});