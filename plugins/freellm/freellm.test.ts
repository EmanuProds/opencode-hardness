import { describe, it } from "node:test";
import assert from "node:assert";

import {
  trimTrailingSlashes,
  ensureV1Suffix,
  isHttpUrl,
  compileModelListFilter,
  passesModelAllowlist,
  buildModelDisplayName,
  fmtTokens,
  formatFreeBudget,
} from "./freellm.ts";

describe("trimTrailingSlashes", () => {
  it("removes trailing slashes", () => {
    assert.strictEqual(trimTrailingSlashes("http://127.0.0.1:31415/"), "http://127.0.0.1:31415");
    assert.strictEqual(trimTrailingSlashes("http://127.0.0.1:31415//"), "http://127.0.0.1:31415");
    assert.strictEqual(trimTrailingSlashes("http://127.0.0.1:31415"), "http://127.0.0.1:31415");
  });
});

describe("ensureV1Suffix", () => {
  it("adds /v1 when missing", () => {
    assert.strictEqual(ensureV1Suffix("http://127.0.0.1:31415"), "http://127.0.0.1:31415/v1");
  });
  it("keeps /v1 when present", () => {
    assert.strictEqual(ensureV1Suffix("http://127.0.0.1:31415/v1"), "http://127.0.0.1:31415/v1");
  });
});

describe("isHttpUrl", () => {
  it("accepts http and https", () => {
    assert.strictEqual(isHttpUrl("http://127.0.0.1:31415"), true);
    assert.strictEqual(isHttpUrl("https://example.com"), true);
  });
  it("rejects non-http", () => {
    assert.strictEqual(isHttpUrl("ftp://example.com"), false);
    assert.strictEqual(isHttpUrl("not-a-url"), false);
    assert.strictEqual(isHttpUrl(123), false);
  });
});

describe("compileModelListFilter", () => {
  it("returns undefined for empty list", () => {
    assert.strictEqual(compileModelListFilter([]), undefined);
    assert.strictEqual(compileModelListFilter(undefined), undefined);
  });
  it("returns undefined when list contains *", () => {
    assert.strictEqual(compileModelListFilter(["*"]), undefined);
  });
  it("matches exact id", () => {
    const f = compileModelListFilter(["gpt-4o"]);
    assert.strictEqual(f?.("gpt-4o"), true);
    assert.strictEqual(f?.("gpt-4o-mini"), false);
  });
  it("matches suffix", () => {
    const f = compileModelListFilter(["-mini"]);
    assert.strictEqual(f?.("gpt-4o-mini"), true);
    assert.strictEqual(f?.("gpt-4o"), false);
  });
});

describe("passesModelAllowlist", () => {
  it("passes when no filters", () => {
    assert.strictEqual(passesModelAllowlist("any-model", undefined, undefined), true);
  });
  it("respects visible filter", () => {
    const visible = compileModelListFilter(["gpt-4o"]);
    assert.strictEqual(passesModelAllowlist("gpt-4o", visible, undefined), true);
    assert.strictEqual(passesModelAllowlist("claude-3", visible, undefined), false);
  });
  it("respects hidden filter", () => {
    const hidden = compileModelListFilter(["-model"]);
    assert.strictEqual(passesModelAllowlist("gpt-4o", undefined, hidden), true);
    assert.strictEqual(passesModelAllowlist("legacy-model", undefined, hidden), false);
  });
  it("deny wins over allow", () => {
    const visible = compileModelListFilter(["gpt-4o"]);
    const hidden = compileModelListFilter(["gpt-4o"]);
    assert.strictEqual(passesModelAllowlist("gpt-4o", visible, hidden), false);
  });
});

describe("buildModelDisplayName", () => {
  it("uses raw id when no enrichment name", () => {
    assert.strictEqual(buildModelDisplayName({ rawId: "gpt-4o" }), "gpt-4o");
  });
  it("uses enrichment name when present", () => {
    assert.strictEqual(
      buildModelDisplayName({ rawId: "gpt-4o", enrichmentName: "GPT 4o" }),
      "GPT 4o"
    );
  });
  it("marks free models with [Free] prefix", () => {
    assert.strictEqual(
      buildModelDisplayName({ rawId: "auto", isFree: true }),
      "[Free] auto"
    );
  });
});

describe("fmtTokens", () => {
  it("formats small numbers", () => {
    assert.strictEqual(fmtTokens(500), "500");
  });
  it("formats thousands", () => {
    assert.strictEqual(fmtTokens(1500), "1.5K");
  });
  it("formats millions", () => {
    assert.strictEqual(fmtTokens(1_500_000), "1.5M");
  });
  it("formats billions", () => {
    assert.strictEqual(fmtTokens(1_500_000_000), "1.5B");
  });
});

describe("formatFreeBudget", () => {
  it("formats recurring-monthly", () => {
    assert.strictEqual(
      formatFreeBudget({ freeType: "recurring-monthly", monthlyTokens: 1_000_000 }),
      "1M tokens/month"
    );
  });
  it("formats keyless", () => {
    assert.strictEqual(formatFreeBudget({ freeType: "keyless" }), "(keyless)");
  });
  it("formats discontinued", () => {
    assert.strictEqual(formatFreeBudget({ freeType: "discontinued" }), "(discontinued)");
  });
});
