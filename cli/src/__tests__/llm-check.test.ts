import { afterEach, describe, expect, it, vi } from "vitest";
import { llmCheck } from "../checks/llm-check.js";
import type { PaperclipConfig } from "../config/schema.js";

function claudeConfig(): PaperclipConfig {
  return { llm: { provider: "claude", apiKey: "sk-test" } } as unknown as PaperclipConfig;
}

function mockFetch(status: number) {
  const fn = vi.fn(async () => new Response("{}", { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("llmCheck (claude)", () => {
  it("validates the key against GET /v1/models and passes on 200", async () => {
    const fetchFn = mockFetch(200);
    const result = await llmCheck(claudeConfig());
    expect(result.status).toBe("pass");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/models");
    expect(init.method).toBeUndefined();
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({ "x-api-key": "sk-test", "anthropic-version": "2023-06-01" });
  });

  it("fails on 401", async () => {
    mockFetch(401);
    const result = await llmCheck(claudeConfig());
    expect(result.status).toBe("fail");
    expect(result.message).toContain("invalid (401)");
  });

  it("warns on any other status", async () => {
    mockFetch(500);
    const result = await llmCheck(claudeConfig());
    expect(result.status).toBe("warn");
    expect(result.message).toContain("500");
  });
});
