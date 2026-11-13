# Android app for the pilot (MVP1 step 8c)

The phone app is built as an **APK** with Expo EAS (Expo's build service) and shared directly
(a download link or WhatsApp). No Play Store account is needed for the pilot. Do the
[hosting guide](./hosting-guide.md) first: the app needs the Render API address.

## 1. One-time setup

1. Create a free account at expo.dev.
2. On your computer, in `apps/mobile`:
   ```bash
   npx eas-cli@latest login
   ```
   ```bash
   npx eas-cli@latest init
   ```
   `init` links the app to your Expo account and adds a `projectId` to `app.json`. Commit
   that change.
3. Open [`apps/mobile/eas.json`](../apps/mobile/eas.json). Under the `pilot` profile, make sure
   `EXPO_PUBLIC_API_URL` is your Render address followed by `/api/v1`, for example
   `https://school-erp-api.onrender.com/api/v1`. Commit it if you changed it.

## 2. Build the APK

```bash
npx eas-cli@latest build --platform android --profile pilot
```

- The first time, EAS asks to create an Android signing key: answer **yes**. Expo keeps it
  safely; every later build uses the same key, so phones can install updates over the old app.
- The build runs on Expo's servers (about 10–20 minutes; the free plan may queue it). When it
  finishes, the terminal and expo.dev show a **download link** for the `.apk`.
- Each build gets the next version number by itself.

## 3. Install it on a phone

1. Send the download link (or the `.apk` file) by WhatsApp or email.
2. On the phone, open it. Android asks to allow installing from this source (Chrome, Files or
   WhatsApp): allow it once.
3. Open **School ERP**. The login screen's **Server settings** should already show the Render
   address. If it does not, type it there.

If the Render server was asleep (Free plan), the first sign-in can take about a minute.

## 4. Updating the app

Build again (step 2) and share the new link. Installing it over the old app keeps the
signed-in session. Settings changes such as module switches need no new build: the app reads
them from the server.

## NFC card readers

- **Phone's own NFC:** the scan screen reads cards held to the back of the phone.
- **USB (OTG) card reader:** most such readers act like a keyboard. On the scan screen the
  **Card ID** box is always shown and already selected; the reader types the card number and
  presses Enter, which marks the student and leaves the box ready for the next card.
- **Card numbers must match.** A card's number as saved at registration must be the same text
  the reader types at scanning. Readers differ: the phone's NFC gives the card's hardware ID in
  hexadecimal (for example `04A1B2C3D4E5F6`), while many USB readers type a decimal number.
  So register each card with the **same kind of reader** that will scan it: plug the USB reader
  into the office computer and tap the card into the web form's card field, or, when the phone
  reads cards itself, note the ID the scan screen shows. Test this with one card before
  registering a class.
- NFC is optional for the pilot (the school's registration switch "NFC card required" is off);
  teachers can mark attendance from the list without cards.
