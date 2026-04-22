# Google Play Console — First Upload Guide

> You already have a Google Play Developer account ($25 one-time fee paid).
> This walks through creating the app and shipping the first build to an
> internal testing track, then promoting to production.

---

## Before you start — checklist

- [ ] `app-release-bundle.aab` built successfully from `npx bubblewrap build`
- [ ] The bundle is signed with your `android.keystore`
- [ ] Digital Asset Links verified on-device (no URL bar in app)
- [ ] Store listing assets ready (the third agent prepared these at
      `D:\cluade\aneh-hashoel\mobile\play-store-listing\`):
  - App icon (512×512 PNG)
  - Feature graphic (1024×500 PNG)
  - 2–8 phone screenshots (minimum size 320×320, max 3840×3840)
  - Short description (≤80 chars, Hebrew)
  - Full description (≤4000 chars, Hebrew)
  - Privacy policy URL (required)

---

## Step 1 — Create the app in Play Console

1. Go to <https://play.google.com/console> and sign in.
2. Click **Create app** (top right).
3. Fill in:
   - **App name:** `שאל את הרב`
   - **Default language:** `עברית – iw-IL`
   - **App or game:** App
   - **Free or paid:** Free
   - Check both declarations (Developer Program Policies + US export laws).
4. Click **Create app**.

---

## Step 2 — Choose app category

In **Grow → Store presence → Main store listing**, set:

- **App category:** You have two defensible options:
  - **Books & Reference** — best fit because the app is a Q&A resource
    indexed by topic, analogous to a reference encyclopedia.
  - **Education** — defensible because the content is Torah/Halacha
    instruction. Play Store's Education category has slightly stricter
    content-policy review but matches the educational intent well.

  **Recommendation:** start with **Books & Reference** for faster review.
  You can change the category later without re-publishing.

- **Tags:** add 2–3 relevant tags (e.g. "Religion", "Reference", "Education").

---

## Step 3 — App signing — use Play App Signing (default)

Under **Release → Setup → App signing**:

- Confirm **Play App Signing is enabled** (this is the default for all new
  apps created after 2021 — you cannot opt out, and that is fine).
- What this means in practice:
  - Google holds the real **app signing key** in their secure vault.
  - Your `android.keystore` is the **upload key** — used only to prove
    uploads are from you.
  - Google re-signs every `.aab` with the app signing key before shipping
    it to users.
- **Action required:** after uploading the first bundle, come back to this
  page and copy the **App signing key certificate → SHA-256 fingerprint**.
  You must add this fingerprint to your `/.well-known/assetlinks.json` file
  (alongside your upload-key fingerprint — see `assetlinks-generator.md`
  Step B). Without this, Digital Asset Links will fail for users who
  install from Play Store.

---

## Step 4 — Upload to the Internal Testing track (first)

Internal testing is the fastest track — no review delay, live within minutes,
testers limited to up to 100 email addresses you invite.

1. Go to **Testing → Internal testing** in the left sidebar.
2. Click **Create new release**.
3. Under **App bundles**, click **Upload** and pick
   `app-release-bundle.aab` from this folder.
4. Play will extract and validate. If it complains about missing app
   signing, re-check Step 3.
5. **Release name:** auto-filled (e.g. `1 (1.0.0)`) — leave as-is.
6. **Release notes:** Hebrew, something like:
   ```
   <iw-IL>
   גרסה ראשונה של האפליקציה "שאל את הרב".
   - שליחת שאלות לרבנים
   - עיון בתשובות לפי נושאים
   </iw-IL>
   ```
7. Click **Next**, review warnings (there will be a few — app content
   questions below will address them), then **Save as draft** for now.

### Invite internal testers

Under **Internal testing → Testers**:
- Create a testers list (e.g. "Moreshet team")
- Add email addresses (Gmail accounts of you + anyone testing)
- Copy the **opt-in URL** — share with testers

Testers visit the opt-in URL on their Android phone, click "Become a tester",
then install from the Play Store link that appears.

---

## Step 5 — Fill required content declarations

Before the release can go live, Play Console will block on these forms.
Complete them under **Policy → App content**:

| Form | Answer guidance |
|---|---|
| **Privacy policy** | Required. Provide the URL (e.g. `https://moreshet-maran.com/privacy-policy/`). The policy must mention data collected by the app (likely minimal — PWA fetches from your server). |
| **App access** | "All functionality available without special access" — unless you add login-gated content. |
| **Ads** | No ads (assuming the PWA has no ads). |
| **Content rating** | Complete the questionnaire. For a Q&A religious reference app, expect **Everyone** / **3+**. Answer truthfully about user-generated content if users can submit questions. |
| **Target audience & content** | Target age: 13+ (or 18+ if you want to avoid child-directed policies). |
| **News app** | No. |
| **COVID-19 contact tracing** | No. |
| **Data safety** | Declare what data the PWA collects (name/email for question submission, IP for server logs). Mark anything sensitive. Required to be accurate. |
| **Government app** | No. |
| **Financial features** | No. |
| **Health** | No (even though religious-guidance may touch health questions, "Health" here means medical diagnostic apps). |

---

## Step 6 — Fill the store listing

Under **Grow → Store presence → Main store listing**:

Pull the Hebrew copy + graphics from:
`D:\cluade\aneh-hashoel\mobile\play-store-listing\`

Fill:
- **App name:** `שאל את הרב` (already set)
- **Short description:** (≤80 chars) — paste from listing folder
- **Full description:** (≤4000 chars) — paste from listing folder
- **App icon:** 512×512 PNG
- **Feature graphic:** 1024×500 PNG
- **Phone screenshots:** at least 2, up to 8
- **Tablet screenshots:** optional but recommended
- **Video (YouTube URL):** optional

Click **Save**.

---

## Step 7 — Roll out to internal testing

Return to **Testing → Internal testing → your draft release**, click
**Review release**, fix any remaining warnings, then **Start rollout to
Internal testing**.

Within 5–15 minutes the opt-in URL becomes live, testers can install.

---

## Step 8 — Promote to Production

Once internal testing is stable (a day or two of real usage, no crashes
reported under **Quality → Android vitals**):

1. Go to **Testing → Internal testing**.
2. On the current release, click **Promote release → Production**.
3. Confirm the release notes.
4. **Rollout percentage:** start at 20% for a staged rollout — you can
   pause and roll back if something breaks in the wild. Bump to 100% after
   a day or two of clean metrics.
5. **First-time production submission goes through Play review** (typically
   a few hours to a few days — Google has been variable recently). You
   will get an email when it's approved or rejected.

---

## Common first-submission rejections — and fixes

| Rejection reason | Fix |
|---|---|
| "Your app references a privacy policy URL that is not reachable." | Make sure `https://moreshet-maran.com/privacy-policy/` returns 200 with actual policy text. |
| "Your app does not have a target API level that satisfies the Play store requirement." | Bubblewrap's default is fine (targets latest stable Android). If flagged, bump `targetSdkVersion` in the generated `app/build.gradle` and rebuild. |
| "Data safety form answers do not match SDK behavior." | Re-review the Data safety questionnaire, be honest about anything the PWA sends to your server. |
| "Intellectual property — unauthorized use of the name 'Google', 'Android', etc." | Rare, but review the store-listing text for stray brand mentions. |
| Digital Asset Links failure report | User opened app and saw a URL bar. Fix `assetlinks.json` — include BOTH the upload-key SHA256 and the Play App Signing SHA256. |

---

## After launch — monitoring

- **Play Console → Quality → Android vitals** → crashes, ANRs, bad behaviors.
- **Play Console → Statistics** → installs, uninstalls, ratings.
- **Reviews** → respond in Hebrew where appropriate; Play gives you a direct
  reply box per review.
