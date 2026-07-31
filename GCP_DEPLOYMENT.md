# B9T9 deployment on Google Compute Engine

This application should run as one persistent VM service because its authoritative Socket.IO game engine is process-resident. Keep one app replica unless the engine is redesigned around shared coordination/state.

## Recommended VM

- Region: use the same region as MongoDB Atlas. For Pakistan-facing traffic, `asia-south2` (Delhi) is usually the closest Google Cloud region when Atlas is also nearby.
- Machine: start with `e2-standard-2` (2 vCPU, 8 GB RAM). Use `e2-medium` only for low traffic/testing.
- OS: Ubuntu 24.04 LTS
- Boot disk: 30 GB balanced persistent disk
- Allow HTTP and HTTPS traffic
- Reserve/promote the VM external IP to static

## 1. Prepare VM

Upload this project to `/opt/b9t9`, then run:

```bash
cd /opt/b9t9
bash deploy/gcp/bootstrap-vm.sh
```

Reconnect to SSH after the script finishes.

## 2. Configure environment

```bash
cd /opt/b9t9
cp .env.gcp.example .env.production
nano .env.production
chmod 600 .env.production
```

Required values:

- `MONGODB_URI`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `CLIENT_ORIGIN=https://b9t9.games,https://www.b9t9.games`

Do not set `VITE_SOCKET_URL`; the frontend and Socket.IO server use the same domain.

In MongoDB Atlas, add only the VM static external IP to Network Access. Transactions used by the wallet/game require an Atlas replica set/cluster; do not replace it with a standalone local MongoDB process.

## 3. Start application

```bash
cd /opt/b9t9
docker compose --env-file .env.production up -d --build
docker compose ps
docker compose logs -f --tail=200 app
```

Local health check:

```bash
curl http://127.0.0.1:4000/health
```

## 4. Configure Nginx

```bash
sudo cp deploy/gcp/nginx-b9t9.conf /etc/nginx/sites-available/b9t9
sudo ln -sf /etc/nginx/sites-available/b9t9 /etc/nginx/sites-enabled/b9t9
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

## 5. Point domain

At the DNS provider, create/update:

- `A` record: `@` -> VM static external IP
- `A` record: `www` -> VM static external IP

Remove old Railway `A`, `AAAA`, or conflicting `CNAME` records. Wait until both names resolve to the VM.

## 6. Enable HTTPS

```bash
sudo certbot --nginx -d b9t9.games -d www.b9t9.games
sudo certbot renew --dry-run
```

Then verify:

```bash
curl -I https://b9t9.games
curl https://b9t9.games/health
```

## Updates

When using Git:

```bash
cd /opt/b9t9
git pull
bash deploy/gcp/update-app.sh
```

When uploading a ZIP, replace project files but preserve `.env.production`, then run:

```bash
cd /opt/b9t9
bash deploy/gcp/update-app.sh
```

## Diagnostics

```bash
docker compose ps
docker compose logs --tail=300 app
sudo nginx -t
sudo tail -n 200 /var/log/nginx/error.log
curl http://127.0.0.1:4000/health
free -h
df -h
```

## Performance notes

- The VM and MongoDB Atlas should be geographically close; database round-trip latency directly affects bet and cash-out operations.
- Keep port `4000` bound to localhost. Public traffic should enter only through Nginx on ports 80/443.
- Keep one application container because the current game engine is authoritative and process-resident.
- If CPU is consistently above 70%, resize to `e2-standard-4`; if RAM is the bottleneck, use a custom VM with more memory.
