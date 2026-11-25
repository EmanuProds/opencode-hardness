import { describe, it } from "node:test";
import assert from "node:assert";

// Test helpers copied from freellm.ts for unit testing
function trimTrailingSlashes(value: string): string {
  let i = value.length;
  while (i > 0 && value.charCodeAt(i - 1) === 47) i -= 1;
  return i === value.length ? value : value.slice(0, i);
}

function ensureV1Suffix(url: string): string {
  const trimmed = trimTrailingSlashes(url);
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function compileModelListFilter(list?: string[]): ((id: string) => boolean) | undefined {
  if (!list || list.length === 0) return undefined;
  const hasStar = list.includes("*");
  if (hasStar) return undefined;
  return (id: string) => {
    return list.some((pattern) => id === pattern || id.endsWith(pattern));
  };
}

function passesModelAllowlist(
  id: string,
  visibleFilter: ((id: string) => boolean) | undefined,
  hiddenFilter: ((id: string) => boolean) | undefined
): boolean {
  if (visibleFilter && !visibleFilter(id)) return false;
  if (hiddenFilter && hiddenFilter(id)) return false;
  return true;
}

function shortProviderLabel(_enrichment: { providerDisplayName?: string } | undefined): string | undefined {
  return undefined;
}

function buildModelDisplayName(params: {
  rawId: string;
  enrichmentName?: string | null;
  isFree?: boolean;
  freeType?: string | null;
  monthlyTokens?: number;
  creditTokens?: number;
  providerDisplayName?: string | null;
  providerAlias?: string | null;
}): string {
  const rawBase = (params.enrichmentName && params.enrichmentName.trim().length > 0
    ? params.enrichmentName
    : params.rawId).replace(/\s*\(free\)\s*$/i, "").replace(/[\s-]+free\s*$/i, "").trim();
  const wasFree = rawBase.length < params.rawId.trim().length;
  const isFree = !!params.isFree || wasFree;
  let baseName = rawBase;
  const label = shortProviderLabel(params.providerDisplayName ? { providerDisplayName: params.providerDisplayName } : undefined);
  if (label) {
    const prefix = `${label} - `;
    if (!baseName.startsWith(prefix)) {
      baseName = `${prefix}${baseName}`;
    }
  }
  if (isFree) {
    baseName = `[Free] ${baseName}`;
  }
  return baseName;
}

function fmtTokens(n: number): string {
  const TOKEN_UNITS: [number, string][] = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [scale, suffix] of TOKEN_UNITS) {
    if (n < scale) continue;
    const value = Number((n / scale).toFixed(1));
    if (value < 1e3) return `${value}${suffix}`;
  }
  return String(n);
}

function formatFreeBudget(params: {
  freeType?: string | null;
  monthlyTokens?: number;
  creditTokens?: number;
}): string {
  const { freeType, monthlyTokens = 0, creditTokens = 0 } = params;
  switch (freeType) {
    case "recurring-daily":
      return `${fmtTokens(monthlyTokens)} tokens/day`;
    case "recurring-monthly":
      return `${fmtTokens(monthlyTokens)} tokens/month`;
    case "recurring-credit":
      return `${fmtTokens(creditTokens)} credits`;
    case "recurring-uncapped":
      return "(uncapped)";
    case "one-time-initial":
      return `${fmtTokens(creditTokens)} credits (one-time)`;
    case "keyless":
      return "(keyless)";
    case "discontinued":
      return "(discontinued)";
    default:
      return `(${String(freeType ?? "unknown")})`;
  }
}

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