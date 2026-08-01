# B9T9 Platform Feature Upgrade

## New entry points

- User login: `/`
- Administrator login: `/admin/login`
- Password reset: `/reset-password?token=...`

User accounts cannot sign in through the administrator endpoint, and administrator/sub-admin accounts cannot use the user login endpoint.

## Production environment variables

Add these values to `.env.production` before deploying:

```env
PUBLIC_APP_URL=https://b9t9.games

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=support@b9t9.games
SMTP_PASS=CHANGE_ME
SMTP_FROM=B9T9 Support <support@b9t9.games>

WHATSAPP_NUMBER=923001234567
WHATSAPP_MESSAGE=Hello, I need support with my B9T9 account.
```

`WHATSAPP_NUMBER` must include the country code and contain digits only. SMTP is required for production password-reset delivery.

## Added systems

- User profile, preferences, device sessions, password change and forgot-password reset
- Separate administrator authentication and administrator sign-out
- User-to-admin support conversations over Socket.IO
- Configurable WhatsApp support shortcut
- Admin-managed popup, banner, announcement and news campaigns
- Clickable overview KPIs and one-day bet reporting
- Improved audit filtering, summaries and wallet-ledger view
- Primary-admin-managed sub-admin accounts with page permissions
- User report/ticket workflow
- Public FAQ center and FAQ administration
- Immediate, selected-recipient and scheduled notifications

## Game-control safety

The game-control page implements a transparent **test mode**, not hidden manipulation of real wagers. Real betting is paused while test mode is active. Test mode cannot be enabled or forced while real or queued bets exist. The normal provably-fair crash generation remains the default.

## Deployment

```bash
cd /opt/b9t9
git pull --ff-only origin main
docker compose --env-file .env.production up -d --build --remove-orphans
sleep 10
docker compose ps
curl https://b9t9.games/health
```
