# School ERP apps

| Folder | What it is | Who uses it |
|---|---|---|
| `apps/web` | React + Vite + Tailwind | Principal, School Admin |
| `apps/mobile` | React Native + Expo | Teacher, Student, Parent |
| `packages/shared` | API client, types, colours | Both apps |

## 1. Start the backend

```bash
npm run build --prefix backend
```

```bash
npm start --prefix backend
```

The backend reads `CORS_ORIGINS` from `backend/.env`. The web app runs on
`http://localhost:3001`, which is the default.

## 2. Create the demo school (once)

```bash
npm run prisma:seed-demo --prefix backend
```

This creates Sunrise Public School with logins for every role, 42 students and about
nine weeks of attendance. Class 6-A is left unmarked for today so you can mark it live.
Logins are written to `demo-accounts.txt`, which git ignores. Each run replaces the passwords.

## 3. Run the web app

```bash
npm install
```

```bash
npm run web
```

Open `http://localhost:3001` and sign in as the principal or the admin.

## 4. Run the mobile app on an Android phone

NFC needs a development build, because Expo Go does not include the NFC module.

1. Turn on USB debugging on the phone and connect it.
2. Build and install the app:

```bash
npm run android --workspace @erp/mobile
```

3. On the login screen open **Server settings** and enter your computer's address, for
   example `http://192.168.1.10:3000/api/v1`. The phone and computer must be on the same
   Wi-Fi. `localhost` will not work from a phone.

Without a card or an NFC phone, the scan screen lets you type a card ID such as `DEMO-NFC-001`.

Real cards: an admin assigns one on the web app under **Students > Assign card**. A USB
reader in keyboard mode types the ID into that box. The phone reads the same card's
hardware ID, so check the reader's ID matches what the phone reads, as some readers
reverse the bytes or print it in decimal.

## Browser preview of the mobile screens

For layout work only, as NFC is not available in a browser. Add `http://localhost:8081`
to `CORS_ORIGINS` first.

```bash
npm run web --workspace @erp/mobile
```
