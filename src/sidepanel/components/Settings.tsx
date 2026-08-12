import { useEffect, useState } from "react";
import {
  DEFAULT_PROVIDER_SETTINGS,
  normalizeProviderSettings,
  OPENAI_MODELS
} from "../../shared/providerSettings";
import type { ProviderSettings } from "../../shared/types";

export function Settings(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<ProviderSettings>(DEFAULT_PROVIDER_SETTINGS);
  const [savedSettings, setSavedSettings] = useState<ProviderSettings>(DEFAULT_PROVIDER_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState<string>();

  useEffect(() => {
    void chrome.storage.local.get({ ...DEFAULT_PROVIDER_SETTINGS }).then((stored) => {
      const normalized = normalizeProviderSettings(stored);
      setSettings(normalized);
      setSavedSettings(normalized);
    });
  }, []);

  function close(): void {
    setSettings(savedSettings);
    setFormError(undefined);
    setConfirmRemove(false);
    setSettingsNotice(undefined);
    setOpen(false);
  }

  async function save(): Promise<void> {
    if (settings.provider === "openai" && !settings.apiKey.trim()) {
      setFormError("Enter an OpenAI API key to use full AI mode.");
      return;
    }
    setFormError(undefined);
    setSettingsNotice(undefined);
    const normalized = { ...settings, apiKey: settings.apiKey.trim() };
    await chrome.storage.local.set(normalized);
    setSettings(normalized);
    setSavedSettings(normalized);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  }

  async function removeApiKey(): Promise<void> {
    const offlineSettings: ProviderSettings = {
      provider: "mock",
      apiKey: "",
      model: savedSettings.model
    };
    await chrome.storage.local.set({
      provider: offlineSettings.provider,
      model: offlineSettings.model
    });
    await chrome.storage.local.remove("apiKey");
    setSettings(offlineSettings);
    setSavedSettings(offlineSettings);
    setShowKey(false);
    setConfirmRemove(false);
    setSettingsNotice("API key removed. Offline demo is now active.");
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  }

  const hasSavedKey = Boolean(savedSettings.apiKey.trim());
  const selectedModel = OPENAI_MODELS.find((model) => model.id === savedSettings.model);
  const summary = savedSettings.provider === "openai"
    ? hasSavedKey ? `${selectedModel?.name ?? "OpenAI"} connected` : "API key required"
    : "Offline demo · limited commands";

  return (
    <div className="settings">
      <button className="settings-toggle" type="button" onClick={() => open ? close() : setOpen(true)} aria-expanded={open}>
        <span className="settings-icon" aria-hidden="true">⌁</span>
        <span className="settings-summary">
          <small>AI setup</small>
          <strong>{summary}</strong>
        </span>
        <span className={`provider-pill ${savedSettings.provider === "openai" && hasSavedKey ? "ready" : "attention"}`}>
          {savedSettings.provider === "openai" && hasSavedKey ? "Ready" : savedSettings.provider === "mock" ? "Set up AI" : "Needs key"}
        </span>
        <span className={`chevron${open ? " open" : ""}`} aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="settings-body">
          <div className="settings-heading">
            <div><span className="eyebrow">Connection</span><h2>Choose how WebMod Agent plans</h2></div>
            <button className="close-settings" type="button" onClick={close} aria-label="Close AI setup">×</button>
          </div>

          <div className="mode-options" role="radiogroup" aria-label="AI mode">
            <button
              className={`mode-option${settings.provider === "openai" ? " selected" : ""}`}
              type="button"
              role="radio"
              aria-checked={settings.provider === "openai"}
              onClick={() => {
                setSettings((current) => ({ ...current, provider: "openai" }));
                setFormError(undefined);
                setSettingsNotice(undefined);
              }}
            >
              <span className="radio-mark" aria-hidden="true" />
              <span><strong>OpenAI</strong><small>Full natural-language planning</small></span>
              <span className="required-tag">Key required</span>
            </button>
            <button
              className={`mode-option${settings.provider === "mock" ? " selected" : ""}`}
              type="button"
              role="radio"
              aria-checked={settings.provider === "mock"}
              onClick={() => {
                setSettings((current) => ({ ...current, provider: "mock" }));
                setFormError(undefined);
                setSettingsNotice(undefined);
              }}
            >
              <span className="radio-mark" aria-hidden="true" />
              <span><strong>Offline demo</strong><small>No AI · a few preset commands</small></span>
            </button>
          </div>

          {settings.provider === "openai" && (
            <div className="openai-fields">
              <label htmlFor="api-key"><span>OpenAI API key <em>Required</em></span></label>
              <div className="secret-input">
                <input
                  id="api-key"
                  type={showKey ? "text" : "password"}
                  value={settings.apiKey}
                  placeholder="sk-…"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => {
                    setSettings((current) => ({ ...current, apiKey: event.target.value }));
                    setFormError(undefined);
                  }}
                />
                <button type="button" onClick={() => setShowKey((value) => !value)}>{showKey ? "Hide" : "Show"}</button>
              </div>
              <p className="field-help">You need your own API key. <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">Create or find a key ↗</a></p>

              <label htmlFor="model">Model</label>
              <div className="select-wrap">
                <select
                  id="model"
                  value={settings.model}
                  onChange={(event) => {
                    const model = OPENAI_MODELS.find((option) => option.id === event.target.value);
                    if (model) setSettings((current) => ({ ...current, model: model.id }));
                  }}
                >
                  {OPENAI_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>{model.name} — {model.description}</option>
                  ))}
                </select>
              </div>
              <div className="privacy-note"><span aria-hidden="true">◇</span><p>Stored only in this extension. Never shared with the webpage.</p></div>
              {hasSavedKey && !confirmRemove && (
                <button className="remove-key-button" type="button" onClick={() => setConfirmRemove(true)}>
                  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="M3.75 5.25h12.5M8 2.75h4M5.5 5.25l.65 11h7.7l.65-11M8 8.25v5M12 8.25v5" />
                  </svg>
                  <span>Remove saved API key</span>
                </button>
              )}
              {hasSavedKey && confirmRemove && (
                <div className="remove-confirmation" role="alertdialog" aria-label="Confirm API key removal">
                  <p>Remove the stored key and switch to Offline demo?</p>
                  <div>
                    <button type="button" onClick={() => setConfirmRemove(false)}>Cancel</button>
                    <button className="confirm-remove-button" type="button" onClick={() => void removeApiKey()}>Remove key</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {settings.provider === "mock" && (
            <div className="demo-note">
              <span className="demo-badge">DEMO</span>
              <p><strong>This is not an AI model.</strong> It recognizes a small set of examples like “make the heading red” or “hide the sidebar.” Connect OpenAI for flexible instructions.</p>
            </div>
          )}

          {formError && <p className="settings-error" role="alert">{formError}</p>}
          {settingsNotice && <p className="settings-notice" role="status">{settingsNotice}</p>}
          <button className="save-button" type="button" onClick={() => void save()}>{saved ? "✓ Saved" : "Save AI setup"}</button>
        </div>
      )}
    </div>
  );
}
