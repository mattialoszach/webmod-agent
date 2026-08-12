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

  it("applies and restores a background image as one history transaction", () => {
    engine.apply([{
      type: "setBackgroundImage",
      elementId: id,
      src: "https://images.example.com/duck.jpg",
      fit: "cover",
      position: "center"
    }]);

    expect(heading.style.backgroundImage).toContain("https://images.example.com/duck.jpg");
    expect(heading.style.backgroundSize).toBe("cover");
    expect(heading.style.backgroundPosition).toContain("center");
    expect(heading.style.backgroundRepeat).toBe("no-repeat");

    engine.undo();
    expect(heading.style.backgroundImage).toBe("");
    engine.redo();
    expect(heading.style.backgroundImage).toContain("https://images.example.com/duck.jpg");
  });

  it("replaces and restores the contents of an identified logo container", () => {
    document.body.innerHTML = '<a class="site-logo" href="/"><svg viewBox="0 0 10 10"><path d="M0 0h10v10z" /></svg></a>';
    const logo = document.querySelector("a") as HTMLAnchorElement;
    const originalMarkup = logo.innerHTML;
    const logoId = registry.getId(logo);

    engine.apply([{ type: "replaceImage", elementId: logoId, src: "https://images.example.com/apple-logo.png" }]);
    const replacement = logo.querySelector("img");
    expect(replacement?.src).toBe("https://images.example.com/apple-logo.png");
    expect(replacement?.style.objectFit).toBe("contain");

    engine.undo();
    expect(logo.innerHTML).toBe(originalMarkup);
  });

  it("uses a locally resolved image and reconciles a logo reset by the page", () => {
    document.body.innerHTML = '<img class="site-logo" src="https://example.com/original.png">';
    const logo = document.querySelector("img") as HTMLImageElement;
    const logoId = registry.getId(logo);
    const remoteUrl = "https://images.example.com/orange.png";
    const localDataUrl = "data:image/png;base64,aGVsbG8=";

    engine.apply(
      [{ type: "replaceImage", elementId: logoId, src: remoteUrl }],
      { [remoteUrl]: localDataUrl }
    );
    expect(logo.src).toBe(localDataUrl);

    logo.src = "https://example.com/original.png";
    engine.reconcileImages();
    expect(logo.src).toBe(localDataUrl);

    engine.undo();
    expect(logo.src).toBe("https://example.com/original.png");
    engine.redo();
    expect(logo.src).toBe(localDataUrl);
  });

  it("rolls back the transaction when a target is missing", () => {
    expect(() => engine.apply([
      { type: "replaceText", elementId: id, value: "Changed" },
      { type: "hide", elementId: "wm_999" }
    ])).toThrow("no longer available");
    expect(heading.innerHTML).toBe("<span>Hello</span>");
  });
});
