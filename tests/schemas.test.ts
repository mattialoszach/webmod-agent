import { describe, expect, it } from "vitest";
import { operationEnvelopeSchema, validateOperations } from "../src/agent/schemas";

describe("operation validation", () => {
  it("accepts a supported operation", () => {
    expect(validateOperations({
      operations: [{ type: "setStyles", elementId: "wm_2", styles: { color: "red" } }]
    })).toHaveLength(1);
  });

  it("rejects unsupported operations and extra fields", () => {
    expect(() => operationEnvelopeSchema.parse({
      operations: [{ type: "executeScript", elementId: "wm_2", code: "alert(1)" }]
    })).toThrow();
    expect(() => operationEnvelopeSchema.parse({
      operations: [{ type: "hide", elementId: "wm_2", selector: "body" }]
    })).toThrow();
  });

  it("rejects unsafe CSS and URLs", () => {
    expect(() => operationEnvelopeSchema.parse({
      operations: [{ type: "setStyles", elementId: "wm_2", styles: { background: "url(javascript:alert(1))" } }]
    })).toThrow();
    expect(() => operationEnvelopeSchema.parse({
      operations: [{ type: "setAttribute", elementId: "wm_2", attribute: "href", value: "javascript:alert(1)" }]
    })).toThrow();
  });
});
