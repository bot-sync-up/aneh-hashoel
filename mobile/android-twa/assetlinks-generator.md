# Digital Asset Links — Fingerprint & assetlinks.json Generator

> Digital Asset Links is how Android proves that your TWA app is actually owned
> by `moreshet-maran.com`. Without this file in place, the user sees a URL bar
> at the top of the app (Chrome Custom Tabs fallback) instead of a native,
> full-screen experience.

---

## Step A — Extract the SHA256 fingerprint from the keystore

After you have successfully run `npx bubblewrap init` (which created
`android.keystore`) and `npx bubblewrap build` (which signed the app), run:

```bash
keytool -list -v -keystore android.keystore -alias android
```

You will be prompted for the **keystore password** you chose during
`bubblewrap init`. (If you lost it, see the recovery note at the bottom.)

Inside the output, find the line that starts with `SHA256:` — it looks like:

```
SHA256: AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00
```

Copy that full colon-separated hex string (64 hex pairs, 95 chars including
colons). This is the **app signing fingerprint**.

> **Shortcut:** Bubblewrap also exposes `npx bubblewrap fingerprint` which
> prints the SHA256 directly without digging through `keytool` output.

---

## Step B — Build the assetlinks.json content

Paste the fingerprint into the template below, replacing the placeholder:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.moreshetmaran.askrabai",
      "sha256_cert_fingerprints": [
        "AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00"
      ]
    }
  }
]
```

> **Important — two fingerprints required once uploaded to Google Play:**
> Google Play re-signs your `.aab` with its own **Play App Signing** key. That
> means once your app is live, you must include **both** fingerprints in the
> `sha256_cert_fingerprints` array:
>
> 1. Your local upload key (from `keytool` above)
> 2. Google's Play App Signing key (get it from Play Console → Release → Setup
>    → App signing → "App signing key certificate" → SHA-256 certificate
>    fingerprint)
>
> Example with both:
>
> ```json
> "sha256_cert_fingerprints": [
>   "AA:BB:CC:...:00",
>   "DD:EE:FF:...:11"
> ]
> ```

---

## Step C — Publish the file at `/.well-known/assetlinks.json`

The parallel PWA agent has already placed a PHP snippet in the WordPress
install that serves a **stub** response at
`https://moreshet-maran.com/.well-known/assetlinks.json`. You need to update
that snippet so it returns the JSON above.

1. Open the WordPress plugin / `functions.php` edit where the stub lives
   (search for `assetlinks.json` or `.well-known`).
2. Replace the placeholder fingerprint array with the real one from Step B.
3. Save and clear any cache (WP Rocket / LiteSpeed / Cloudflare).

The file **must** be served:
- at exactly `https://moreshet-maran.com/.well-known/assetlinks.json`
- over **HTTPS** with a valid certificate
- with `Content-Type: application/json`
- **no redirects** (not even HTTP → HTTPS on the final hop)
- status **200**

---

## Step D — Verify with curl

```bash
curl -i https://moreshet-maran.com/.well-known/assetlinks.json
```

Expected response:

```
HTTP/2 200
content-type: application/json
...

[{"relation":["delegate_permission/common.handle_all_urls"], ...}]
```

If you get `301`, `302`, `404`, or any HTML, fix the WP snippet before moving
on.

---

## Step E — Verify with Google's official tool

Open in browser:

```
https://developers.google.com/digital-asset-links/tools/generator
```

Fill in:
- **Hosting site domain:** `https://moreshet-maran.com`
- **App package name:** `com.moreshetmaran.askrabai`
- **App package fingerprint (SHA256):** paste the fingerprint from Step A

Click **Test statement**. You should see a green "Success" banner. If it
fails, the error usually points to one of: wrong MIME type, redirect, or
fingerprint mismatch.

---

## Step F — Final on-device check

After installing the signed APK on a real device (see main README Step 6):

- Open the app.
- If there is **no URL bar at the top** → Digital Asset Links are working.
- If you see a URL bar / Chrome Custom Tabs chrome → the verification failed.
  Android caches the result, so after fixing the assetlinks.json you may need
  to either wait a few minutes, clear Chrome's data, or reinstall the app.

---

## Recovery note — lost keystore password

If you lose the keystore password **before** publishing to Play Store, just
delete `android.keystore` and re-run `npx bubblewrap init`. You will generate
a new key and a new fingerprint.

If you lose it **after** publishing, you can still ship updates because Play
App Signing holds the real signing key — but you need to use Play Console's
"Request upload key reset" flow to replace the upload key. Keep the keystore
password in a password manager from day one.
