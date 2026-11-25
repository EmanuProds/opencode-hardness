import { describe, it } from "node:test";
import assert from "node:assert";
import { readFile } from "node:fs/promises";

/**
 * Testes de integração contra o FreeLLMAPI real.
 * Faz fetch HTTP direto para http://127.0.0.1:31415/v1/models
 * usando a api key armazenada em ~/.config/opencode/secrets/freellm.key
 */

const API_KEY_PATH = `${process.env.HOME ?? "/home/emanuel"}/.config/opencode/secrets/freellm.key`;
const BASE_URL = "http://127.0.0.1:31415";

async function loadApiKey(): Promise<string> {
  const contents = await readFile(API_KEY_PATH, "utf8");
  return contents.trim();
}

async function fetchModels(apiKey: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${BASE_URL}/v1/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    const body = (await res.json()) as { object?: string; data?: unknown[] };
    return { status: res.status, body, ok: res.ok };
  } finally {
    clearTimeout(timer);
  }
}

function assertIsFreeLLMModel(entry: unknown): asserts entry is {
  id: string;
  name?: string | null;
  context_window?: number | null;
  available?: boolean | null;
  unavailable_reason?: string | null;
  supported_parameters?: string[];
} {
  assert.ok(entry, "model entry should exist");
  assert.ok(typeof entry === "object", "model entry should be an object");
  const m = entry as Record<string, unknown>;
  assert.ok(typeof m.id === "string" && m.id.length > 0, "model.id should be a non-empty string");
  assert.ok(
    typeof m.supported_parameters === "undefined" || Array.isArray(m.supported_parameters),
    "model.supported_parameters should be an array when present"
  );
}

describe("FreeLLMAPI integration", () => {
  it("loads api key from secrets file", async () => {
    const key = await loadApiKey();
    assert.strictEqual(typeof key, "string");
    assert.ok(key.length > 0, "api key should not be empty");
    assert.ok(
      key.startsWith("freellmapi-"),
      `api key should start with 'freellmapi-', got: ${key.slice(0, 20)}...`
    );
  });

  it("GET /v1/models returns 200 with a model list", async () => {
    const apiKey = await loadApiKey();
    const { status, body, ok } = await fetchModels(apiKey);
    assert.strictEqual(ok, true, `expected 2xx, got ${status}`);
    assert.strictEqual(status, 200, `expected status 200, got ${status}`);
    assert.ok(body, "response body should exist");
    assert.strictEqual(body.object, "list", `expected object 'list', got ${body.object}`);
    assert.ok(Array.isArray(body.data), "response.data should be an array");
    assert.ok(body.data.length > 0, "response.data should contain at least one model");
  });

  it("every model entry has required fields", async () => {
    const apiKey = await loadApiKey();
    const { body } = await fetchModels(apiKey);
    const data = body?.data ?? [];
    for (const entry of data) {
      assertIsFreeLLMModel(entry);
    }
  });

  it("contains known models from the catalog", async () => {
    const apiKey = await loadApiKey();
    const { body } = await fetchModels(apiKey);
    const ids = (body?.data ?? []).map((e) => (e as { id?: unknown }).id).filter(
      (id): id is string => typeof id === "string"
    );
    assert.ok(
      ids.includes("auto"),
      `expected 'auto' in catalog, got ${ids.slice(0, 10)}...`
    );
    assert.ok(
      ids.includes("fusion"),
      `expected 'fusion' in catalog, got ${ids.slice(0, 10)}...`
    );
    assert.ok(
      ids.length > 50,
      `expected a large catalog, got ${ids.length} models`
    );
  });

  it("models have name when present", async () => {
    const apiKey = await loadApiKey();
    const { body } = await fetchModels(apiKey);
    const data = body?.data ?? [];
    const auto = data.find((e) => (e as { id?: string }).id === "auto");
    assert.ok(auto, "model 'auto' should exist");
    assertIsFreeLLMModel(auto);
    assert.ok(
      typeof auto.name === "string" && auto.name.length > 0,
      "auto should have a name"
    );
  });

  it("some models declare supported_parameters", async () => {
    const apiKey = await loadApiKey();
    const { body } = await fetchModels(apiKey);
    const data = body?.data ?? [];
    const withTools = data.filter(
      (e) => {
        const m = e as { supported_parameters?: unknown[] };
        return (
          Array.isArray(m.supported_parameters) &&
          m.supported_parameters.length > 0
        );
      }
    );
    assert.ok(
      withTools.length > 0,
      "at least some models should declare supported_parameters"
    );
    const toolModels = withTools.filter(
      (e) => {
        const m = e as { supported_parameters?: string[] };
        return (
          m.supported_parameters!.includes("tools") ||
          m.supported_parameters!.includes("tool_choice")
        );
      }
    );
    assert.ok(
      toolModels.length > 0,
      "at least some models should support tool-related parameters"
    );
  });

  it("distinguishes available vs unavailable models", async () => {
    const apiKey = await loadApiKey();
    const { body } = await fetchModels(apiKey);
    const data = body?.data ?? [];
    const available = data.filter((e) => (e as { available?: boolean }).available === true);
    const unavailable = data.filter((e) => (e as { available?: boolean }).available === false);
    assert.ok(available.length > 0, "should have at least one available model");
    for (const m of unavailable) {
      assertIsFreeLLMModel(m);
      if (m.available === false) {
        assert.ok(
          typeof m.unavailable_reason === "string" && m.unavailable_reason.length > 0,
          `unavailable model ${m.id} should have unavailable_reason`
        );
      }
    }
  });
});
