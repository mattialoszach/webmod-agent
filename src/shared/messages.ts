import type {
  HistoryState,
  ImageAssetMap,
  PageContext,
  PageAnalysis,
  SemanticElement,
  WebModOperation,
  WebSource
} from "./types";

export type PanelRequest =
  | { type: "GET_PAGE_CONTEXT"; tabId: number; selectedElementIds?: string[] }
  | {
      type: "PLAN_AND_APPLY";
      tabId: number;
      instruction: string;
      selectedElementIds?: string[];
    }
  | { type: "START_ELEMENT_PICKER"; tabId: number }
  | { type: "CANCEL_ELEMENT_PICKER"; tabId: number }
  | { type: "UNDO"; tabId: number }
  | { type: "REDO"; tabId: number }
  | { type: "RESET"; tabId: number };

export type ContentRequest =
  | { type: "WM_ANALYZE_PAGE"; selectedElementIds?: string[] }
  | { type: "WM_APPLY_OPERATIONS"; operations: WebModOperation[]; imageAssets?: ImageAssetMap }
  | { type: "WM_START_PICKER" }
  | { type: "WM_CANCEL_PICKER" }
  | { type: "WM_GET_STATE" }
  | { type: "WM_UNDO" }
  | { type: "WM_REDO" }
  | { type: "WM_RESET" };

export type ExtensionEvent =
  | { type: "WM_ELEMENT_PICKED"; element: SemanticElement }
  | { type: "WM_PICKER_CANCELLED" };

export type ExtensionResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface ApplyResult {
  operations: WebModOperation[];
  history: HistoryState;
  sources: WebSource[];
}

export type PageContextResponse = ExtensionResponse<PageContext>;
