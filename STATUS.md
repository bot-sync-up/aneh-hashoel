# סטטוס פרויקט — "ענה את השואל" / "שאל את הרב"

עדכון אחרון: 23/04/2026

מסמך זה מסכם איפה כל רכיב עומד: מה פרוס ופעיל, מה נבנה וממתין לפריסה, ומה דורש פעולה ידנית של המשתמש.

---

## 🟢 פעיל ופרוס בייצור

### מערכת הגרעין
| רכיב | מקום | סטטוס |
|------|-----|-------|
| Backend (Node + Express) | `backend/src/` · VPS `64.176.170.219` (`/root/project`) | ✅ רץ |
| Frontend (React + Vite) | `frontend/src/` · `https://ask.moreshet-maran.com` | ✅ רץ |
| PostgreSQL | Docker container `aneh-postgres` | ✅ רץ (מיגרציה 008 אפליקטיבית) |
| Redis | Docker container `aneh-redis` | ✅ רץ |
| WordPress (לקוח) | `https://moreshet-maran.com` | ✅ חיצוני (לא מנוהל על ידינו) |

### אינטגרציות אסינכרוניות שפעילות
- **קבלת שאלות מ-WP**: webhook + polling fallback → `routes/wpWebhook.js`, `questionSyncService.js`
- **מענה במייל**: inbound דרך Mailgun → `routes/emailInbound.js` + `services/emailParser.js` (עם גלאי חתימות חכם)
- **מענה ב-WhatsApp**: Green-API → `services/whatsappService.js`
- **שליחת push לרבנים**: OneSignal WP → `scripts/wp-snippet-onesignal-answer.php` (snippet id=28, active)
- **תרומות**: Nedarim Plus callback + GetHistoryJson hourly sync → `routes/donationsWebhook.js`, `services/nedarimService.js`

### Cron jobs פעילים
- דוחות שבועיים לרבנים (ראשון בבוקר)
- תזכורות לשאלות ממתינות (כל X שעות)
- סנכרון תרומות מ-Nedarim (כל שעה)
- Onboarding drip לשואלים חדשים
- Leads sync מ-questions

### תיקונים אחרונים שפרוסים
- **חתימות מייל מוסרות אוטומטית** ע"פ צורה, לא מחרוזות קשיחות (commit `8696b70`)
- **לידים ריקים לא נוצרים** (commit `fbc2216`)
- **העדפות התראות נשמרות לפי ערוץ** (migration 008, commit `6f6e968`)
- **OneSignal push בפועל נשלח** — per-post opt-in meta נאכף מהsnippet (commit `b3f52a8`)
- **דשבורד "פעילות אחרונה"** — משתמש בזמן האמיתי של האירוע, לא `updated_at`

---

## 🟡 נבנה ופרוס, ממתין למנה סופית מהמשתמש

### PWA באתר WordPress
**סטטוס:** PWA מלא חי בכתובת `https://moreshet-maran.com/ask-rabai/`

| בדיקה | פקודה | תוצאה צפויה |
|-------|------|--------------|
| Manifest | `curl -sI https://moreshet-maran.com/wp-json/aneh-pwa/v1/manifest` | `content-type: application/manifest+json` |
| Service Worker | `curl -sI https://moreshet-maran.com/sw-ask-rabai.js` | `content-type: text/javascript` + `service-worker-allowed: /` |
| Assetlinks (stub) | `curl -s https://moreshet-maran.com/.well-known/assetlinks.json` | `[]` (כרגע ריק, יתמלא אחרי TWA build) |
| תגי head | `curl -sL https://moreshet-maran.com/ask-rabai/ \| grep manifest` | `<link rel="manifest" ...>` קיים |

**פרוס ב-WP:**
- Snippet id=**31** (שם: `Aneh — PWA Install (שאל את הרב)`) — active, scope: global
- Snippet id=**32** (שם: `Aneh TEMP - Flush Rocket Cache`) — **deactivated** (כלי חד פעמי)
- 8 אייקונים ב-media library תחת `wp-content/uploads/2026/04/`

**מה נשאר:**
- המשתמש מתקין מהדפדפן בטלפון — אמור לראות כפתור "התקן את האפליקציה"

---

## 🟠 נבנה אבל טרם פרוס — דורש פעולה ידנית

### TWA — Android app ל-Google Play

**מקום בגיט:** `mobile/android-twa/`

| קובץ | תיאור |
|------|-------|
| `twa-manifest.json` | קונפיג Bubblewrap (package: `com.moreshetmaran.askrabai`, colors, URLs) |
| `package.json` | npm scripts: `init`, `build`, `update`, `doctor`, `fingerprint` |
| `README.md` | runbook מלא בעברית ואנגלית (7 צעדים) |
| `assetlinks-generator.md` | חילוץ SHA256 מה-keystore והטמעה ב-`.well-known/assetlinks.json` |
| `play-console-upload.md` | העלאה ל-Play Console + Internal Testing → Production |
| `.gitignore` | מחריג `android.keystore`, `app/`, `*.aab`, `*.apk` |

**דרישות מקומיות למשתמש:**
- Node.js 18+
- **JDK 17** (לא 11, לא 21 — Bubblewrap דורש במדויק 17)
- Android SDK (Bubblewrap מתקין אוטומטית עם `npx bubblewrap doctor`)

**רצף פעולות:**
```bash
cd mobile/android-twa
npm install
npx bubblewrap doctor                     # מתקין SDK/JDK חסרים
npx bubblewrap init --manifest=./twa-manifest.json
# הוא שואל על keystore password — שמור במקום בטוח!
npx bubblewrap build                      # יוצר app-release-bundle.aab
keytool -list -v -keystore android.keystore -alias android
# העתק את השורה SHA256: AA:BB:...
```

**אחרי שמקבלים את ה-SHA256:**
1. שלח את המחרוזת SHA256 לשיחה עם Claude
2. Claude יעדכן את ה-snippet של PWA כדי לשרת `.well-known/assetlinks.json` עם ה-SHA256 הנכון
3. Claude יפרוס שוב
4. המשתמש ירוץ `adb install app-release-signed.apk` להתקנה מקומית ויוודא שאין סרגל דפדפן למעלה

### Play Store listing

**מקום בגיט:** `mobile/play-store-listing/`

| קובץ | תוכן |
|------|------|
| `01-basics.md` | שם אפליקציה, package, שפה, קטגוריה (Books & Reference), תגים |
| `02-short-description.md` | 3 וריאציות (עד 80 תווים), המלצה: Variation A |
| `03-full-description.md` | טקסט מלא עד 4000 תווים — הוק, מה עושה, למי, על המרכז, features, CTA |
| `04-keywords.md` | 20 keywords בעברית + טיפים ל-ASO |
| `05-graphics-brief.md` | מפרט + brief ל-icon, feature graphic (1024×500), 5 screenshots עם overlay |
| `06-privacy-policy.md` | Privacy policy מלא (~1500 מילים) — להעלות כעמוד ב-WP |
| `07-content-rating.md` | תשובות לשאלון תוכן של Google (UGC: כן, ageRating: Everyone) |
| `08-release-notes-v1.md` | "מה חדש" לv1.0 (עד 500 תווים) |

**פעולות ידניות (רק המשתמש יכול, לא Claude):**
1. לצלם 5 מסכים מהאפ על מכשיר אנדרואיד אמיתי (אחרי TWA install)
2. להעלות את ה-privacy policy כעמוד ב-WP ולקבל URL (נניח `/privacy`)
3. להיכנס ל-`https://play.google.com/console` עם החשבון הקיים
4. Create app → למלא לפי הקבצים ב-`mobile/play-store-listing/`
5. העלאת `app-release-bundle.aab` ל-Internal Testing תחילה
6. לאחר אישור Internal Testing → promote ל-Production
7. אישור גוגל סופי תוך 2-7 ימים

### ⚠️ הערה חשובה לאחר העלאה ראשונית ל-Play
Google מחתים את ה-AAB מחדש עם **App Signing Key** שלה. זה מייצר **SHA256 שני** שחייב להתווסף ל-assetlinks.json, אחרת משתמשים שהתקינו מ-Store יראו סרגל כתובת מציק באפ.

**נוהל:**
1. לאחר העלאה ראשונה ל-Play Console, לך ל-`App signing`
2. העתק את ה-`App signing key certificate` SHA-256
3. שלח לשיחה — Claude יוסיף entry שני ל-assetlinks.json
4. Claude יפרוס snippet מעודכן

---

## 📂 מבנה תיקיות פעיל

```
aneh-hashoel/
├── backend/               # Node.js API (פרוס בשרת)
│   ├── src/
│   │   ├── services/      # questionService, emailParser (חתימות חכמות), nedarimService, ...
│   │   ├── routes/        # questions, rabbis, leads, donations, emailInbound, ...
│   │   ├── cron/          # pendingReminder, weeklyReport, onboardingDrip, nedarimSync
│   │   └── db/migrations/ # 001-008 (008 = notification_preferences per-channel)
│   └── scripts/           # ops scripts (reclean-answers, etc.) — כלול ב-Docker image
├── frontend/              # React + Vite (פרוס ב-ask.moreshet-maran.com)
├── scripts/               # כלי ניהול (מקומיים, לא ב-prod)
│   ├── wp-snippet-pwa.php                — snippet PWA פעיל ב-WP (id=31)
│   ├── wp-snippet-onesignal-answer.php   — snippet OneSignal פעיל (id=28)
│   ├── wp-snippet-flush-cache.php        — snippet חד פעמי (id=32, deactivated)
│   ├── deploy-pwa-snippet.py             — פריסת PWA snippet
│   ├── deploy-wp-onesignal-snippet.py    — פריסת OneSignal snippet
│   ├── upload-pwa-icons-to-wp.py         — העלאת אייקונים ל-WP media
│   ├── generate-pwa-icons.js             — יצירת 8 אייקונים מהלוגו
│   └── pwa-icons/                         — אייקונים מוכנים (192, 512, maskable, apple, favicons, play feature)
└── mobile/                # חומר לכל אפליקציית מובייל
    ├── android-twa/       # Bubblewrap scaffold ל-TWA
    └── play-store-listing/ # תוכן ב-Hebrew ל-Google Play
```

---

## 💰 עלויות

| פריט | סוג | סטטוס |
|------|-----|-------|
| VPS (Vultr) | חודשי | קיים |
| דומיין moreshet-maran.com | שנתי | קיים |
| WordPress hosting | חודשי | קיים |
| **Google Play Developer** | חד פעמי $25 | ✅ יש למשתמש |
| Apple Developer | שנתי $99 | ❌ לא משלמים (iOS דרך PWA-Safari) |
| Nedarim Plus | % תרומות | קיים |
| Mailgun | tier חינמי | קיים |
| OneSignal | tier חינמי | קיים |
| Green-API (WhatsApp) | חודשי | קיים |

**סכום חדש שצריך להוציא לMVP:** 0 ₪ — הכל נבנה על תשתית קיימת או עם כלים חינמיים.

---

## 📋 Todo המסתכל קדימה

### מיידי (המשתמש)
- [ ] להתקין JDK 17 ולרוץ `npx bubblewrap init && npx bubblewrap build`
- [ ] לשלוח SHA256 מ-keystore — Claude יעדכן assetlinks
- [ ] להתקין את ה-APK על מכשיר ולוודא שאין סרגל דפדפן
- [ ] להעלות privacy policy כעמוד ב-WP
- [ ] לצלם 5 screenshots על מכשיר אמיתי
- [ ] להעלות ל-Play Console Internal Testing

### בעקבות שחרור (המשתמש)
- [ ] לשלוח SHA256 של Play App Signing — Claude יוסיף ל-assetlinks
- [ ] Promote Internal Testing → Production
- [ ] לעקוב אחרי reviews + crash reports ב-Play Console

### אופציונלי בעתיד
- [ ] Apple iOS app (דרך Capacitor) — רק אם יש ביקוש מוכח מאייפון
- [ ] ASO iteration — A/B test על 02-short-description
- [ ] מעבר מ-TWA ל-Capacitor (אם נדרש offline מלא או פיצ'רים native)
- [ ] Push notifications למשתמשי PWA (web-push עצמאי במקום OneSignal-WP)
