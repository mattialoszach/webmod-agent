import { useCallback, useEffect, useRef, useState } from "react";
import type { ApplyResult, ExtensionEvent, ExtensionResponse, PanelRequest } from "../shared/messages";
import type { HistoryState, PageContext, SemanticElement, WebSource } from "../shared/types";
import { Settings } from "./components/Settings";

const EMPTY_HISTORY: HistoryState = { canUndo: false, canRedo: false, changeCount: 0 };

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
  const [selected, setSelected] = useState<SemanticElement>();
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
    setSelected(undefined);
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
          setSelected(undefined);
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
        setSelected(message.element);
        setPicking(false);
        setError(undefined);
        window.setTimeout(() => textareaRef.current?.focus(), 0);
      } else if (message.type === "WM_PICKER_CANCELLED") {
        setPicking(false);
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
        selectedElementId: selected?.id
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
      await request<HistoryState>({ type: "START_ELEMENT_PICKER", tabId });
      setPicking(true);
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
        setSelected(undefined);
        setSources([]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not ${type.toLowerCase()}.`);
    }
  }

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
        {selected && (
          <div className="selected-chip">
            <span className="selected-icon">⌖</span>
            <span><small>Selected</small>{selected.tag}{selected.text ? ` · ${selected.text.slice(0, 42)}` : ""}</span>
            <button type="button" onClick={() => setSelected(undefined)} aria-label="Clear selection">×</button>
          </div>
        )}
        <textarea
          ref={textareaRef}
          id="instruction"
          value={instruction}
          disabled={loading}
          placeholder={selected ? "Change this text to Hello World" : "Make the main heading red…"}
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
          <span>⌖</span> {picking ? "Click an element on the page…" : "Select element"}
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
