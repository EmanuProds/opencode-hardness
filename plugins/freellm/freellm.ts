import { Plugin } from "@opencode/plugin";

/**
 * FreeLLM OpenCode plugin — publishes live FreeLLMAPI models into the
 * OpenCode provider catalog via `ctx.provider.transform`.
 *
 * Discovers models from `GET <baseURL>/v1/models` and publishes them under
 * the `freellm` provider id (e.g. `freellm/auto`, `freellm/gpt-4o`, …).
 *
 * Credentials are resolved in this order:
 *  1. Credential connected via OpenCode integration (`ctx.integration.connection`)
 *  2. `apiKey` in the plugin options
 *  3. `FREELLM_API_KEY` environment variable
 *
 * The plugin does NOT modify opencode.json. It uses the OpenCode v2
 * `provider.transform` / `integration.transform` APIs, exactly like
 * `@omniroute/opencode-plugin-v2`.
 */

const PLUGIN_ID = "freellm";
const DEFAULT_BASE_URL = "http://127.0.0.1:31415";
const ENV_API_KEY = "FREELLM_API_KEY";
const DEFAULT_TTL_MS = 300_000; // 5 minutes
const UNREACHABLE_COOLDOWN_MS = 15_000;

interface FreeLLMModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  name?: string;
  context_window?: number | null;
  context_length?: number | null;
  available?: boolean;
  unavailable_reason?: string | null;
  execution_status?: string;
  supported_parameters?: string[];
}

interface FreeLLMModelsResponse {
  object?: string;
  data?: FreeLLMModel[];
}

interface PluginOptions {
  providerId?: string;
  baseURL?: string;
  apiKey?: string;
  displayName?: string;
  timeoutMs?: number;
  logLevel?: "error" | "warn" | "info" | "debug";
  startupDebug?: boolean;
  modelCacheTtlMs?: number;
  visibleModels?: string[];
  hiddenModels?: string[];
  providersAllow?: string[];
  usableOnly?: boolean;
  freeOnly?: boolean;
  toolsOnly?: boolean;
  visionOnly?: boolean;
}

interface ResolvedOptions {
  providerId: string;
  baseURL: string;
  apiKey: string;
  displayName: string;
  timeoutMs: number;
  logLevel: "error" | "warn" | "info" | "debug";
  modelCacheTtlMs: number;
  visibleModels?: string[];
  hiddenModels?: string[];
  providersAllow?: string[];
  usableOnly: boolean;
  freeOnly: boolean;
  toolsOnly: boolean;
  visionOnly: boolean;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Fetchers                                                           */
/* ------------------------------------------------------------------ */

async function fetchFreeLLMModels(
  baseURL: string,
  apiKey: string,
  timeoutMs: number
): Promise<FreeLLMModel[]> {
  if (!apiKey) throw new Error("[freellm] apiKey required to fetch /v1/models");
  if (!baseURL) throw new Error("[freellm] baseURL required to fetch /v1/models");

  const trimmed = trimTrailingSlashes(baseURL);
  const url = /\/v\d+$/.test(trimmed) ? `${trimmed}/models` : `${trimmed}/v1/models`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`[freellm] GET ${url} failed: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as FreeLLMModelsResponse;
    const rawList = Array.isArray(body.data) ? body.data : [];
    const out: FreeLLMModel[] = [];
    for (const r of rawList) {
      if (r && typeof r === "object" && typeof r.id === "string") {
        out.push(r);
      }
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Credentials                                                        */
/* ------------------------------------------------------------------ */

async function resolveApiKey(
  ctx: { integration?: { connection?: { active?: (id: string) => Promise<unknown>; resolve?: (active: unknown) => Promise<unknown> } } },
  integrationID: string,
  optionKey: string | undefined,
  log: { warn: (msg: string) => void }
): Promise<{ key: string; origin: "connection" | "option" | "env" | "missing" }> {
  // 1. Stored credential via OpenCode integration
  const connection = ctx.integration?.connection;
  if (connection?.active && connection?.resolve) {
    try {
      const active = await connection.active(integrationID);
      if (active !== undefined) {
        const credential = await connection.resolve(active);
        if (credential && typeof credential === "object" && "type" in credential && (credential as { type?: string }).type === "key") {
          const key = (credential as { key?: string }).key;
          if (typeof key === "string" && key.length > 0) {
            return { key, origin: "connection" };
          }
        }
      }
    } catch (err) {
      log.warn(`[freellm] could not read the stored credential: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Option
  if (optionKey && optionKey.length > 0) {
    return { key: optionKey, origin: "option" };
  }

  // 3. Environment variable
  const fromEnv = process.env[ENV_API_KEY];
  if (fromEnv && fromEnv.length > 0) {
    return { key: fromEnv, origin: "env" };
  }

  return { key: "", origin: "missing" };
}

/* ------------------------------------------------------------------ */
/* Logger                                                             */
/* ------------------------------------------------------------------ */

function createLogger(level: "error" | "warn" | "info" | "debug") {
  const levels: Record<string, number> = { error: 0, warn: 1, info: 2, debug: 3 };
  const current = levels[level] ?? 1;
  return {
    error: (msg: string, ...args: unknown[]) => {
      if (current >= 0) console.error(`[freellm] [ERROR] ${msg}`, ...args);
    },
    warn: (msg: string, ...args: unknown[]) => {
      if (current >= 1) console.warn(`[freellm] [WARN] ${msg}`, ...args);
    },
    info: (msg: string, ...args: unknown[]) => {
      if (current >= 2) console.info(`[freellm] [INFO] ${msg}`, ...args);
    },
    debug: (msg: string, ...args: unknown[]) => {
      if (current >= 3) console.debug(`[freellm] [DEBUG] ${msg}`, ...args);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Plugin                                                             */
/* ------------------------------------------------------------------ */

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const parsed: PluginOptions = (ctx.options as PluginOptions) ?? {};
    const providerId = parsed.providerId ?? PLUGIN_ID;
    const baseURL = parsed.baseURL ?? DEFAULT_BASE_URL;
    const displayName = parsed.displayName ?? "FreeLLM";
    const timeoutMs = parsed.timeoutMs ?? 10_000;
    const logLevel = parsed.logLevel ?? "warn";
    const modelCacheTtlMs = parsed.modelCacheTtlMs ?? DEFAULT_TTL_MS;
    const log = createLogger(logLevel);

    const resolved: ResolvedOptions = {
      providerId,
      baseURL,
      apiKey: "",
      displayName,
      timeoutMs,
      logLevel,
      modelCacheTtlMs,
      visibleModels: parsed.visibleModels,
      hiddenModels: parsed.hiddenModels,
      providersAllow: parsed.providersAllow,
      usableOnly: parsed.usableOnly ?? false,
      freeOnly: parsed.freeOnly ?? false,
      toolsOnly: parsed.toolsOnly ?? false,
      visionOnly: parsed.visionOnly ?? false,
    };

    log.info(`[freellm] init providerId=${providerId}`);

    let apiKeyOrigin: "option" | "env" | "missing" = "missing";
    let credentialChecked = false;

    const ensureCredential = async () => {
      if (credentialChecked && apiKeyOrigin !== "missing") return;
      const next = await resolveApiKey(ctx, providerId, parsed.apiKey, log);
      resolved.apiKey = next.key;
      apiKeyOrigin = next.origin as "option" | "env" | "missing";
      if (!credentialChecked && next.origin === "missing") {
        log.warn(
          `[freellm] no API key for "${providerId}": the catalog will be empty. ` +
            `Connect the integration from opencode, set "apiKey" in the plugin options, ` +
            `or export ${ENV_API_KEY}.`
        );
      } else if (next.origin !== "missing") {
        log.info(`[freellm] API key picked up from the ${next.origin} source`);
      }
      credentialChecked = true;
    };

    // In-memory catalog state
    const state = {
      entries: new Map<string, FreeLLMModel[]>(),
      fingerprint: "" as string | undefined,
      unreachableUntil: 0 as number,
    };

    const cacheKey = `${baseURL}::${providerId}`;

    const fetchModelsSafe = async (): Promise<FreeLLMModel[]> => {
      try {
        return await fetchFreeLLMModels(resolved.baseURL, resolved.apiKey, timeoutMs);
      } catch (err) {
        log.warn(
          `[freellm] models fetch failed, publishing empty catalog: ${err instanceof Error ? err.message : String(err)}`
        );
        return [];
      }
    };

    async function refreshSnapshot(): Promise<FreeLLMModel[]> {
      const models = await fetchModelsSafe();
      const previous = state.entries.get(cacheKey);

      if (models.length === 0) {
        state.unreachableUntil = Date.now() + UNREACHABLE_COOLDOWN_MS;
      }

      if (models.length > 0) {
        state.entries.set(cacheKey, models);
      }

      return models;
    }

    function loadSnapshot(): Promise<FreeLLMModel[]> {
      const now = Date.now();
      const hit = state.entries.get(cacheKey);
      if (hit && hit.length > 0 && now < state.unreachableUntil) {
        return Promise.resolve(hit);
      }
      if (now >= state.unreachableUntil) {
        state.unreachableUntil = 0;
      }
      const snapshot = refreshSnapshot();
      return Promise.resolve(snapshot);
    }

    // Build the OpenCode provider payload from collected models
    function buildProviderPayload(models: FreeLLMModel[]) {
      const X = resolved.providerId;
      const info = {
        id: X,
        name: resolved.displayName,
        activation: "enabled" as const,
        package: "@ai-sdk/openai-compatible",
        settings: {
          baseURL: ensureV1Suffix(resolved.baseURL),
          apiKey: resolved.apiKey,
        },
        integrationID: X,
      };

      const visibleFilter = compileModelListFilter(resolved.visibleModels);
      const hiddenFilter = compileModelListFilter(resolved.hiddenModels);

      const mapped = models
        .filter((m) => passesModelAllowlist(m.id, visibleFilter, hiddenFilter))
        .map((m) => {
          const isFree = m.available === false && m.unavailable_reason === "no_key";
          const displayName = buildModelDisplayName({
            rawId: m.id,
            enrichmentName: m.name,
            isFree,
            freeType: m.unavailable_reason ?? null,
            providerDisplayName: undefined,
            providerAlias: undefined,
          });

          // Map supported_parameters to OpenCode model capabilities
          const supportsTools = m.supported_parameters?.includes("tools") ?? false;
          const supportsVision = m.supported_parameters?.some((p) =>
            /image|vision|vl/i.test(p)
          ) ?? false;

          return {
            id: `${X}/${m.id}`,
            name: displayName,
            contextWindow: m.context_window ?? undefined,
            maxTokens: m.context_length ?? undefined,
            supportedParameters: m.supported_parameters ?? [],
            supportsTools,
            supportsVision,
            isFree,
            available: m.available ?? false,
            unavailableReason: m.unavailable_reason ?? undefined,
            executionStatus: m.execution_status ?? undefined,
            api: {
              npm: "@ai-sdk/openai-compatible",
              baseURL: ensureV1Suffix(resolved.baseURL),
              apiKey: resolved.apiKey,
            },
            providerID: X,
          } as Record<string, unknown>;
        });

      return { info, models: mapped };
    }

    let latest: ReturnType<typeof buildProviderPayload> | undefined;

    const refreshAndPublish = async () => {
      await ensureCredential();
      const models = await loadSnapshot();
      const payload = buildProviderPayload(models);
      latest = payload;

      const fingerprint = JSON.stringify(
        models.map((m) => `${m.id}:${m.available}:${m.unavailable_reason}`).sort()
      );
      const changed = state.fingerprint !== undefined && state.fingerprint !== fingerprint;
      state.fingerprint = fingerprint;

      if (changed) {
        try {
          await ctx.provider.reload?.();
        } catch (err) {
          log.warn(
            `[freellm] provider reload failed, keeping current catalog: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    };

    // Initial publish
    await refreshAndPublish();

    // Register provider transform — publishes models into OpenCode catalog
    const providerRegistration = ctx.provider.transform((editor) => {
      if (latest !== undefined) {
        try {
          editor.add(latest);
        } catch (err) {
          log.warn(
            `[freellm] catalog publish failed: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    });

    // Register integration transform — enables "Connect API key" action
    let integrationRegistration;
    if (typeof ctx.integration?.transform === "function") {
      try {
        integrationRegistration = ctx.integration.transform((draft: any) => {
          draft.update(providerId, (integration: any) => {
            integration.name = resolved.displayName;
          });
          draft.method.update({
            integrationID: providerId,
            method: { type: "key", label: "API key" },
          });
          draft.method.update({
            integrationID: providerId,
            method: { type: "env", names: [ENV_API_KEY] },
          });
        });
      } catch (err) {
        log.warn(
          `[freellm] host refused the integration hook: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    await providerRegistration;
    if (integrationRegistration !== undefined) {
      try {
        await integrationRegistration;
      } catch (err) {
        log.warn(
          `[freellm] integration registration failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    log.info(`[freellm] plugin ready, provider ${providerId} registered`);
  },
});