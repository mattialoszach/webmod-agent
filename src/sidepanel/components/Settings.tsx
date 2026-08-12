import { useEffect, useState } from "react";
import type { ProviderSettings } from "../../shared/types";

const DEFAULTS: ProviderSettings = { provider: "mock", apiKey: "", model: "gpt-5.6-luna" };

export function Settings(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<ProviderSettings>(DEFAULTS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void chrome.storage.local.get({ ...DEFAULTS }).then((stored) => {
      setSettings({
        provider: stored.provider === "openai" ? "openai" : "mock",
        apiKey: typeof stored.apiKey === "string" ? stored.apiKey : "",
        model: typeof stored.model === "string" ? stored.model : DEFAULTS.model
      });
    });
  }, []);

  async function save(): Promise<void> {
    await chrome.storage.local.set(settings);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  }

  return (
    <div className="settings">
      <button className="settings-toggle" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>AI provider</span>
        <span className="provider-pill">{settings.provider === "mock" ? "Mock" : "OpenAI"}</span>
      </button>
      {open && (
        <div className="settings-body">
          <label>
            Provider
            <select
              value={settings.provider}
              onChange={(event) => setSettings((current) => ({ ...current, provider: event.target.value === "openai" ? "openai" : "mock" }))}
            >
              <option value="mock">Mock (no API key)</option>
              <option value="openai">OpenAI Responses API</option>
            </select>
          </label>
          {settings.provider === "openai" && (
            <>
              <label>
                API key
                <input
                  type="password"
                  value={settings.apiKey}
                  placeholder="sk-…"
                  autoComplete="off"
                  onChange={(event) => setSettings((current) => ({ ...current, apiKey: event.target.value }))}
                />
              </label>
              <label>
                Model
                <input
                  value={settings.model}
                  onChange={(event) => setSettings((current) => ({ ...current, model: event.target.value }))}
                />
              </label>
              <p className="settings-note">The key is stored in Chrome extension storage and is never exposed to the webpage.</p>
            </>
          )}
          <button className="save-button" type="button" onClick={() => void save()}>{saved ? "Saved" : "Save settings"}</button>
        </div>
      )}
    </div>
  );
}
