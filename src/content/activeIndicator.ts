import type { HistoryState } from "../shared/types";

export function updateActiveIndicator(state: HistoryState): void {
  const existing = document.getElementById("webmod-active-indicator");
  if (state.changeCount === 0) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const host = document.createElement("div");
  host.id = "webmod-active-indicator";
  Object.assign(host.style, { position: "fixed", right: "16px", bottom: "16px", zIndex: "2147483646" });
  const shadow = host.attachShadow({ mode: "closed" });
  const badge = document.createElement("div");
  badge.textContent = "WebMod Agent active — local changes";
  Object.assign(badge.style, {
    background: "#18181b", color: "#fafafa", border: "1px solid rgba(255,255,255,.16)", borderRadius: "999px",
    padding: "8px 12px", font: "600 12px/1 system-ui, sans-serif", boxShadow: "0 8px 30px rgba(0,0,0,.24)"
  });
  shadow.append(badge);
  document.documentElement.append(host);
}
