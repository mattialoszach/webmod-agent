import { afterEach, describe, expect, it, vi } from "vitest";
import { MockProvider } from "../src/agent/providers/MockProvider";
import { OpenAIProvider } from "../src/agent/providers/OpenAIProvider";
import type { AgentInput } from "../src/shared/types";

const input: AgentInput = {
  instruction: "Make the main heading red",
  url: "https://example.com",
  pageTitle: "Example",
  elements: [{ id: "wm_1", tag: "h1", role: "heading", text: "Example", viewport: "visible" }]
};

describe("AI providers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("supports the definition-of-done prompt without an API key", async () => {
    await expect(new MockProvider().generateOperations(input)).resolves.toEqual([
      { type: "setStyles", elementId: "wm_1", styles: { color: "red" } }
    ]);
  });

  it("rejects malformed real-provider output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: "not json" })
    }));
    await expect(new OpenAIProvider("test-key", "test-model").generateOperations(input))
      .rejects.toThrow("malformed JSON");
  });

  it("validates real-provider operations after parsing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: JSON.stringify({ operations: [{ type: "script", elementId: "wm_1" }] }) })
    }));
    await expect(new OpenAIProvider("test-key", "test-model").generateOperations(input)).rejects.toThrow();
  });
});
