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
    await expect(new MockProvider().generatePlan(input)).resolves.toEqual({
      operations: [{ type: "setStyles", elementId: "wm_1", styles: { color: "red" } }],
      sources: []
    });
  });

  it("supports a direct background image URL in offline demo mode", async () => {
    await expect(new MockProvider().generatePlan({
      ...input,
      instruction: "Use https://images.example.com/duck.jpg as the background",
      selectedElementIds: ["wm_1"]
    })).resolves.toMatchObject({
      operations: [{
        type: "setBackgroundImage",
        elementId: "wm_1",
        src: "https://images.example.com/duck.jpg",
        fit: "cover",
        position: "center"
      }]
    });
  });

  it("applies an offline style change to every selected element", async () => {
    await expect(new MockProvider().generatePlan({
      ...input,
      instruction: "Make these red",
      elements: [
        ...input.elements,
        { id: "wm_2", tag: "p", role: "text", text: "Second", viewport: "visible" }
      ],
      selectedElementIds: ["wm_1", "wm_2"]
    })).resolves.toMatchObject({
      operations: [
        { type: "setStyles", elementId: "wm_1", styles: { color: "red" } },
        { type: "setStyles", elementId: "wm_2", styles: { color: "red" } }
      ]
    });
  });

  it("rejects malformed real-provider output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: "not json" })
    }));
    await expect(new OpenAIProvider("test-key", "test-model").generatePlan(input))
      .rejects.toThrow("malformed JSON");
  });

  it("validates real-provider operations after parsing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: JSON.stringify({ operations: [{ type: "script", elementId: "wm_1" }] }) })
    }));
    await expect(new OpenAIProvider("test-key", "test-model").generatePlan(input)).rejects.toThrow();
  });

  it("enables web and image search and returns visible sources", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text: "A suitable duck photograph was found.",
        output: [{
          type: "web_search_call",
          action: { sources: [{ url: "https://example.com/ducks", title: "Duck photographs" }] },
          results: [{
            type: "image_result",
            image_url: "https://cdn.example.com/duck.jpg",
            source_website_url: "https://example.com/ducks",
            caption: "A duck on a lake"
          }]
        }]
      })
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          operations: [{
            type: "setBackgroundImage",
            elementId: "wm_1",
            src: "https://cdn.example.com/duck.jpg",
            fit: "cover",
            position: "center"
          }]
        })
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(new OpenAIProvider("test-key", "test-model").generatePlan({
      ...input,
      instruction: "Take a duck picture as the wallpaper"
    })).resolves.toMatchObject({
      operations: [{ type: "setBackgroundImage", src: "https://cdn.example.com/duck.jpg" }],
      sources: [{ url: "https://example.com/ducks", title: "Duck photographs" }]
    });

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      tools?: Array<{ type?: string; search_content_types?: string[] }>;
      include?: string[];
    };
    expect(request.tools?.[0]).toMatchObject({
      type: "web_search",
      search_content_types: ["image", "text"]
    });
    expect((request as { tool_choice?: string }).tool_choice).toBe("required");
    expect(request.include).toContain("web_search_call.results");
    expect(request).not.toHaveProperty("text");

    const plannerRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      tools?: unknown;
      text?: { format?: { type?: string } };
      input?: Array<{ content?: string }>;
    };
    expect(plannerRequest).not.toHaveProperty("tools");
    expect(plannerRequest.text?.format?.type).toBe("json_object");
    expect(plannerRequest.input?.[1]?.content).toContain("webContext");
  });

  it("skips web search when the instruction supplies an image URL", async () => {
    const imageUrl = "https://media.example.com/duck.jpg";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          operations: [{
            type: "setBackgroundImage",
            elementId: "wm_1",
            src: imageUrl,
            fit: "cover",
            position: "center"
          }]
        })
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(new OpenAIProvider("test-key", "test-model").generatePlan({
      ...input,
      instruction: `Take this as the background: ${imageUrl}`
    })).resolves.toMatchObject({
      operations: [{ type: "setBackgroundImage", src: imageUrl }],
      sources: []
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      tools?: unknown;
      text?: { format?: { type?: string } };
    };
    expect(request).not.toHaveProperty("tools");
    expect(request.text?.format?.type).toBe("json_object");
  });

  it("treats replacing the current logo as image discovery", async () => {
    const imageUrl = "https://cdn.example.com/apple-logo.png";
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text: "An Apple logo image was found.",
        output: [{
          type: "web_search_call",
          results: [{
            type: "image_result",
            image_url: imageUrl,
            source_website_url: "https://example.com/apple-logo",
            caption: "Apple logo"
          }]
        }]
      })
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          operations: [{ type: "replaceImage", elementId: "wm_1", src: imageUrl }]
        })
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(new OpenAIProvider("test-key", "test-model").generatePlan({
      ...input,
      instruction: "Take the Apple logo instead of the current logo",
      elements: [{
        id: "wm_1",
        tag: "img",
        role: "img",
        alt: "Current company logo",
        src: "https://example.com/current-logo.png",
        classHints: ["site-logo"],
        viewport: "visible"
      }]
    })).resolves.toMatchObject({
      operations: [{ type: "replaceImage", elementId: "wm_1", src: imageUrl }]
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const searchRequest = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { tools?: unknown };
    expect(searchRequest).toHaveProperty("tools");
  });

  it("falls back to a grounded image when the planner leaves a logo replacement empty", async () => {
    const imageUrl = "https://cdn.example.com/orange.jpg";
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text: "An orange image was found.",
        output: [{
          type: "web_search_call",
          results: [{
            type: "image_result",
            image_url: imageUrl,
            source_website_url: "https://example.com/orange",
            caption: "Orange fruit"
          }]
        }]
      })
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          operations: [{
            type: "setBackgroundImage",
            elementId: "wm_9",
            src: imageUrl,
            fit: "cover",
            position: "center"
          }]
        })
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(new OpenAIProvider("test-key", "test-model").generatePlan({
      ...input,
      instruction: "Replace the logo with an orange image",
      elements: [{
        id: "wm_9",
        tag: "a",
        role: "link",
        landmark: "header",
        containsVisual: true,
        viewport: "visible"
      }]
    })).resolves.toMatchObject({
      operations: [{ type: "replaceImage", elementId: "wm_9", src: imageUrl }]
    });
  });

  it("deterministically applies a searched image to a generic page background", async () => {
    const imageUrl = "https://cdn.example.com/beach.jpg";
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text: "A beach photograph was found.",
        output: [{
          type: "web_search_call",
          results: [{
            type: "image_result",
            image_url: imageUrl,
            source_website_url: "https://example.com/beach",
            caption: "A sandy beach"
          }]
        }]
      })
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ output_text: JSON.stringify({ operations: [] }) })
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(new OpenAIProvider("test-key", "test-model").generatePlan({
      ...input,
      instruction: "Change the background to an image of beach",
      elements: [
        { id: "wm_3", tag: "main", role: "main", viewport: "visible" },
        { id: "wm_2", tag: "body", role: "container", viewport: "visible" }
      ]
    })).resolves.toMatchObject({
      operations: [{
        type: "setBackgroundImage",
        elementId: "wm_2",
        src: imageUrl,
        fit: "cover",
        position: "center"
      }]
    });
  });

  it("rejects an image URL invented by the planner", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          operations: [{
            type: "setBackgroundImage",
            elementId: "wm_1",
            src: "https://invented.example/duck.jpg",
            fit: "cover",
            position: "center"
          }]
        }),
        output: []
      })
    }));
    await expect(new OpenAIProvider("test-key", "test-model").generatePlan(input))
      .rejects.toThrow("not provided by you or found in image search");
  });
});
