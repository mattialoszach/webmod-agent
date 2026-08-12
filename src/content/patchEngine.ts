import { operationEnvelopeSchema } from "../agent/schemas";
import type { HistoryState, WebModOperation } from "../shared/types";
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
  patches: AppliedPatch[];
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
  private readonly redoStack: WebModOperation[][] = [];
  private onStateChange?: (state: HistoryState) => void;

  constructor(private readonly registry: ElementRegistry) {}

  setStateListener(listener: (state: HistoryState) => void): void {
    this.onStateChange = listener;
  }

  apply(operations: WebModOperation[]): HistoryState {
    const validated = operationEnvelopeSchema.parse({ operations }).operations;
    if (validated.length === 0) throw new Error("No supported changes were generated.");
    const patches: AppliedPatch[] = [];
    try {
      for (const operation of validated) {
        const element = this.registry.getElement(operation.elementId);
        if (!element) throw new Error(`Element ${operation.elementId} is no longer available.`);
        const patch: AppliedPatch = { operation, element, before: snapshotElement(element) };
        this.applyOperation(element, operation);
        patches.push(patch);
      }
    } catch (error) {
      for (const patch of patches.reverse()) restoreElement(patch.element, patch.before);
      throw error;
    }
    this.undoStack.push({ operations: validated, patches });
    this.redoStack.length = 0;
    return this.emitState();
  }

  undo(): HistoryState {
    const transaction = this.undoStack.pop();
    if (!transaction) return this.emitState();
    for (const patch of [...transaction.patches].reverse()) restoreElement(patch.element, patch.before);
    this.redoStack.push(transaction.operations);
    return this.emitState();
  }

  redo(): HistoryState {
    const operations = this.redoStack.pop();
    if (!operations) return this.emitState();
    const remainingRedo = [...this.redoStack];
    const state = this.apply(operations);
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

  private applyOperation(element: Element, operation: WebModOperation): void {
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
        if (!(element instanceof HTMLImageElement)) throw new Error("replaceImage requires an image element.");
        element.src = operation.src;
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
