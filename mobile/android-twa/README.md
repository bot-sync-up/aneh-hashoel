# שאל את הרב — TWA Android Build Runbook

> Build a signed Android App Bundle (`.aab`) that wraps the
> `https://moreshet-maran.com/ask-rabai/` PWA as a Trusted Web Activity,
> ready for upload to Google Play Store.

---

## TL;DR (English)

```bash
cd D:\cluade\aneh-hashoel\mobile\android-twa
npm install
npx bubblewrap doctor
npx bubblewrap init --manifest=./twa-manifest.json
npx bubblewrap build
# → produces app-release-bundle.aab (upload to Play Store)
# → produces app-release-signed.apk (for sideload testing)
keytool -list -v -keystore android.keystore -alias android
# → copy SHA256 → update assetlinks.json on WP (see assetlinks-generator.md)
adb install app-release-signed.apk
# → verify on device: no URL bar = success
```

## TL;DR (עברית)

```bash
cd D:\cluade\aneh-hashoel\mobile\android-twa
npm install                                                 # התקנת Bubblewrap
npx bubblewrap doctor                                       # בדיקת SDK ו-JDK
npx bubblewrap init --manifest=./twa-manifest.json          # יצירת פרויקט אנדרואיד
npx bubblewrap build                                        # יצירת aab+apk חתומים
keytool -list -v -keystore android.keystore -alias android  # שליפת SHA256
# עדכון assetlinks.json באתר הוורדפרס (ר' assetlinks-generator.md)
adb install app-release-signed.apk                          # בדיקה על מכשיר אמיתי
```

---

## Prerequisites / דרישות מוקדמות

| Requirement | Version | Notes |
|---|---|---|
| Node.js | **18.x or 20.x LTS** | Bubblewrap CLI requires ≥14.15, but 18+ is the safe modern choice. Download: <https://nodejs.org/> |
| Java JDK | **17 (exactly)** | **Not JDK 11, not JDK 21.** Bubblewrap docs are explicit: "Using a version lower than 17 will make it impossible to compile the project, and higher versions are incompatible with the Android command line tools." Download Temurin JDK 17 from <https://adoptium.net/temurin/releases/?version=17> |
| Android SDK | installed by `bubblewrap doctor` | You do not need to install Android Studio separately — Bubblewrap downloads the command-line SDK on first run. |
| Keystore password | you choose during init | Write it down, back it up, keep it forever. Losing it = you cannot ship updates with the same signature. |
| Git Bash or PowerShell | — | On Windows, Git Bash handles the shell syntax in this doc best. |

> **Check your JDK:** `java -version` should report `17.x.x`. If it reports
> anything else, set `JAVA_HOME` to the JDK 17 install folder and restart the
> terminal before running `bubblewrap doctor`.

---

## Step 1 — Install dependencies / התקנת תלויות

From this folder:

```bash
npm install
```

This installs `@bubblewrap/cli` into `./node_modules`. You'll call it via
`npx bubblewrap ...` so the local version is used (not any globally-installed
one that may be outdated).

---

## Step 2 — Verify / install Android SDK / בדיקת הסביבה

```bash
npx bubblewrap doctor
```

This validates that:
- JDK 17 is installed and on `PATH` (or `JAVA_HOME`)
- Android SDK is installed (Bubblewrap will offer to install missing parts on
  first run — accept with `y`)
- command-line tools & build-tools are present

If `doctor` reports an error, **fix it before continuing.** Everything below
assumes a healthy `doctor` output.

---

## Step 3 — Initialize the Android project / יצירת הפרויקט

```bash
npx bubblewrap init --manifest=./twa-manifest.json
```

Bubblewrap will:
1. Download the LatestLauncherActivity Android template.
2. Fetch the icon from `iconUrl` in the manifest and generate all density
   variants (mdpi → xxxhdpi, plus adaptive icon layers).
3. **Prompt you to create a signing keystore.** You will be asked:
   - Password for the keystore — **pick a strong password, save it now**
   - Password for the key alias — can be the same as keystore password
   - Your name, organization, locality — fill reasonable values (goes into
     the cert, not visible to end users)

When complete, this folder will contain a full Gradle Android project in
`./app/` and a generated `./android.keystore` file.

> **Back up `android.keystore` and the password immediately** — cloud
> password manager, encrypted USB, wherever. If you lose it, you cannot
> release updates that Android will accept as "the same app."

---

## Step 4 — Build the signed bundle / בניית החבילה

```bash
npx bubblewrap build
```

Bubblewrap will run Gradle, which will:
- download Gradle wrapper JARs
- download Android build tools (first time only, ~500 MB)
- compile, sign, and package

Output files (in this folder):

| File | Purpose |
|---|---|
| `app-release-bundle.aab` | **Upload this to Google Play Console.** |
| `app-release-signed.apk` | Sideload to a real Android device for testing. |

---

## Step 5 — Wire up Digital Asset Links / קישור הדומיין לאפליקציה

See **`assetlinks-generator.md`** in this folder for the full flow. Short
version:

```bash
keytool -list -v -keystore android.keystore -alias android
# → copy the SHA256: line
```

Paste the SHA256 into the WordPress snippet that serves
`/.well-known/assetlinks.json`, publish, then verify:

```bash
curl -i https://moreshet-maran.com/.well-known/assetlinks.json
```

Expected: `200 OK`, `Content-Type: application/json`, JSON body with your
package name and fingerprint.

---

## Step 6 — Test on a real device / בדיקה על מכשיר

Enable **Developer Options** + **USB Debugging** on an Android phone, connect
via USB, then:

```bash
adb install app-release-signed.apk
```

Launch "שאל את הרב" from the app drawer. Success criteria:

- ✓ Splash screen shows with navy background and the gold/navy icon.
- ✓ The PWA loads in full-screen — **no URL bar at the top.**
- ✓ Back button behaves naturally (navigates within the PWA).
- ✗ If a URL bar appears → Digital Asset Links failed. Re-check Step 5.
  Android caches the verification result; try uninstall + reinstall, or
  clear Chrome app data, then reinstall.

---

## Step 7 — Upload to Google Play / העלאה ל-Google Play

See **`play-console-upload.md`** for the first-upload flow (internal testing
track → production).

---

## Updating the app / עדכון האפליקציה

When the PWA changes and you want to ship a new build:

1. Bump `appVersion` (integer, must strictly increase) and `appVersionName`
   (human-readable, e.g. `"1.0.1"`) in `twa-manifest.json`.
2. Run:
   ```bash
   npx bubblewrap update
   npx bubblewrap build
   ```
3. Upload the new `app-release-bundle.aab` to Play Console.

> Most PWA changes (HTML/CSS/JS/images) do **not** require a new app build —
> the TWA just loads the latest web content on next launch. You only rebuild
> when you change: the package name, icon, colors, version number, app name,
> or notification/permissions config.

---

## Troubleshooting / פתרון בעיות

| Symptom | Fix |
|---|---|
| `bubblewrap doctor` says JDK not found | Install JDK 17, set `JAVA_HOME`, reopen terminal. |
| `bubblewrap build` fails with "SDK location not found" | Run `npx bubblewrap doctor` again and accept the SDK install prompt. |
| URL bar appears in app | Digital Asset Links — see Step 5 and `assetlinks-generator.md`. |
| Icon looks blurry | Upload a true 512×512 PNG to `iconUrl` (no transparent padding for the maskable version). |
| "Keystore was tampered with" error | Wrong password. There is no recovery — re-init if you have not published yet. |
| Build succeeds, but Play Console rejects the `.aab` | Usually a version-code collision. Bump `appVersion` to a higher integer. |

---

## Files in this folder / קבצים בתיקייה

| File | Purpose |
|---|---|
| `twa-manifest.json` | Bubblewrap source-of-truth config. |
| `package.json` | npm wrapper with convenience scripts. |
| `.gitignore` | Keeps generated Android project + keystore out of git. |
| `assetlinks-generator.md` | Digital Asset Links flow. |
| `play-console-upload.md` | First-time Play Store upload steps. |
| `README.md` | This file. |
