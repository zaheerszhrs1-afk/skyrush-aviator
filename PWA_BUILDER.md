# B9T9 Android app

The mobile/PWABuilder entry point is:

`https://YOUR_DOMAIN/app/`

It uses the same responsive game frontend as the main site. The `/app/` folder contains the install manifest and service worker, while the shared React shell keeps the profile, wallet, chat, notifications, and betting controls consistent with the mobile website.

## PWABuilder

1. Deploy the latest web build.
2. Open [PWABuilder](https://www.pwabuilder.com/) and enter `https://YOUR_DOMAIN/app/`.
3. Confirm that the manifest, icons, installability, and service worker are detected.
4. Choose Android, configure the package name and signing details, then download the generated Android package.

The app needs network access for live rounds, sockets, authentication, payments, and wallet updates. The service worker caches the app shell and static assets; it does not cache API responses or live game data.
