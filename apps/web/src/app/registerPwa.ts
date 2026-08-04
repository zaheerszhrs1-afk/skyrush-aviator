const isAppRoute = () => window.location.pathname === "/app" || window.location.pathname.startsWith("/app/");

export function registerAppPwa(): void {
  if (!isAppRoute()) return;

  document.documentElement.dataset.b9t9Route = "app";
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" }).catch((error) => {
      console.warn("B9T9 app service worker registration failed", error);
    });
  }, { once: true });
}
