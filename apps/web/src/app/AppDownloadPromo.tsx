import { useEffect, useMemo, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const fallbackAndroidUrl = "/downloads/b9t9.apk";

export function AppDownloadPromo() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const androidUrl = useMemo(() => import.meta.env.VITE_ANDROID_APP_URL?.trim() || fallbackAndroidUrl, []);

  useEffect(() => {
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onInstallPrompt);
  }, []);

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  return (
    <aside className="app-download-promo" aria-label="B9T9 app download">
      <div className="app-download-promo__icon" aria-hidden="true">▣</div>
      <div className="app-download-promo__copy">
        <strong>Free Rs 100 · Better experience</strong>
        <span>Experience one-stop gaming with the B9T9 app.</span>
      </div>
      <div className="app-download-promo__actions">
        {installPrompt && <button type="button" onClick={() => void installApp()}>Install app</button>}
        <a href={androidUrl} download={!androidUrl.startsWith("http")} aria-label="Download the B9T9 Android app">Download</a>
      </div>
    </aside>
  );
}
