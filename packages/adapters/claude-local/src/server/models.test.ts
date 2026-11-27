import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { models as DIRECT_MODELS } from "../index.js";
import { listClaudeModels, resetClaudeModelsCacheForTests } from "./models.js";

const ENV_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "ANTHROPIC_BEDROCK_BASE_URL"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  resetClaudeModelsCacheForTests();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.unstubAllGlobals();
  resetClaudeModelsCacheForTests();
});

describe("retired Sonnet 4.5", () => {
  it("is absent from the fallback list and offers Sonnet 5.5", async () => {
    expect(DIRECT_MODELS.some((m) => m.id.startsWith("claude-sonnet-4-5"))).toBe(false);
    expect(DIRECT_MODELS.some((m) => m.id === "claude-sonnet-5-5")).toBe(true);
    const listed = await listClaudeModels();
    expect(listed.some((m) => m.id.includes("sonnet-4-5"))).toBe(false);
  });

  it("is absent from the Bedrock list", async () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = "1";
    const listed = await listClaudeModels();
    expect(listed.some((m) => m.id.includes("sonnet-4-5"))).toBe(false);
  });

  it("is filtered out of live discovery", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "claude-sonnet-4-5-20250929", display_name: "Claude Sonnet 4.5" },
              { id: "claude-sonnet-4-5", display_name: "Claude Sonnet 4.5" },
              { id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const listed = await listClaudeModels();
    expect(listed.some((m) => m.id.startsWith("claude-sonnet-4-5"))).toBe(false);
    expect(listed.some((m) => m.id === "claude-sonnet-5-5")).toBe(true);
  });
});
