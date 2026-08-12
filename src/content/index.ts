import type { ContentRequest, ExtensionResponse } from "../shared/messages";
import type { HistoryState, PageAnalysis } from "../shared/types";
import { updateActiveIndicator } from "./activeIndicator";
import { PageAnalyzer } from "./analyzer";
import { ElementPicker } from "./elementPicker";
import { ElementRegistry } from "./elementRegistry";
import { observeForRegistryCleanup } from "./observer";
import { PatchEngine } from "./patchEngine";

const registry = new ElementRegistry();
const analyzer = new PageAnalyzer(registry);
const patchEngine = new PatchEngine(registry);
const picker = new ElementPicker(analyzer);
patchEngine.setStateListener(updateActiveIndicator);
observeForRegistryCleanup(registry);

function success<T>(data: T): ExtensionResponse<T> {
  return { ok: true, data };
}

function failure(error: unknown): ExtensionResponse<never> {
  return { ok: false, error: error instanceof Error ? error.message : "Unexpected page error." };
}

chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
  try {
    switch (message.type) {
      case "WM_ANALYZE_PAGE":
        sendResponse(success<PageAnalysis>(analyzer.analyze(message.selectedElementId)));
        break;
      case "WM_APPLY_OPERATIONS":
        sendResponse(success<HistoryState>(patchEngine.apply(message.operations)));
        break;
      case "WM_START_PICKER":
        picker.start();
        sendResponse(success<HistoryState>(patchEngine.getState()));
        break;
      case "WM_CANCEL_PICKER":
        picker.cancel(false);
        sendResponse(success<HistoryState>(patchEngine.getState()));
        break;
      case "WM_GET_STATE":
        sendResponse(success<HistoryState>(patchEngine.getState()));
        break;
      case "WM_UNDO":
        sendResponse(success<HistoryState>(patchEngine.undo()));
        break;
      case "WM_REDO":
        sendResponse(success<HistoryState>(patchEngine.redo()));
        break;
      case "WM_RESET":
        picker.cancel(false);
        sendResponse(success<HistoryState>(patchEngine.reset()));
        break;
      default:
        sendResponse(failure("Unsupported content-script message."));
    }
  } catch (error) {
    sendResponse(failure(error));
  }
  return false;
});
