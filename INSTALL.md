# התקנה על שרת חדש — ענה את השואל

**דומיין:** `aneh.syncup.co.il`
**Stack:** Node.js + React + PostgreSQL + Redis + Nginx + SSL (Let's Encrypt)

---

## דרישות מקדימות

- שרת לינוקס (Ubuntu 22.04 מומלץ)
- Docker + Docker Compose מותקנים
- הדומיין `aneh.syncup.co.il` מפנה ל-IP של השרת

### התקנת Docker (אם לא מותקן)
```bash
curl -fsSL https://get.docker.com | sh
apt install docker-compose-plugin -y
```

---

## שלב 1 — שכפל את הפרויקט

```bash
git clone https://github.com/bot-sync-up/aneh-hashoel.git /opt/aneh-hashoel
cd /opt/aneh-hashoel
```

---

## שלב 2 — צור את קובץ .env

```bash
cp .env.production .env
nano .env
```

**מלא את הערכים הבאים:**
- `DB_PASSWORD` — סיסמה חזקה לבסיס הנתונים
- `REDIS_PASSWORD` — סיסמה חזקה ל-Redis
- `JWT_SECRET` — צור עם הפקודה:
  ```bash
  openssl rand -base64 64
  ```

---

## שלב 3 — קבל SSL (Let's Encrypt)

### 3א. הפעל את Nginx על פורט 80 בלבד (לפני שיש עדיין תעודה)

צור קובץ זמני:
```bash
cat > /tmp/nginx-init.conf << 'EOF'
server {
    listen 80;
    server_name aneh.syncup.co.il;
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 200 "OK";
    }
}
EOF
```

הפעל Nginx זמני:
```bash
docker run --rm -d --name nginx-init \
  -p 80:80 \
  -v /tmp/nginx-init.conf:/etc/nginx/conf.d/default.conf \
  -v aneh-hashoel_certbot_www:/var/www/certbot \
  nginx:1.25-alpine
```

### 3ב. צור את התעודה

```bash
docker run --rm \
  -v aneh-hashoel_certbot_certs:/etc/letsencrypt \
  -v aneh-hashoel_certbot_www:/var/www/certbot \
  certbot/certbot certonly \
  --webroot -w /var/www/certbot \
  -d aneh.syncup.co.il \
  --email admin@syncup.co.il \
  --agree-tos \
  --no-eff-email
```

### 3ג. עצור את Nginx הזמני

```bash
docker stop nginx-init
```

---

## שלב 4 — בנה והפעל

```bash
cd /opt/aneh-hashoel
docker compose up -d --build
```

זה יבנה את כל הקונטיינרים ויפעיל:
- `aneh-postgres` — בסיס נתונים
- `aneh-redis` — קאש
- `aneh-backend` — שרת Node.js
- `aneh-frontend` — React + Nginx פנימי
- `aneh-nginx` — Nginx חיצוני עם SSL (פורטים 80+443)
- `aneh-certbot` — חידוש תעודה אוטומטי כל 12 שעות

---

## שלב 5 — הרץ migrations לבסיס הנתונים

```bash
docker exec aneh-backend node src/db/migrate.js
```

---

## בדיקה

```bash
# בדוק שכל הקונטיינרים רצים
docker compose ps

# בדוק לוגים
docker compose logs -f backend
docker compose logs -f nginx

# בדוק את האתר
curl -I https://aneh.syncup.co.il
```

---

## עדכון גרסה (בעתיד)

```bash
cd /opt/aneh-hashoel
git pull
docker compose up -d --build
```

---

## פקודות שימושיות

```bash
# עצור הכל
docker compose down

# עצור והמחק volumes (מחיקת כל הנתונים!)
docker compose down -v

# לוגים של שירות ספציפי
docker compose logs -f backend
docker compose logs -f nginx

# כניסה לתוך קונטיינר
docker exec -it aneh-backend sh
docker exec -it aneh-postgres psql -U aneh_user -d aneh_hashoel
```
