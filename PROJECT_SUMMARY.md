# ענה את השואל — PROJECT SUMMARY
> נוצר: מרץ 2026 | עודכן: אפריל 2026 | סיכום מלא של מה שנבנה, האפיון, והמצב הנוכחי

---

## מה זה?

**"ענה את השואל"** — פלטפורמה לניהול שאלות ותשובות הלכתיות עבור **המרכז למורשת מרן**.

מחליפה מערכת n8n ידנית בפתרון מלא ומותאם אישית:
- ~100 רבנים עונים על שאלות הלכה
- שאלות מגיעות מאתר הוורדפרס הקיים (moreshet-maran.com)
- ממשק ייעודי לרבנים לניהול, תשובה, ושיתוף פעולה

**Production URL:** https://ask.moreshet-maran.com
**Server:** ראה קובץ זיכרון מקומי (`server_aneh_hashoel.md`) — השרת הישן (64.176.170.219) נמחק
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
- **אכיפה בפועל של `notification_preferences`** — כל מייל עובר בדיקה לפי אירוע+ערוץ לפני שליחה (פרט למייל חירום)
- **מנגנון הסרה מרשימת תפוצה (§30א חוק הספאם)** — עמודת `is_unsubscribed` בטבלת `leads`, JWT tokens, דף `/unsubscribe` ציבורי, footer עם קישור במיילים שיווקיים
- **מיילים לשואלים מבחינים בקהל** (`audience='asker'`) — בלי קישור "כניסה למערכת"
- **Reminder ל-overdue pending questions** — admin-configurable (enabled/hours/remind-every), cron שעתי, כפתור "הפעל עכשיו" לבדיקה
- **מייל "הסיסמה שלך שונתה"** — נשלח אוטומטית אחרי שינוי סיסמה; לא מכיל את הסיסמה; כולל IP + user-agent + timestamp לצורכי אבטחה

### מערכת תבניות מיילים (Centralized Email Templates)
- **Single source of truth**: `system_config['email_templates']` (JSONB) — עורך הממשק כותב לפה, כל מייל קורא מפה
- `constants/defaultEmailTemplates.js` — ברירות מחדל; seed אוטומטי ל-DB ב-startup
- `services/emailTemplates.js` — helper מרכזי: `getTemplate()` / `renderTemplate()` / `sendTemplated()` / `buildUnsubscribeLink()`
- Cache בזיכרון עם TTL של דקה, invalidated מיד כשה-admin שומר שינויים
- תבניות זמינות: welcome, rabbi_new_question, rabbi_thank, rabbi_weekly_report, rabbi_already_claimed, rabbi_release_confirmation, rabbi_answer_confirmation, rabbi_follow_up, **rabbi_pending_reminder**, asker_question_received, asker_answer_ready, asker_follow_up, asker_private_answer, onboarding_1/2/3, password_reset, **password_changed**, new_device, **admin_category_new**

### תרומות — שילוב מלא עם Nedarim Plus
- **Webhook (PUSH)** — `/webhook/nedarim` מקבל POST אמיתי מנדרים (PascalCase fields: `TransactionId`, `Amount`, `Currency` 1=ILS/2=USD וכו'); אותנטיקציה דרך `NEDARIM_WEBHOOK_SECRET`
- **GetHistoryJson (PULL)** — cron שעתי שמושך גיבוי של כל העסקאות (נדרים **לא מנסים שוב** על webhook שנכשל!); עוקב אחרי `nedarim_sync_last_id`
- **`services/nedarimService.js`**: `mapNedarimPayload()` + `parseComments()` + `fetchHistory()` + `upsertDonation()` (idempotent על TransactionId)
- **correlation**: ה-WP snippet מטמיע `Comments=q:<post_id>` באיפרם → webhook מחלץ ומשייך תרומה לשאלה/רב
- **Auto-attribution ללידים**: כל תרומה שמגיעה עם email/phone של לead קיים — מקושרת אוטומטית (לפי SHA-256 hash)

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
- רבנים מחוברים עכשיו (online) — **נקרא מ-Socket.io Map (לא מ-DB)**, נתון תמיד עדכני
- **לוח מצטיינים כ-widget** (Top 5, highlight לרב הנוכחי)

### פאנל אדמין (15 עמודים)
- דשבורד עם KPIs בזמן אמת
- ניהול רבנים (CRUD + הפעלה/השבתה + שינוי תפקיד + **איפוס סיסמה לרב אחר**)
- ניהול שאלות (bulk actions, CSV export, **עריכת כותרת + סנכרון ל-WP**)
- ניהול קטגוריות (עץ היררכי + drag-drop + **מייל לאדמינים כשרב מציע קטגוריה**)
- הגדרות מערכת (timeout, שעות, **תזכורת שאלות ממתינות**, **ניוזלטר on/off**)
- Audit log מלא
- בריאות מערכת (health check — DB, Redis, WP, GreenAPI)
- מצב חירום (broadcast לכל הרבנים)
- ניוזלטר (בחירת שאלות + שליחה + ארכיון + **toggle הפעלה/כיבוי**)
- תבניות אימייל (**audience-aware preview** — בלי קישור כניסה במיילי שואלים)
- ניהול support tickets
- תרומות (Nedarim Plus)
- ביצועי רבנים (performance table)
- **לוח מצטיינים (leaderboard) — עמוד מלא + API לא-אדמין לרבנים**
- **אדמין רואה תשובות פרטיות** (רגיל — מוסתר משאר הרבנים)

### CRM — לידים
- רשימת לידים עם פילטרים (hot/urgent/contacted)
- סינכרון Google Sheets אוטומטי
- Click tracking — סימון "hot" לפי פעילות
- ייצוא CSV (כולל **עמודת "הוסר/ה מרשימת תפוצה"**)
- הערות מגע + סימון contacted
- **Badge "הוסר/ה"** על לידים שעשו opt-out
- אימייל+טלפון מוצגים מלא למנהל (שירות לקוחות רואה רק טלפון)
- **תג תרומות** (❤️ 3 · ₪450) מוצג ישיר בשורה ברשימה
- **כרטסת ליד מלאה** (`/admin/leads/:id` וגם `/leads/:id` ל-CS): header עם badges (hot/contacted/unsubscribed), 4 KPIs (שאלות/תרומות/סה"כ ₪/ציון עניין), טבלת תרומות (תאריך/סכום/סוג/כרטיס/בעקבות איזה שאלה/אישור), רשימת שאלות עם ניווט לדף השאלה, הערות עם שמירה

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

### Cron Jobs (13 משימות)
- Daily digest, Weekly newsletter (עם **toggle** מההגדרות), Weekly report
- IMAP poller (כל 2 דקות)
- Rabbi of the week
- Holiday greetings
- Warning/Timeout checks על שאלות
- Google Sheets sync
- WP sync retry
- Onboarding drip campaign (**מכבד `is_unsubscribed`** + טוען מ-templates)
- **Pending questions reminder** (שעתי; admin-configurable)
- **Nedarim history sync** (שעתי; גיבוי ל-webhook — נדרים לא מנסים שוב!)

### אבטחה
- Rate limiting (API / auth / write / thank)
- Helmet security headers
- PII encryption (AES-256-CBC) על אימייל וטלפון
- Webhook signature validation (WP, Mailgun, Nedarim)
- Audit logging של פעולות אדמין
- CORS מוגדר (aneh.syncup.co.il + moreshet-maran.com)

---

## מסד הנתונים — 22 Migrations

| Migration | תוכן |
|-----------|------|
| 001_full_schema | Schema ראשוני: rabbis, questions, answers, categories, discussions (+is_unsubscribed/unsubscribed_at על leads) |
| 002_leads_unsubscribe | עמודות + אינדקס חלקי על `is_unsubscribed=TRUE` |
| 003_pending_reminder | עמודת `last_reminder_at` + אינדקס חלקי + ברירת מחדל ב-system_config |
| **004_donations_nedarim** | transaction_id (UNIQUE), transaction_type, confirmation, tashloumim, first_tashloum, keva_id, last_num, source, raw_payload בטבלת donations. Seed של nedarim_sync_enabled + nedarim_sync_last_id |
| **005_donations_to_leads** | donations.lead_id FK → leads(id) + backfill תרומות ישנות לפי email/phone hash |
| (legacy 001) | Indexes לביצועים |
| (legacy 003) | is_private לתשובות |
| (legacy 004) | CRM leads |
| (legacy 005-007) | שיפורי קטגוריות, WP link, תבניות |
| (legacy 008) | FCM tokens |
| (legacy 009-010) | Notified status, WP term ID, support requests |
| (legacy 011-013) | Support messages, unique constraints, dedup טלפון |
| (legacy 014) | Full-text search indexes |
| (legacy 015) | Newsletter archive |
| (legacy 016) | Donations tracking |
| (legacy 017) | Lead click tracking + Onboarding queue |
| (legacy 018) | draft_content + draft_updated_at בטבלת questions |
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
| WP snippet — פופאפ תודה | ✅ תוקן | "תודתך נשלחה" עם כפתור לתרומה לפני פתיחת Nedarim |
| user_thanks notification | ✅ תוקן | כעת יוצר רשומה ב-notifications_log + socket `notification:new` לרב בזמן אמת |
| ENCRYPTION_KEY | ✅ תוקן | מפתח 32 תווים בדיוק בשרת — WP sync עובד על כל השאלות |
| WP sync status filter | ✅ תוקן | שונה מ-`status:pending` ל-`status:publish` — שאלות מסתנכרנות כעת |
| Online rabbis = 0 | ✅ תוקן | משתמש ב-`connectedRabbis` Map מ-Socket.io במקום DB stale |
| תשובה פרטית לאדמין | ✅ תוקן | Frontend: `!isAdmin` בתנאי ההסתרה; Backend כבר היה תקין |
| Notification preferences save | ✅ תוקן | המרה מאובייקט לארה"ב לפני PUT |
| Notification preferences אכיפה | ✅ תוקן | `_isEventEnabled` מופעל ב-`notificationRouter._dispatchEmail` |
| "כניסה אחרונה" ריק | ✅ תוקן | `updateLastLogin()` עכשיו מעדכן את העמודה הנכונה `last_login_at` |
| "תשובות החודש" תמיד 0 | ✅ תוקן | COUNT ישיר על answers table עם `date_trunc('month')` — זמן אמת |
| יומן פעילות ריק | ✅ תוקן | login/logout/password_changed כולם נרשמים ב-audit_log |
| שינוי סיסמה — הודעה גנרית | ✅ תוקן | הפרונט קורא `data.error` מהbackend + client-side validation מלא + תיבת הנחיות |
| Nedarim webhook לא עובד | ✅ תוקן | שכתוב מלא של donationsWebhook.js לקבל את הפורמט האמיתי (PascalCase) |
| Source of donations data | ✅ תוקן | Webhook (push, real-time) + GetHistoryJson (pull, שעתי, backup) |
| קישור תרומות ללידים | ✅ תוקן | auto-attribute לפי email/phone hash; גלוי בכרטסת הליד |
| Email templates hardcoded | ✅ תוקן (רוב) | onboarding + categories + password_changed + pending_reminder = מתבניות; askerNotification + welcome = עדיין inline (סבב הבא) |
| דף מעבר תרומה ב-WP (תודה → Nedarim Plus) | ✅ תוקן | פופאפ "תודתך נשלחה" ב-WP snippet (Deployed to snippet ID 25) |
| מקור מייל "היכרות" | ✅ תוקן | `onboardingDrip` טוען מ-templates; אם תערוך בממשק זה יתפוס |
| Mobile app | ❌ לא בנוי | FCM tokens מוכן, אפליקציה עצמה לא קיימת |
| Email delivery tracking | ⚠️ | routes קיימות (emailWebhook.js) אבל לא מחובר לממשק |
| askerNotification refactor | ⚠️ ברשימה | עובד כרגע inline; סבב הבא יעביר ל-`sendTemplated()` כדי שעריכה בממשק תשפיע |

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

**שרת ישן (64.176.170.219) — נמחק.** פרטי השרת החדש נשמרים בקובץ הזיכרון המקומי.

### פריסה לשרת החדש (Docker Compose)

```bash
# על השרת, בתיקיית הפרויקט
git pull origin main

# אם יש migration חדש:
docker compose exec -T postgres psql -U postgres -d aneh_hashoel \
  < backend/src/db/migrations/003_pending_reminder.sql

# בנייה מחדש + הרצה
docker compose build --no-cache backend frontend
docker compose up -d

# לוודא שה-cron עלה
docker compose logs backend | grep "pendingQuestionsReminder"
```

### פריסה ללא Docker (PM2, אם עדיין בשימוש)

```bash
git pull origin main
cd backend && npm install && npm run migrate
pm2 restart backend
cd ../frontend && npm install && npm run build
pm2 restart frontend
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
