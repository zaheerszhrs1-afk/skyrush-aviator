import { useMemo, useState } from "react";

const fallbackAndroidUrl = "/downloads/b9t9.apk";

export function AppDownloadPromo() {
  const [dismissed, setDismissed] = useState(false);
  const androidUrl = useMemo(() => import.meta.env.VITE_ANDROID_APP_URL?.trim() || fallbackAndroidUrl, []);

  if (dismissed) return null;

  return (
    <aside className="app-download-promo" aria-label="B9T9 app download">
      <button className="app-download-promo__close" type="button" aria-label="Close app download banner" onClick={() => setDismissed(true)}>×</button>
      <img className="app-download-promo__logo" src="/b9t9-logo.webp" alt="B9T9" />
      <div className="app-download-promo__copy">
        <strong>Free Rs 100 Better Experience!</strong>
      </div>
      <div className="app-download-promo__actions">
        <a href={androidUrl} download={!androidUrl.startsWith("http")} aria-label="Download the B9T9 Android app">Download</a>
      </div>
    </aside>
  );
}
