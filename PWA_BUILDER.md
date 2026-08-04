# B9T9 Android app

The mobile/PWABuilder entry point is:

`https://YOUR_DOMAIN/app/`

It uses the same responsive game frontend as the main site. The `/app/` folder contains the install manifest and service worker, while the shared React shell keeps the profile, wallet, chat, notifications, and betting controls consistent with the mobile website.

## PWABuilder

1. Deploy the latest web build.
2. Open [PWABuilder](https://www.pwabuilder.com/) and enter `https://YOUR_DOMAIN/app/`.
3. Confirm that the manifest, icons, installability, and service worker are detected.
4. Choose Android, configure the package name and signing details, then download the generated Android package.

## Showing the download on the normal website

The normal game page now displays an app banner with a `Download` action. The link is configured by `VITE_ANDROID_APP_URL` and defaults to `/downloads/b9t9.apk`.

After downloading the Android package, either:

- Upload the final APK to the deployed web server at `apps/web/public/downloads/b9t9.apk` before building, or
- Host the APK at a stable HTTPS URL and pass that URL during the Docker build:

```bash
docker build --build-arg VITE_ANDROID_APP_URL=https://downloads.example.com/b9t9.apk -t b9t9 .
```

Do not use the temporary PWABuilder download URL in production. Keep the APK at a stable URL so the website button continues to work after future deployments.

The app needs network access for live rounds, sockets, authentication, payments, and wallet updates. The service worker caches the app shell and static assets; it does not cache API responses or live game data.
