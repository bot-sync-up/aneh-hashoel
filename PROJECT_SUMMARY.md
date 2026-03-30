# ענה את השואל — PROJECT SUMMARY
> נוצר: מרץ 2026 | סיכום מלא של מה שנבנה, האפיון, והמצב הנוכחי

---

## מה זה?

**"ענה את השואל"** — פלטפורמה לניהול שאלות ותשובות הלכתיות עבור **המרכז למורשת מרן**.

מחליפה מערכת n8n ידנית בפתרון מלא ומותאם אישית:
- ~100 רבנים עונים על שאלות הלכה
- שאלות מגיעות מאתר הוורדפרס הקיים (moreshet-maran.com)
- ממשק ייעודי לרבנים לניהול, תשובה, ושיתוף פעולה

**URL:** https://aneh.syncup.co.il
**Server:** 64.176.170.219 (VPS, PM2 + Nginx)
**Repo:** github.com/bot-sync-up/aneh-hashoel

---

## Stack טכנולוגי

| שכבה | טכנולוגיה |
|------|-----------|
| Backend | Node.js + Express |
| Frontend | React 18 + Vite + Tailwind CSS |
| DB | PostgreSQL 16 |
| Cache | Redis 7 |
| Real-time | Socket.io |
| Email שליחה | Nodemailer (SMTP) |
| Email קבלה | IMAP polling (כל 2 דקות) |
| WhatsApp | GreenAPI |
| Push | Firebase FCM |
| Auth | JWT + Refresh tokens + Google OAuth + 2FA (TOTP) |
| WP Integration | REST API + Webhooks + Code Snippets |
| CRM | Google Sheets API |
| Payments | Nedarim Plus (webhook) |

---

## מה נבנה — פיצ'רים מלאים (125 פיצ'רים, 98.4% מומשו)

### אותנטיקציה
- JWT + Refresh tokens (cookie)
- Google OAuth (server + client side)
- 2FA/TOTP עם QR code
- שכחתי סיסמה + איפוס
- הגדרת סיסמה ראשונית (new rabbi onboarding)
- ניהול sessions פעילים + ביטול
- התראה על כניסה ממכשיר חדש
- הרשאות: `rabbi` / `admin` / `customer_service`
- Magic links לפעולות מתוך אימייל

### ניהול שאלות
- רשימה עם פילטרים (סטטוס, קטגוריה, חיפוש, דחיפות, תאריך)
- תפיסה (claim) עם lock מנגנון
- שחרור + העברה לרב אחר
- סימון דחוף (admin)
- הסתרת שאלה (admin)
- חיפוש Full-text
- שאלות המשך (follow-up)
- תודה מהשואל (עם dedup ו-Redis)
- Draft (טיוטה) — שמירה לפני פרסום
- Real-time updates דרך Socket.io

### מערכת תשובות
- Rich text editor (TipTap)
- פרסום + עריכה לאחר פרסום (חלון 30 דקות)
- היסטוריית גרסאות מלאה
- תשובה לשאלת המשך
- תבניות תשובה אישיות לכל רב
- הערות פרטיות (private notes, לא נראות לשואל)

### דיונים בין רבנים
- חדרי דיון (כלליים + מקושרים לשאלה ספציפית)
- הודעות real-time דרך Socket.io
- הצמדת הודעה (pin)
- emoji reactions (👍 📖 ✅ ❓ ⭐)
- עריכה + מחיקה רכה של הודעה
- typing indicator
- נעילת דיון
- ניהול חברים (הוספה/הסרה)
- ספירת לא-נקראו

### התראות
- In-app notification feed עם badge
- העדפות per event type
- Email / WhatsApp / Push (FCM) לפי העדפת הרב
- Notification router בוחר ערוץ אוטומטית

### פרופיל רב
- פרטים אישיות + חתימה
- קטגוריות מועדפות
- מצב חופשה עם טווח תאריכים
- שעות זמינות שבועיות
- הגדרות אבטחה (2FA, החלפת סיסמה)
- רישום FCM token למכשיר

### דשבורד רב
- סטטיסטיקות אישיות (שבוע/חודש/סה"כ)
- גרף פעילות (Recharts)
- גרף קטגוריות (Pie)
- פיד פעילות
- רבנים מחוברים עכשיו (online)
- לוח מצטיינים (leaderboard)

### פאנל אדמין (14 עמודים)
- דשבורד עם KPIs בזמן אמת
- ניהול רבנים (CRUD + הפעלה/השבתה + שינוי תפקיד)
- ניהול שאלות (bulk actions, CSV export)
- ניהול קטגוריות (עץ היררכי + drag-drop)
- הגדרות מערכת (timeout, ניוזלטר, שעות)
- Audit log מלא
- בריאות מערכת (health check — DB, Redis, WP, GreenAPI)
- מצב חירום (broadcast לכל הרבנים)
- ניוזלטר (בחירת שאלות + שליחה + ארכיון)
- תבניות אימייל
- ניהול support tickets
- תרומות (Nedarim Plus)
- ביצועי רבנים (performance table)

### CRM — לידים
- רשימת לידים עם פילטרים (hot/urgent/contacted)
- סינכרון Google Sheets אוטומטי
- Click tracking — סימון "hot" לפי פעילות
- ייצוא CSV
- הערות מגע + סימון contacted

### אינטגרציות חיצוניות
| מערכת | מה עושה |
|-------|---------|
| WordPress | Webhook לשאלה חדשה/עדכון/תודה; sync של רבנים, קטגוריות, שאלות |
| WP Snippet | כפתור תודה + טופס שאלת המשך בתוך דפי ask-rabai |
| Mailgun | קבלת אימיילים (שאלות נשלחות במייל) |
| IMAP Polling | רב עונה דרך reply לאימייל (כל 2 דקות) |
| GreenAPI | WhatsApp דו-כיווני — שאלות + תשובות |
| Firebase FCM | Push notifications לנייד |
| Nedarim Plus | Webhook לתרומות |
| Google Sheets | ייצוא לידים |
| Mailwizz | Email marketing integration |

### Cron Jobs (11 משימות)
- Daily digest, Weekly newsletter, Weekly report
- IMAP poller (כל 2 דקות)
- Rabbi of the week
- Holiday greetings
- Warning/Timeout checks על שאלות
- Google Sheets sync
- WP sync retry
- Onboarding drip campaign

### אבטחה
- Rate limiting (API / auth / write / thank)
- Helmet security headers
- PII encryption (AES-256-CBC) על אימייל וטלפון
- Webhook signature validation (WP, Mailgun, Nedarim)
- Audit logging של פעולות אדמין
- CORS מוגדר (aneh.syncup.co.il + moreshet-maran.com)

---

## מסד הנתונים — 18 Migrations

| Migration | תוכן |
|-----------|------|
| 001 | Schema ראשוני: rabbis, questions, answers, categories, discussions |
| 002 | Indexes לביצועים |
| 003 | is_private לתשובות |
| 004 | CRM leads |
| 005-007 | שיפורי קטגוריות, WP link, תבניות |
| 008 | FCM tokens |
| 009-010 | Notified status, WP term ID, support requests |
| 011-013 | Support messages, unique constraints, dedup טלפון |
| 014 | Full-text search indexes |
| 015 | Newsletter archive |
| 016 | Donations tracking |
| 017 | Lead click tracking + Onboarding queue |
| 018 | draft_content + draft_updated_at בטבלת questions |
| Fix | follow_up_questions table + missing columns |

---

## Real-time Events (Socket.io)

### Questions
`question:new` / `question:claimed` / `question:released` / `question:answered` / `question:transferred` / `question:urgent` / `question:thankReceived` / `question:statusChanged` / `question:followUpReceived`

### Discussions
`discussion:message` / `discussion:messageEdited` / `discussion:messageDeleted` / `discussion:messagePinned` / `discussion:reaction` / `discussion:typing` / `discussion:locked` / `discussion:closed`

### Notifications
`notification:new` / `notification:emergency` / `notification:badgeUpdate` / `notification:newDeviceAlert`

### Other
`lead:hot` / `rabbi:weeklyWinner`

---

## מה חסר / פריטים חלקיים

| פריט | מצב | הערה |
|------|-----|------|
| Draft endpoint ייעודי | ⚠️ | PUT/GET `/draft/:id` קיים אבל לא בשימוש — הפרונט משתמש ב-`POST /answer/:id` עם `publishNow:false` |
| DiscussionDetailPage | ✅ תוקן | redirect אוטומטי ל-`/discussions?d=:id` |
| WP snippet — מיקום | ✅ תוקן | שונה מ-`the_content` (לא עובד עם Elementor) ל-`wp_footer` |
| WP thank/follow-up API | ✅ תוקן | תמיכה ב-wp_post_id (לא רק UUID) |
| Mobile app | ❌ לא בנוי | FCM tokens מוכן, אפליקציה עצמה לא קיימת |
| Email delivery tracking | ⚠️ | routes קיימות (emailWebhook.js) אבל לא מחובר לממשק |

---

## מבנה תיקיות

```
aneh-hashoel/
├── backend/
│   ├── src/
│   │   ├── routes/          # 27 route files, 173+ endpoints
│   │   ├── services/        # 30 service files
│   │   ├── middleware/       # 12 middleware files
│   │   ├── cron/jobs/       # 11 scheduled jobs
│   │   ├── db/migrations/   # 18+ SQL migrations
│   │   ├── socket/          # Socket.io helpers
│   │   ├── templates/       # Email HTML templates
│   │   └── utils/           # encryption, logger, etc.
│   └── tests/               # Jest unit + integration tests
├── frontend/
│   └── src/
│       ├── pages/           # 42 pages (19 general + 15 admin + 8 auth)
│       ├── components/      # 113 components
│       ├── contexts/        # AuthContext, SocketContext, ThemeContext
│       └── hooks/           # useApi, useDebounce, useInfiniteScroll, etc.
├── scripts/
│   └── wp-snippet-thank-followup.php  # WP Code Snippet (ID:25 on moreshet-maran.com)
├── nginx/                   # Nginx reverse proxy config
├── docker-compose.yml
└── Makefile
```

---

## Deploy

**שרת:** 64.176.170.219 | root | PM2
**PM2 processes:** `backend` (id:0) + `frontend` (id:5)
**Project path:** `/opt/aneh-hashoel/`

```bash
# Update server
ssh root@64.176.170.219
cd /opt/aneh-hashoel && git pull origin main
pm2 restart backend
pm2 restart frontend   # רק אם יש שינויים בפרונט (אחרי npm run build)
```

**WP Snippet update:**
```bash
cd backend && node ../scripts/install-wp-snippet.js
```
*(Snippet ID: 25 — "Thank Button + Follow-up" — Active)*

---

## API Endpoints — סיכום

| קטגוריה | Endpoints |
|---------|-----------|
| Auth | 20 (login, OAuth, 2FA, sessions, password) |
| Questions | 18 (CRUD, claim, release, transfer, answer, follow-up, thank) |
| Discussions | 18 (rooms, messages, reactions, pins, members) |
| Rabbis | 17 (profile, templates, stats, availability, vacation) |
| Admin | 30+ (dashboard, questions, rabbis, system, sync, donations) |
| Notifications | 5 |
| Leads/CRM | 4 |
| Support | 6 |
| Webhooks | 7 (WP, email, WhatsApp, Nedarim) |
| **סה"כ** | **~130 endpoints** |

---

## צבעי המערכת
- Navy: `#1B2B5E`
- Gold: `#B8973A`
- Warm White: `#F8F6F1`
- Font: Polin / Heebo

---

*נוצר אוטומטית | aneh-hashoel v0.1.0*
