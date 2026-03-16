# ענה את השואל — Rabbi Q&A Platform

פלטפורמה לניהול שאלות ותשובות לרבנים / A full-stack platform for rabbi Q&A management.

---

## תוכן עניינים / Table of Contents

- [דרישות מוקדמות / Prerequisites](#prerequisites)
- [התחלה מהירה עם Docker / Quick Start with Docker](#quick-start-docker)
- [הגדרת סביבת פיתוח ידנית / Manual Dev Setup](#manual-dev-setup)
- [משתני סביבה / Environment Variables](#environment-variables)
- [יצירת משתמש אדמין ראשון / First Admin User](#first-admin-user)
- [הגדרת GreenAPI WhatsApp](#greenapi-whatsapp-setup)
- [הגדרת Mailgun לקבלת מיילים / Mailgun Inbound Email](#mailgun-inbound-email)
- [הגדרת Firebase FCM](#firebase-fcm-setup)
- [הגדרת WordPress Plugin Webhook](#wordpress-plugin-webhook)
- [פריסה בשרת ייצור / Production Deployment](#production-deployment)

---

## Prerequisites

| כלי / Tool | גרסה מינימלית / Min Version |
|------------|----------------------------|
| Node.js    | 20.x LTS                   |
| npm        | 10.x                       |
| Docker     | 24.x                       |
| Docker Compose | 2.x (plugin)           |
| PostgreSQL *(optional, for manual setup)* | 16.x |
| Redis *(optional, for manual setup)*      | 7.x  |

---

## Quick Start with Docker

```bash
# 1. Clone and enter the project
git clone <repo-url>
cd aneh-hashoel

# 2. Create your .env file from the example
cp .env.example .env
# Edit .env and fill in all required values (see Environment Variables below)

# 3. Start all services (Postgres + Redis + Backend + Frontend)
docker-compose up -d

# 4. Run database migrations (first time only)
docker-compose exec backend npm run migrate

# 5. Create the first admin rabbi
docker-compose exec backend node src/scripts/create-admin.js

# 6. Open the app
# Frontend: http://localhost
# Backend API: http://localhost:3001
```

---

## Manual Dev Setup

### 1. Copy and fill the .env file

```bash
cp .env.example .env
# Open .env and fill in all required values
```

### 2. Start infrastructure services (Postgres + Redis only)

```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
```

Or install and run PostgreSQL and Redis locally.

### 3. Install backend dependencies

```bash
cd backend
npm install
```

### 4. Install frontend dependencies

```bash
cd ../frontend
npm install
```

### 5. Run database migrations

```bash
cd ../backend
npm run migrate
```

### 6. Start development servers

In two separate terminals:

**Terminal 1 — Backend:**
```bash
cd backend
npm run dev
# Listening on http://localhost:3001
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
# Vite dev server on http://localhost:5173
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```dotenv
# ── Application ──────────────────────────────────────────
NODE_ENV=development
PORT=3001

# ── PostgreSQL ────────────────────────────────────────────
DB_HOST=localhost
DB_PORT=5432
DB_NAME=aneh_hashoel
DB_USER=aneh_user
DB_PASSWORD=your_strong_password_here

# ── Redis ─────────────────────────────────────────────────
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password_here

# ── JWT ───────────────────────────────────────────────────
JWT_SECRET=generate_with_openssl_rand_base64_64
JWT_EXPIRES_IN=7d

# ── Google OAuth ──────────────────────────────────────────
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:3001/api/auth/google/callback

# ── GreenAPI (WhatsApp) ───────────────────────────────────
GREENAPI_INSTANCE_ID=
GREENAPI_INSTANCE_TOKEN=
GREENAPI_WEBHOOK_SECRET=

# ── Mailgun ───────────────────────────────────────────────
MAILGUN_API_KEY=
MAILGUN_DOMAIN=
MAILGUN_FROM_EMAIL=noreply@yourdomain.com
MAILGUN_INBOUND_WEBHOOK_SECRET=

# ── Firebase (FCM Push Notifications) ────────────────────
FIREBASE_PROJECT_ID=
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json

# ── WordPress Webhook ────────────────────────────────────
WORDPRESS_WEBHOOK_SECRET=

# ── Frontend URLs (used by Vite build) ───────────────────
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001
VITE_GOOGLE_CLIENT_ID=

# ── Misc ──────────────────────────────────────────────────
UPLOAD_MAX_SIZE_MB=10
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
```

> **Generate a strong JWT secret:**
> ```bash
> openssl rand -base64 64
> ```

---

## First Admin User

After running migrations, create the first admin rabbi account:

```bash
# Interactive (prompts for name, email, password)
node src/scripts/create-admin.js

# Or pass arguments directly
node src/scripts/create-admin.js --name "הרב ישראל כהן" --email admin@example.com --password "SecurePass123!"
```

Inside Docker:
```bash
docker-compose exec backend node src/scripts/create-admin.js
```

---

## GreenAPI WhatsApp Setup

1. Register at [green-api.com](https://green-api.com) and create an instance.
2. Copy the **Instance ID** and **Token** into `.env`:
   ```
   GREENAPI_INSTANCE_ID=1234567890
   GREENAPI_INSTANCE_TOKEN=abc123...
   ```
3. In the GreenAPI dashboard → **Webhooks**, set the incoming webhook URL to:
   ```
   https://yourdomain.com/api/webhooks/whatsapp
   ```
4. Set `GREENAPI_WEBHOOK_SECRET` to the secret you configure in the dashboard.
5. Scan the QR code in the GreenAPI dashboard with your WhatsApp phone to link the number.
6. Restart the backend: `docker-compose restart backend`

---

## Mailgun Inbound Email

The platform can receive questions submitted by email.

1. Log in to [mailgun.com](https://mailgun.com) → **Sending** → **Domains** → add your domain.
2. Add the MX records provided by Mailgun to your DNS:

   | Type | Host | Value | Priority |
   |------|------|-------|----------|
   | MX   | `@` or subdomain | `mxa.mailgun.org` | 10 |
   | MX   | `@` or subdomain | `mxb.mailgun.org` | 10 |

3. In Mailgun → **Receiving** → create a route:
   - **Filter expression:** `match_recipient("questions@yourdomain.com")`
   - **Actions:** Forward → `https://yourdomain.com/api/webhooks/email`
   - Check **Store and notify** for reliability.
4. Copy the API key to `.env`:
   ```
   MAILGUN_API_KEY=key-...
   MAILGUN_DOMAIN=yourdomain.com
   ```
5. Set `MAILGUN_INBOUND_WEBHOOK_SECRET` to the signing key found in Mailgun → **Webhooks** → **HTTP Webhook Signing Key**.

---

## Firebase FCM Setup

Push notifications to the rabbi mobile app are sent via Firebase Cloud Messaging.

1. Go to [Firebase Console](https://console.firebase.google.com) → create a project (or use existing).
2. **Project Settings** → **Service Accounts** → **Generate new private key**.
3. Save the downloaded JSON file as `backend/firebase-service-account.json`.
   > **Do not commit this file** — it is in `.gitignore`.
4. Add to `.env`:
   ```
   FIREBASE_PROJECT_ID=your-project-id
   FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json
   ```
5. In the Firebase Console → **Cloud Messaging**, note the **Server Key** if using legacy API (or use the service account for Admin SDK — the platform uses the Admin SDK).

---

## WordPress Plugin Webhook

The companion WordPress plugin sends new questions from WP comment forms to this backend.

1. Install the plugin on your WordPress site.
2. In **WP Admin → ענה את השואל Settings**, enter:
   - **API Endpoint:** `https://yourdomain.com/api/webhooks/wordpress`
   - **Webhook Secret:** the value of `WORDPRESS_WEBHOOK_SECRET` from `.env`
3. The plugin will POST new questions as JSON with a `X-Webhook-Secret` header.
4. Test: submit a question on the WP site and check backend logs.

---

## Production Deployment

### Server Requirements (VPS)

- Ubuntu 22.04 LTS (recommended)
- 2 vCPU, 4 GB RAM minimum
- 40 GB SSD
- Docker + Docker Compose installed

### Steps

```bash
# 1. Install Docker (Ubuntu)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 2. Clone the repo onto the server
git clone <repo-url> /opt/aneh-hashoel
cd /opt/aneh-hashoel

# 3. Set up production .env
cp .env.example .env
nano .env   # fill in production values

# 4. Build and start all services
docker-compose up -d --build

# 5. Run migrations
docker-compose exec backend npm run migrate

# 6. Create admin user
docker-compose exec backend node src/scripts/create-admin.js

# 7. (Optional) Set up Nginx reverse proxy + SSL with Certbot
#    Point yourdomain.com → port 80 (frontend)
#    Point api.yourdomain.com → port 3001 (backend)
```

### Nginx Reverse Proxy with SSL (example)

```nginx
# /etc/nginx/sites-available/aneh-hashoel
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

```bash
# Obtain SSL certificate
sudo certbot --nginx -d yourdomain.com -d api.yourdomain.com
```

### Useful Production Commands

```bash
# View live logs
docker-compose logs -f

# Restart a specific service
docker-compose restart backend

# Pull latest code and rebuild
git pull && docker-compose up -d --build

# Backup the database
docker-compose exec postgres pg_dump -U aneh_user aneh_hashoel > backup_$(date +%Y%m%d).sql
```

---

## Makefile Shortcuts

```bash
make dev        # Start Docker infra + both dev servers
make up         # docker-compose up -d
make down       # docker-compose down
make logs       # docker-compose logs -f
make migrate    # Run DB migrations
make shell-db   # Open psql in the postgres container
make clean      # Remove volumes and rebuild from scratch
```

---

## License

© כל הזכויות שמורות / All rights reserved.
