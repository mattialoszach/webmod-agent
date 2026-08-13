import { useCallback, useEffect, useRef, useState } from "react";
import type { ApplyResult, ExtensionEvent, ExtensionResponse, PanelRequest } from "../shared/messages";
import type { HistoryState, PageContext, SemanticElement, WebSource } from "../shared/types";
import { Settings } from "./components/Settings";

const EMPTY_HISTORY: HistoryState = { canUndo: false, canRedo: false, changeCount: 0 };
const COLLAPSED_SELECTION_COUNT = 3;

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
}

async function request<T>(message: PanelRequest): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as ExtensionResponse<T> | undefined;
  if (!response) throw new Error("The extension did not respond.");
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

function hostFromUrl(url?: string): string {
  if (!url) return "No active webpage";
  try { return new URL(url).hostname; } catch { return "Unsupported page"; }
}

export function App(): React.JSX.Element {
  const [tabId, setTabId] = useState<number>();
  const [pageHost, setPageHost] = useState("Loading…");
  const [instruction, setInstruction] = useState("");
  const [selectedElements, setSelectedElements] = useState<SemanticElement[]>([]);
  const [selectionsExpanded, setSelectionsExpanded] = useState(false);
  const [history, setHistory] = useState<HistoryState>(EMPTY_HISTORY);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [sources, setSources] = useState<WebSource[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const refresh = useCallback(async () => {
    const tab = await activeTab();
    setTabId(tab?.id);
    setPageHost(hostFromUrl(tab?.url));
    setSelectedElements([]);
    setSelectionsExpanded(false);
    setError(undefined);
    setSources([]);
    if (tab?.id === undefined || !tab.url?.startsWith("http")) {
      setHistory(EMPTY_HISTORY);
      return;
    }
    try {
      const context = await request<PageContext>({ type: "GET_PAGE_CONTEXT", tabId: tab.id });
      setHistory(context.history);
      setPageHost(hostFromUrl(context.analysis.url));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not inspect this page.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onActivated = (): void => { void refresh(); };
    const onUpdated = (updatedTabId: number, change: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab): void => {
      if (updatedTabId === tabId && (change.url || change.status === "complete")) {
        setPageHost(hostFromUrl(tab.url));
        if (change.url) {
          setSelectedElements([]);
          setSelectionsExpanded(false);
          setHistory(EMPTY_HISTORY);
        }
      }
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [refresh, tabId]);

  useEffect(() => {
    const listener = (message: ExtensionEvent): false => {
      if (message.type === "WM_ELEMENT_PICKED") {
        setSelectedElements((current) => current.some((element) => element.id === message.element.id)
          ? current
          : [...current, message.element]);
        setError(undefined);
      } else if (message.type === "WM_PICKER_CANCELLED") {
        setPicking(false);
        window.setTimeout(() => textareaRef.current?.focus(), 0);
      }
      return false;
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  async function apply(): Promise<void> {
    if (tabId === undefined || !instruction.trim() || loading) return;
    setLoading(true);
    setError(undefined);
    setNotice(undefined);
    setSources([]);
    try {
      const result = await request<ApplyResult>({
        type: "PLAN_AND_APPLY",
        tabId,
        instruction: instruction.trim(),
        selectedElementIds: selectedElements.length > 0
          ? selectedElements.map((element) => element.id)
          : undefined
      });
      setHistory(result.history);
      setInstruction("");
      setSources(result.sources);
      setNotice(`${result.operations.length} local ${result.operations.length === 1 ? "change" : "changes"} applied`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not apply the change.");
    } finally {
      setLoading(false);
    }
  }

  async function startPicker(): Promise<void> {
    if (tabId === undefined) return;
    setError(undefined);
    try {
      if (picking) {
        await request<HistoryState>({ type: "CANCEL_ELEMENT_PICKER", tabId });
        setPicking(false);
        window.setTimeout(() => textareaRef.current?.focus(), 0);
      } else {
        await request<HistoryState>({ type: "START_ELEMENT_PICKER", tabId });
        setPicking(true);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start element selection.");
    }
  }

  async function historyAction(type: "UNDO" | "REDO" | "RESET"): Promise<void> {
    if (tabId === undefined) return;
    setError(undefined);
    try {
      const state = await request<HistoryState>({ type, tabId });
      setHistory(state);
      setNotice(type === "RESET" ? "Page reset" : type === "UNDO" ? "Change undone" : "Change restored");
      if (type === "RESET") {
        setSelectedElements([]);
        setSelectionsExpanded(false);
        setSources([]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not ${type.toLowerCase()}.`);
    }
  }

  const visibleSelectedElements = selectionsExpanded
    ? selectedElements
    : selectedElements.slice(0, COLLAPSED_SELECTION_COUNT);
  const hiddenSelectionCount = selectedElements.length - visibleSelectedElements.length;

  return (
    <main className="app-shell">
      <header className="brand-row">
        <div className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <rect x="3.25" y="3.75" width="17.5" height="16.5" rx="3" />
            <path d="M3.75 8.25h16.5" />
            <circle cx="6.25" cy="6" r=".65" fill="currentColor" stroke="none" />
            <circle cx="8.5" cy="6" r=".65" fill="currentColor" stroke="none" />
            <path d="M7 12.25h10M10 10.75v3M7 16h10M14.5 14.5v3" />
          </svg>
        </div>
        <div>
          <h1>WEBMOD <span>AGENT</span></h1>
          <p>Local page editor</p>
        </div>
        <span className="version-pill">BETA</span>
      </header>

      <section className="page-card">
        <span className="status-dot"><span /></span>
        <div><span>Current page</span><strong>{pageHost}</strong></div>
        {history.changeCount > 0 && <span className="local-pill">{history.changeCount} active</span>}
      </section>

      <section className="composer">
        <label htmlFor="instruction">What do you want to change?</label>
        {selectedElements.length > 0 && (
          <div className="selected-elements" aria-label="Selected element references">
            <div className="selected-header">
              <span>{selectedElements.length} selected</span>
              <button type="button" onClick={() => {
                setSelectedElements([]);
                setSelectionsExpanded(false);
              }}>Clear all</button>
            </div>
            {visibleSelectedElements.map((element) => (
              <div className="selected-chip" key={element.id}>
                <span className="selected-icon">⌖</span>
                <span>{element.tag}{element.text ? ` · ${element.text.slice(0, 42)}` : ""}</span>
              </div>
            ))}
            {(hiddenSelectionCount > 0 || selectionsExpanded && selectedElements.length > COLLAPSED_SELECTION_COUNT) && (
              <button
                className="selection-toggle"
                type="button"
                aria-expanded={selectionsExpanded}
                onClick={() => setSelectionsExpanded((expanded) => !expanded)}
              >
                {selectionsExpanded ? "Show less" : `+${hiddenSelectionCount} more`}
              </button>
            )}
          </div>
        )}
        <textarea
          ref={textareaRef}
          id="instruction"
          value={instruction}
          disabled={loading}
          placeholder={selectedElements.length > 0 ? "Make these elements red…" : "Make the main heading red…"}
          rows={5}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void apply();
            }
          }}
        />
        <div className="keyboard-hint"><span><kbd>↵</kbd> Apply</span><span><kbd>⇧ ↵</kbd> New line</span></div>
        <button className="primary-button" type="button" disabled={loading || !instruction.trim() || tabId === undefined} onClick={() => void apply()}>
          {loading ? <><span className="spinner" /> Planning changes…</> : <><span>✦</span> Apply changes</>}
        </button>
        <button className={`picker-button${picking ? " picking" : ""}`} type="button" disabled={loading || tabId === undefined} onClick={() => void startPicker()}>
          <span>⌖</span> {picking ? "Done selecting" : selectedElements.length > 0 ? "Select more elements" : "Select elements"}
        </button>
      </section>

      {(error || notice) && <div className={error ? "message error" : "message success"} role="status">{error ?? notice}</div>}

      {sources.length > 0 && (
        <section className="search-sources" aria-label="Web search sources">
          <div><span>⌕</span><strong>Web sources used</strong></div>
          <ul>
            {sources.map((source) => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="history-controls" aria-label="Page change history">
        <button type="button" disabled={!history.canUndo || loading} onClick={() => void historyAction("UNDO")}><span>↶</span> Undo</button>
        <button type="button" disabled={!history.canRedo || loading} onClick={() => void historyAction("REDO")}><span>↷</span> Redo</button>
        <button className="reset-button" type="button" disabled={history.changeCount === 0 || loading} onClick={() => void historyAction("RESET")}>Reset page</button>
      </section>

      <Settings />
      <footer><span className="lock">◇</span> Changes stay local to this browser</footer>
    </main>
  );
}
