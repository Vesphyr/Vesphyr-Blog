import { syncDesktopLayoutState } from "./main-grid-runtime";
import { initCustomScrollbar } from "./layout-runtime/katex-scrollbar";
import { initFancybox, checkKatex } from "./layout-runtime/fancybox-runtime";
import { initializePanelManager } from "./panel-init";

function runOnDocumentReady(callback: () => void | Promise<void>) {
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        void callback();
      },
      { once: true },
    );
    return;
  }
  void callback();
}

function scheduleIdleTask(task: () => void, timeout = 3000): void {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(task);
    return;
  }

  globalThis.setTimeout(task, timeout);
}

declare global {
  interface Window {
    __layoutRuntimeBound?: boolean;
  }
}

void initializePanelManager();

function handleResize() {
  syncDesktopLayoutState();
}
function reinitPageFeatures() {
  scheduleIdleTask(() => {
    void initFancybox();
  });
  scheduleIdleTask(initCustomScrollbar);
  checkKatex();
  syncDesktopLayoutState();
}

// ClientRouter re-executes module scripts on every in-site navigation, so
// document/window listeners must be registered exactly once — otherwise they
// accumulate and fire N times per event after N navigations.
if (!window.__layoutRuntimeBound) {
  window.__layoutRuntimeBound = true;
  window.addEventListener("resize", handleResize);
  document.addEventListener("astro:page-load", reinitPageFeatures);
}
handleResize();

runOnDocumentReady(async () => {
  reinitPageFeatures();
  await initializePanelManager();
});
