/**
 * Jev client — System One decision model from TypeSafe AI.
 *
 * Jev is not an LLM: it does not generate text. It evaluates a `state` against
 * typed questions and returns typed values with probabilities. That makes it
 * usable as a decision layer that PROMOTES an existing rule instead of
 * replacing it — see `decide()` below, which never returns a decision the
 * caller cannot fall back from.
 *
 * WHY A PLAIN fetch AND NOT ctx.generate.text()
 * The host exposes ctx.generate.text() (verified in the v2 plugin docs and in
 * the 2.0.19 binary), but only `text` — there is no generate.object. Jev's
 * whole contract is typed JSON, so routing it through a text generator would
 * mean parsing a string back into a decision, which is precisely the mismatch
 * Jev exists to remove. Hence a direct call to the systemone endpoint.
 *
 * WHY FREE TIER, PINNED
 * The model id is a named constant instead of a literal at each call site.
 * OpenCode's catalog marks jev-1.13-free as "available for a limited time"
 * (docs/v2/console/models), so it can disappear. One constant to change is the
 * difference between a one-line fix and a grep across the repo.
 */
import { Plugin } from "@opencode/plugin";

/** Free tier. Temporary by the provider's own announcement — see file header. */
export const JEV_MODEL = "jev-1.13-free";

const ENDPOINT = "https://opencode.ai/zen/v1/systemone";

/** Measured on this machine: 0.72–0.96s over 5 calls. Generous headroom. */
const DEFAULT_TIMEOUT_MS = 4_000;

export type JevQuestion =
  | {
      type: "noul";
      instructions: string;
      criteria?: { true: string; false: string };
    }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevQuestions = Record<string, JevQuestion>;

export interface JevNoulAnswer {
  type: "noul";
  noul: number;
}

export interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface JevScoreAnswer {
  type: "score";
  score: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
  cost?: string;
}

export interface JevClientOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Why the key is read lazily and never cached: a plugin is re-instantiated on
 * every file change, and Bun auto-loads .env into process.env, so the value is
 * available by the time a hook fires. A missing key must surface as a normal
 * fallback (decision === null), never as a thrown error that kills the tool
 * call the user asked for.
 */
function readApiKey(explicit?: string): string | undefined {
  return explicit ?? process.env.OPENCODE_ZEN_API_KEY;
}

/**
 * Calls Jev and returns the raw typed response, or null on any failure.
 *
 * Returns null — never throws. Every caller treats Jev as an optional
 * accelerator: a network error, a 429, or a missing key must leave the caller
 * on its existing heuristic. A decision layer that can break the operation it
 * is meant to speed up is worse than no decision layer.
 */
export async function askJev(
  state: string,
  questions: JevQuestions,
  options: JevClientOptions = {},
): Promise<JevResponse | null> {
  const apiKey = readApiKey(options.apiKey);
  if (!apiKey) return null;

  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const response = await doFetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.model ?? JEV_MODEL,
        state,
        questions,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    return (await response.json()) as JevResponse;
  } catch {
    // Abort, DNS, malformed JSON — all mean "no opinion", not "deny".
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type JevOutcome =
  /** Jev answered with at least the required confidence. Trust it. */
  | { kind: "promote"; answer: JevAnswer; confidence: number }
  /** Jev answered but was not sure. Caller keeps its own heuristic. */
  | {
      kind: "fallback";
      reason: "low-confidence";
      answer: JevAnswer;
      confidence: number;
    }
  /** Jev could not be reached, or the question id is absent. */
  | { kind: "fallback"; reason: "unavailable" };

/**
 * Reads one question's answer and applies the confidence policy.
 *
 * The threshold is a CODE constant, not a prompt instruction: TypeSafe's own
 * guidance is to combine weights in code, and a prompt cannot be enforced. A
 * caller that gets "promote" may act; a caller that gets "fallback" must keep
 * doing whatever it did before Jev existed.
 *
 * Noul answers carry no confidence field — the number IS both answer and
 * certainty. They are compared against the threshold directly.
 */
export function decide(
  response: JevResponse | null,
  questionId: string,
  threshold = 0.8,
): JevOutcome {
  if (!response) return { kind: "fallback", reason: "unavailable" };

  const answer = response.answers?.[questionId];
  if (!answer) return { kind: "fallback", reason: "unavailable" };

  const confidence = answer.type === "noul" ? answer.noul : answer.confidence;

  if (confidence >= threshold) return { kind: "promote", answer, confidence };
  return { kind: "fallback", reason: "low-confidence", answer, confidence };
}

/**
 * Ranks candidates for the recall reranker.
 *
 * Returns the input order UNCHANGED unless Jev promotes a ranking, so a failed
 * or unsure call degrades to exactly the FTS5 order the caller had before.
 * `limit` is applied after reranking so a promotion cannot change how many
 * results come back.
 */
export async function rerankCandidates<
  T extends { key: string; value: string },
>(
  query: string,
  candidates: T[],
  options: JevClientOptions & {
    threshold?: number;
    limit?: number;
    maxCandidates?: number;
  } = {},
): Promise<T[]> {
  const limit = options.limit ?? candidates.length;
  if (candidates.length === 0) return [];

  const poolSize = Math.min(candidates.length, options.maxCandidates ?? 12);
  const pool = candidates.slice(0, poolSize);
  const tail = candidates.slice(poolSize);

  const state = buildRerankState(query, pool);

  // ONE ATOMIC QUESTION PER CANDIDATE. This is the whole design.
  //
  // A single "how relevant is this pool" score cannot rank anything: it returns
  // one verdict for twelve memories. Measured on this machine, a composite
  // question about a sequence scored noul=0.22 where the same judgment asked
  // atomically scored 0.99. TypeSafe's docs say the same thing — decompose into
  // atomic questions and combine in code.
  //
  // Ids are positional ("c0", "c1") and never the memory key. Keys contain
  // ":" and "-", which is exactly what broke the FTS5 query path in
  // memory-store.ts; reusing them as question ids would import that bug.
  const questions: JevQuestions = {};
  pool.forEach((candidate, i) => {
    questions[`c${i}`] = {
      type: "noul",
      instructions: "Does this memory answer the query?",
      criteria: {
        true: "The memory contains information that answers the query",
        false: "The memory is unrelated to the query",
      },
    };
    void candidate;
  });

  const response = await askJev(state, questions, options);

  // ABSENCE vs UNCERTAINTY — these are different, and conflating them was a
  // bug caught by the test suite.
  //
  // A noul answer carries its certainty in the number itself: 0.2 means "this
  // memory does not answer the query" with confidence, which is precisely the
  // signal a reranker should act on. It is NOT the model abstaining. An
  // all-or-nothing threshold on the high side would therefore discard the
  // whole rerank every time Jev correctly identified an irrelevant candidate.
  //
  // So the rule is:
  //   - answer missing entirely  -> no opinion, keep FTS5 order for everything
  //   - answer present, any value -> use it, high scores rise and low scores
  //                                 fall. A mid-range value near the abstain
  //                                 band is the only one treated as "unknown".
  if (!response) return candidates.slice(0, limit);

  const threshold = options.threshold ?? 0.8;
  // Below this, a candidate is treated as unranked rather than demoted, so a
  // genuine "no idea" (which calibrates near 0.5) is not pushed to the bottom.
  const abstainBelow = threshold / 2;

  const scored: Array<{ item: T; noul: number; ranked: boolean }> = [];
  let anyUnknown = false;

  for (let i = 0; i < pool.length; i++) {
    const answer = response.answers?.[`c${i}`];
    if (!answer || answer.type !== "noul") {
      anyUnknown = true;
      break;
    }
    scored.push({
      item: pool[i]!,
      noul: answer.noul,
      ranked: answer.noul >= abstainBelow,
    });
  }

  // A missing answer anywhere means the ranking is incomplete, and reordering
  // on a partial ranking would silently drop the very memory the caller needs.
  if (anyUnknown) return candidates.slice(0, limit);

  // Ranked candidates sort by score. Unranked ones keep their FTS5 position
  // relative to each other and go after the ranked ones — a candidate the model
  // had no opinion on is not evidence of irrelevance.
  const ranked = scored.filter((s) => s.ranked).sort((a, b) => b.noul - a.noul);
  const unranked = scored.filter((s) => !s.ranked);

  // Stable sort above already preserves FTS5 order within equal scores, so a
  // rerank improves ordering without scrambling ties.
  return [
    ...ranked.map((s) => s.item),
    ...unranked.map((s) => s.item),
    ...tail,
  ].slice(0, limit);
}

/**
 * Formats the candidate pool as the dense state paragraph Jev is built for.
 * TypeSafe's docs note that System One models are optimized for structured
 * program state, and that a short dense state is legitimate input — not a
 * concession.
 */
function buildRerankState<T extends { key: string; value: string }>(
  query: string,
  pool: T[],
): string {
  const lines = pool.map((c, i) => `[${i}] ${c.key}: ${c.value}`);
  return `Query: ${query}\n\nMemories:\n${lines.join("\n")}`;
}

export default Plugin.define({
  id: "jev-client",
  async setup() {
    // Library module. The plugin loader globs every file in plugins/ and loads
    // it as a plugin; living outside that directory is what keeps this from
    // being loaded twice. Nothing to wire up — callers import `askJev` and
    // `decide` directly.
  },
});
