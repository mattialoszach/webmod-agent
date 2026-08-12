import { ZodError } from "zod";
import { validateOperations } from "../agent/schemas";
import { MockProvider } from "../agent/providers/MockProvider";
import { OpenAIProvider } from "../agent/providers/OpenAIProvider";
import type { AIProvider } from "../agent/providers/AIProvider";
import type {
  ApplyResult,
  ContentRequest,
  ExtensionResponse,
  PanelRequest
} from "../shared/messages";
import type {
  HistoryState,
  PageAnalysis,
  PageContext,
  ProviderSettings
} from "../shared/types";
import {
  DEFAULT_PROVIDER_SETTINGS,
  normalizeProviderSettings
} from "../shared/providerSettings";

const lastTargetByTab = new Map<number, string>();

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

async function getSettings(): Promise<ProviderSettings> {
  const stored = await chrome.storage.local.get({ ...DEFAULT_PROVIDER_SETTINGS });
  return normalizeProviderSettings(stored);
}

async function getProvider(): Promise<AIProvider> {
  const settings = await getSettings();
  if (settings.provider === "mock") return new MockProvider();
  if (!settings.apiKey.trim()) throw new Error("Open AI setup and add your OpenAI API key, or switch to Offline demo.");
  return new OpenAIProvider(settings.apiKey.trim(), settings.model);
}

async function sendToContent<T>(tabId: number, message: ContentRequest): Promise<T> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message) as ExtensionResponse<T> | undefined;
    if (!response) throw new Error("The page did not respond.");
    if (!response.ok) throw new Error(response.error);
    return response.data;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/Receiving end does not exist|Could not establish connection|message port closed/i.test(detail)) {
      throw new Error("WebMod Agent cannot access this page. Open a normal http(s) webpage and reload it once after installing the extension.");
    }
    throw error;
  }
}

function assertSafeInstruction(instruction: string): void {
  const highStakes = /(?:bank statement|account balance|payment (?:receipt|confirmation)|identity document|passport|driver'?s license|authentication state|logged[ -]?in as|verified account)/i;
  if (highStakes.test(instruction)) {
    throw new Error("WebMod Agent does not modify high-stakes records, identity documents, payments, or authentication state.");
  }
}

async function handleRequest(message: PanelRequest): Promise<unknown> {
  switch (message.type) {
    case "GET_PAGE_CONTEXT": {
      const [analysis, history] = await Promise.all([
        sendToContent<PageAnalysis>(message.tabId, {
          type: "WM_ANALYZE_PAGE",
          selectedElementId: message.selectedElementId
        }),
        sendToContent<HistoryState>(message.tabId, { type: "WM_GET_STATE" })
      ]);
      return { analysis, history } satisfies PageContext;
    }
    case "PLAN_AND_APPLY": {
      const instruction = message.instruction.trim();
      if (!instruction) throw new Error("Describe what you want to change.");
      assertSafeInstruction(instruction);
      const isContinuation = /\b(?:it|this|that|too|also|actually|instead|slightly)\b/i.test(instruction);
      const rememberedElementId = message.selectedElementId ?? (isContinuation ? lastTargetByTab.get(message.tabId) : undefined);
      let analysis = await sendToContent<PageAnalysis>(message.tabId, {
        type: "WM_ANALYZE_PAGE",
        selectedElementId: rememberedElementId
      });
      if (message.selectedElementId && !analysis.selectedElement) {
        throw new Error("The selected element is no longer on the page. Select it again.");
      }
      const effectiveSelectedId = analysis.selectedElement ? rememberedElementId : undefined;
      if (rememberedElementId && !analysis.selectedElement && !message.selectedElementId) {
        lastTargetByTab.delete(message.tabId);
        analysis = await sendToContent<PageAnalysis>(message.tabId, { type: "WM_ANALYZE_PAGE" });
      }
      const provider = await getProvider();
      const rawOperations = await provider.generateOperations({
        instruction,
        url: analysis.url,
        pageTitle: analysis.pageTitle,
        elements: analysis.elements,
        selectedElementId: effectiveSelectedId
      });
      const operations = validateOperations({ operations: rawOperations });
      const knownIds = new Set(analysis.elements.map((element) => element.id));
      if (operations.some((operation) => !knownIds.has(operation.elementId))) {
        throw new Error("The planner referenced an element outside the analyzed page context.");
      }
      if (operations.length === 0) {
        throw new Error("I couldn't map that request to a safe page change. Try naming the element or selecting it first.");
      }
      const history = await sendToContent<HistoryState>(message.tabId, {
        type: "WM_APPLY_OPERATIONS",
        operations
      });
      const distinctTargets = [...new Set(operations.map((operation) => operation.elementId))];
      if (distinctTargets.length === 1) lastTargetByTab.set(message.tabId, distinctTargets[0]);
      return { operations, history } satisfies ApplyResult;
    }
    case "START_ELEMENT_PICKER":
      return sendToContent<HistoryState>(message.tabId, { type: "WM_START_PICKER" });
    case "CANCEL_ELEMENT_PICKER":
      return sendToContent<HistoryState>(message.tabId, { type: "WM_CANCEL_PICKER" });
    case "UNDO":
      return sendToContent<HistoryState>(message.tabId, { type: "WM_UNDO" });
    case "REDO":
      return sendToContent<HistoryState>(message.tabId, { type: "WM_REDO" });
    case "RESET": {
      lastTargetByTab.delete(message.tabId);
      return sendToContent<HistoryState>(message.tabId, { type: "WM_RESET" });
    }
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof ZodError) return `The AI response was rejected: ${error.issues[0]?.message ?? "invalid operations"}`;
  return error instanceof Error ? error.message : "Unexpected extension error.";
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || !("type" in message)) return false;
  const type = (message as { type?: unknown }).type;
  if (typeof type !== "string" || type.startsWith("WM_")) return false;
  void handleRequest(message as PanelRequest)
    .then((data) => sendResponse({ ok: true, data } satisfies ExtensionResponse<unknown>))
    .catch((error: unknown) => sendResponse({ ok: false, error: errorMessage(error) } satisfies ExtensionResponse<never>));
  return true;
});
