import { afterEach, describe, expect, it, vi } from "vitest";
import { PageAnalyzer } from "../src/content/analyzer";
import { ElementPicker } from "../src/content/elementPicker";
import { ElementRegistry } from "../src/content/elementRegistry";

describe("ElementPicker", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.querySelector("#webmod-picker-host")?.remove();
    document.documentElement.style.cursor = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps picking after a click and emits each selected element", () => {
    document.body.innerHTML = "<button>First</button><p>Second</p>";
    const first = document.querySelector("button");
    const second = document.querySelector("p");
    if (!first || !second) throw new Error("Test elements were not created.");

    const sendMessage = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    let pointedAt: Element = first;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => pointedAt)
    });

    const picker = new ElementPicker(new PageAnalyzer(new ElementRegistry()));
    picker.start();
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 10, bubbles: true }));
    document.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    pointedAt = second;
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 20, clientY: 20, bubbles: true }));
    document.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls.map(([event]) => event.type)).toEqual([
      "WM_ELEMENT_PICKED",
      "WM_ELEMENT_PICKED"
    ]);
    expect(document.querySelector("#webmod-picker-host")).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(sendMessage).toHaveBeenLastCalledWith({ type: "WM_PICKER_CANCELLED" });
    expect(document.querySelector("#webmod-picker-host")).toBeNull();
  });
});
