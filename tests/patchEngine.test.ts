import { beforeEach, describe, expect, it } from "vitest";
import { ElementRegistry } from "../src/content/elementRegistry";
import { PatchEngine } from "../src/content/patchEngine";

describe("PatchEngine", () => {
  let registry: ElementRegistry;
  let engine: PatchEngine;
  let heading: HTMLHeadingElement;
  let id: string;

  beforeEach(() => {
    document.body.innerHTML = '<h1 style="color: blue"><span>Hello</span></h1>';
    heading = document.querySelector("h1") as HTMLHeadingElement;
    registry = new ElementRegistry();
    id = registry.getId(heading);
    engine = new PatchEngine(registry);
  });

  it("applies, undoes, and redoes a transaction", () => {
    engine.apply([
      { type: "replaceText", elementId: id, value: "Acme" },
      { type: "setStyles", elementId: id, styles: { color: "red" } }
    ]);
    expect(heading.textContent).toBe("Acme");
    expect(heading.style.getPropertyValue("color")).toBe("red");

    const undone = engine.undo();
    expect(heading.innerHTML).toBe("<span>Hello</span>");
    expect(heading.style.color).toBe("blue");
    expect(undone.canRedo).toBe(true);

    engine.redo();
    expect(heading.textContent).toBe("Acme");
    expect(heading.style.color).toBe("red");
  });

  it("resets all WebMod transactions to the original state", () => {
    engine.apply([{ type: "replaceText", elementId: id, value: "First" }]);
    engine.apply([{ type: "setStyles", elementId: id, styles: { "font-size": "40px" } }]);
    const state = engine.reset();

    expect(heading.innerHTML).toBe("<span>Hello</span>");
    expect(heading.style.fontSize).toBe("");
    expect(state).toEqual({ canUndo: false, canRedo: false, changeCount: 0 });
  });

  it("rolls back the transaction when a target is missing", () => {
    expect(() => engine.apply([
      { type: "replaceText", elementId: id, value: "Changed" },
      { type: "hide", elementId: "wm_999" }
    ])).toThrow("no longer available");
    expect(heading.innerHTML).toBe("<span>Hello</span>");
  });
});
