import { ElementRegistry } from "./elementRegistry";

export function observeForRegistryCleanup(registry: ElementRegistry, reconcile?: () => void): MutationObserver {
  let timer: number | undefined;
  const observer = new MutationObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      registry.cleanup();
      reconcile?.();
    }, 500);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  return observer;
}
