import { operationEnvelopeSchema } from "../agent/schemas";
import type { HistoryState, ImageAssetMap, WebModOperation } from "../shared/types";
import { ElementRegistry } from "./elementRegistry";

interface ElementSnapshot {
  attributes: Array<[string, string]>;
  childNodes: Node[];
  inputValue?: string;
}

interface AppliedPatch {
  operation: WebModOperation;
  element: Element;
  before: ElementSnapshot;
}

interface PatchTransaction {
  operations: WebModOperation[];
  imageAssets: ImageAssetMap;
  patches: AppliedPatch[];
}

interface RedoTransaction {
  operations: WebModOperation[];
  imageAssets: ImageAssetMap;
}

function snapshotElement(element: Element): ElementSnapshot {
  const snapshot: ElementSnapshot = {
    attributes: Array.from(element.attributes, (attribute) => [attribute.name, attribute.value]),
    childNodes: Array.from(element.childNodes, (node) => node.cloneNode(true))
  };
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    snapshot.inputValue = element.value;
  }
  return snapshot;
}

function restoreElement(element: Element, snapshot: ElementSnapshot): void {
  for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name);
  for (const [name, value] of snapshot.attributes) element.setAttribute(name, value);
  element.replaceChildren(...snapshot.childNodes.map((node) => node.cloneNode(true)));
  if (snapshot.inputValue !== undefined && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    element.value = snapshot.inputValue;
  }
}

export class PatchEngine {
  private readonly undoStack: PatchTransaction[] = [];
  private readonly redoStack: RedoTransaction[] = [];
  private onStateChange?: (state: HistoryState) => void;

  constructor(private readonly registry: ElementRegistry) {}

  setStateListener(listener: (state: HistoryState) => void): void {
    this.onStateChange = listener;
  }

  apply(operations: WebModOperation[], imageAssets: ImageAssetMap = {}): HistoryState {
    const validated = operationEnvelopeSchema.parse({ operations }).operations;
    if (validated.length === 0) throw new Error("No supported changes were generated.");
    const patches: AppliedPatch[] = [];
    try {
      for (const operation of validated) {
        const element = this.registry.getElement(operation.elementId);
        if (!element) throw new Error(`Element ${operation.elementId} is no longer available.`);
        const patch: AppliedPatch = { operation, element, before: snapshotElement(element) };
        this.applyOperation(element, operation, imageAssets);
        patches.push(patch);
      }
    } catch (error) {
      for (const patch of patches.reverse()) restoreElement(patch.element, patch.before);
      throw error;
    }
    this.undoStack.push({ operations: validated, imageAssets, patches });
    this.redoStack.length = 0;
    return this.emitState();
  }

  undo(): HistoryState {
    const transaction = this.undoStack.pop();
    if (!transaction) return this.emitState();
    for (const patch of [...transaction.patches].reverse()) restoreElement(patch.element, patch.before);
    this.redoStack.push({ operations: transaction.operations, imageAssets: transaction.imageAssets });
    return this.emitState();
  }

  redo(): HistoryState {
    const transaction = this.redoStack.pop();
    if (!transaction) return this.emitState();
    const remainingRedo = [...this.redoStack];
    const state = this.apply(transaction.operations, transaction.imageAssets);
    this.redoStack.push(...remainingRedo);
    return this.emitState(state);
  }

  reset(): HistoryState {
    while (this.undoStack.length > 0) {
      const transaction = this.undoStack.pop();
      if (!transaction) break;
      for (const patch of [...transaction.patches].reverse()) restoreElement(patch.element, patch.before);
    }
    this.redoStack.length = 0;
    return this.emitState();
  }

  getState(): HistoryState {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      changeCount: this.undoStack.length
    };
  }

  reconcileImages(): void {
    for (const transaction of this.undoStack) {
      for (const patch of transaction.patches) {
        if (patch.operation.type !== "replaceImage" && patch.operation.type !== "setBackgroundImage") continue;
        if (!patch.element.isConnected || this.isImageOperationApplied(patch.element, patch.operation, transaction.imageAssets)) continue;
        this.applyOperation(patch.element, patch.operation, transaction.imageAssets);
      }
    }
  }

  private isImageOperationApplied(
    element: Element,
    operation: Extract<WebModOperation, { type: "replaceImage" | "setBackgroundImage" }>,
    imageAssets: ImageAssetMap
  ): boolean {
    const resolvedSrc = imageAssets[operation.src] ?? operation.src;
    if (operation.type === "setBackgroundImage") {
      return (element instanceof HTMLElement || element instanceof SVGElement)
        && element.style.backgroundImage.includes(resolvedSrc);
    }
    if (element instanceof HTMLImageElement) return element.src === resolvedSrc;
    if (element instanceof SVGElement) return element.querySelector(":scope > image")?.getAttribute("href") === resolvedSrc;
    if (element instanceof HTMLElement) return element.querySelector<HTMLImageElement>(":scope > img")?.src === resolvedSrc;
    return false;
  }

  private applyOperation(element: Element, operation: WebModOperation, imageAssets: ImageAssetMap): void {
    switch (operation.type) {
      case "replaceText":
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) element.value = operation.value;
        else element.textContent = operation.value;
        return;
      case "setStyles": {
        if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) {
          throw new Error("The target does not support inline styles.");
        }
        for (const [property, value] of Object.entries(operation.styles)) {
          element.style.setProperty(property, value, "important");
        }
        return;
      }
      case "hide":
        if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) throw new Error("The target cannot be hidden.");
        element.style.setProperty("display", "none", "important");
        return;
      case "replaceImage":
        const resolvedImageSrc = imageAssets[operation.src] ?? operation.src;
        if (element instanceof HTMLImageElement) {
          element.src = resolvedImageSrc;
          return;
        }
        if (element instanceof SVGElement) {
          const image = document.createElementNS("http://www.w3.org/2000/svg", "image");
          image.setAttribute("href", resolvedImageSrc);
          image.setAttribute("x", "0");
          image.setAttribute("y", "0");
          image.setAttribute("width", "100%");
          image.setAttribute("height", "100%");
          image.setAttribute("preserveAspectRatio", "xMidYMid meet");
          element.replaceChildren(image);
          return;
        }
        if (!(element instanceof HTMLElement)) throw new Error("replaceImage requires an image or logo element.");
        const isLogoContainer = /logo/i.test(`${element.id} ${element.getAttribute("class") ?? ""} ${element.getAttribute("aria-label") ?? ""}`)
          || element.querySelector(":scope > img, :scope > svg") !== null;
        if (!isLogoContainer) throw new Error("replaceImage requires an image or identified logo container.");
        const rect = element.getBoundingClientRect();
        const image = document.createElement("img");
        image.src = resolvedImageSrc;
        image.alt = "";
        image.setAttribute("aria-hidden", "true");
        image.style.width = rect.width > 0 ? `${rect.width}px` : "100%";
        image.style.height = rect.height > 0 ? `${rect.height}px` : "100%";
        image.style.objectFit = "contain";
        image.style.display = "block";
        element.replaceChildren(image);
        return;
      case "setBackgroundImage":
        if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) {
          throw new Error("The target does not support a background image.");
        }
        element.style.setProperty("background-image", `url("${imageAssets[operation.src] ?? operation.src}")`, "important");
        element.style.setProperty("background-size", operation.fit, "important");
        element.style.setProperty("background-position", operation.position, "important");
        element.style.setProperty("background-repeat", "no-repeat", "important");
        return;
      case "setAttribute":
        element.setAttribute(operation.attribute, operation.value);
        if (operation.attribute === "target" && operation.value === "_blank") element.setAttribute("rel", "noopener noreferrer");
    }
  }

  private emitState(state = this.getState()): HistoryState {
    this.onStateChange?.(state);
    return state;
  }
}
