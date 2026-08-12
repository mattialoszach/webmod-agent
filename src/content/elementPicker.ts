import type { ExtensionEvent } from "../shared/messages";
import { PageAnalyzer } from "./analyzer";

export class ElementPicker {
  private active = false;
  private hovered?: Element;
  private host?: HTMLDivElement;
  private box?: HTMLDivElement;
  private label?: HTMLDivElement;

  constructor(private readonly analyzer: PageAnalyzer) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    this.createOverlay();
    document.addEventListener("mousemove", this.handleMove, true);
    document.addEventListener("click", this.handleClick, true);
    document.addEventListener("keydown", this.handleKey, true);
    document.documentElement.style.cursor = "crosshair";
  }

  cancel(notify = true): void {
    if (!this.active) return;
    this.active = false;
    document.removeEventListener("mousemove", this.handleMove, true);
    document.removeEventListener("click", this.handleClick, true);
    document.removeEventListener("keydown", this.handleKey, true);
    document.documentElement.style.cursor = "";
    this.host?.remove();
    this.host = undefined;
    this.box = undefined;
    this.label = undefined;
    this.hovered = undefined;
    if (notify) this.sendEvent({ type: "WM_PICKER_CANCELLED" });
  }

  private readonly handleMove = (event: MouseEvent): void => {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (!target || target.closest("#webmod-picker-host")) return;
    this.hovered = target;
    const rect = target.getBoundingClientRect();
    if (!this.box || !this.label) return;
    Object.assign(this.box.style, {
      display: "block",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`
    });
    this.label.textContent = `${target.tagName.toLowerCase()} · click to select`;
    this.label.style.left = `${Math.max(8, rect.left)}px`;
    this.label.style.top = `${Math.max(8, rect.top - 30)}px`;
  };

  private readonly handleClick = (event: MouseEvent): void => {
    if (!this.hovered) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const element = this.analyzer.describeElement(this.hovered);
    this.cancel(false);
    this.sendEvent({ type: "WM_ELEMENT_PICKED", element });
  };

  private readonly handleKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.cancel(true);
  };

  private createOverlay(): void {
    this.host = document.createElement("div");
    this.host.id = "webmod-picker-host";
    const shadow = this.host.attachShadow({ mode: "closed" });
    this.box = document.createElement("div");
    this.label = document.createElement("div");
    Object.assign(this.host.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "2147483647" });
    Object.assign(this.box.style, {
      position: "fixed", display: "none", boxSizing: "border-box", border: "2px solid #7c3aed",
      background: "rgba(124,58,237,.12)", borderRadius: "4px", pointerEvents: "none"
    });
    Object.assign(this.label.style, {
      position: "fixed", background: "#18181b", color: "white", padding: "5px 8px", borderRadius: "5px",
      font: "12px/1.2 system-ui, sans-serif", boxShadow: "0 4px 16px rgba(0,0,0,.2)", pointerEvents: "none"
    });
    shadow.append(this.box, this.label);
    document.documentElement.append(this.host);
  }

  private sendEvent(event: ExtensionEvent): void {
    void chrome.runtime.sendMessage(event).catch(() => undefined);
  }
}
