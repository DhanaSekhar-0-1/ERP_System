# Hosting the pilot (MVP1 step 8b)

This guide puts the app online for the school's one-month pilot:

| Part | Where | Address (example) | Cost |
|---|---|---|---|
| Database, logins, files | A **new** Supabase project (Mumbai) | `https://<ref>.supabase.co` | Free |
| Backend API | Render, Free plan (Singapore) | `https://school-erp-api.onrender.com` | Free |
| Web app (Admin, Principal, teachers) | Vercel | `https://school-erp.vercel.app` | Free |
| Phone app | Android APK (step 8c) | — | Free |

You create the accounts and own them; no card is needed for these free plans. Do the steps in
order. Each one ends with a check.

> **Never mix the two databases.** The pilot uses a new Supabase project with the school's real
> data. Your development project stays as it is. Do not run `npm run test:e2e`,
> `prisma:bootstrap-test-accounts` or `prisma:seed-demo` against the pilot, and do not put the
> pilot's values in `backend/.env`.

## 1. Create the Supabase project

1. Sign in at supabase.com → **New project**.
2. Name: `school-erp-pilot`. Region: **South Asia (Mumbai)**. Choose a strong database
   password and save it in your password manager; you need it in step 2.
3. When the project is ready, open **Authentication → Sign In / Providers** and turn **off**
   "Allow new users to sign up". The app creates every login itself; this stops strangers
   making accounts.
4. Collect these values (you need them in step 2):
   - **Project Settings → Data API**: the Project URL (`https://<ref>.supabase.co`).
   - **Project Settings → API Keys**: the `anon` / publishable key, and the `service_role` /
     secret key. The secret key is like a master password: never send it to anyone or put it
     in the web or phone app.
   - **Connect** (top bar) → **ORMs → Prisma**, or **Connection string**:
     - *Transaction pooler* (port **6543**) for `DATABASE_URL`.
     - *Session pooler* (port **5432** on the `pooler.supabase.com` host) for `DIRECT_URL`.
       Use the session pooler, not the "Direct connection": the direct one works only over
       IPv6, which Render does not have.

**Check:** the project dashboard shows it as healthy.

## 2. Make the pilot settings file on your computer

1. In `backend`, copy `.env.example` to **`.env.pilot`** (it is git-ignored like `.env`).
2. Fill it in:
   ```
   NODE_ENV=production
   DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5"
   DIRECT_URL="postgresql://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
   SUPABASE_URL="https://<ref>.supabase.co"
   SUPABASE_ANON_KEY="<anon key>"
   SUPABASE_SERVICE_ROLE_KEY="<service_role key>"
   PII_ENCRYPTION_KEY="<new key, see below>"
   ```
   The host name in the two URLs is the one the Supabase **Connect** panel shows; copy it
   exactly. If the password contains `@`, `#` or `/`, the panel's copy already encodes it.
3. Make a **new** Aadhaar encryption key for the pilot (do not reuse the development one):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   Put it in `PII_ENCRYPTION_KEY` and **back it up in two places** (password manager and a
   printed or offline copy). If this key is lost, every stored Aadhaar number becomes
   unreadable, and nobody can recover it.

**Check:** `backend/.env.pilot` exists and `git status` does not list it.

## 3. Put the backend on Render

The repository has a Render Blueprint, [`render.yaml`](../render.yaml). It builds the backend,
applies the database migrations, checks that Row-Level Security is on for every table,
creates the role list, and starts the API.

1. Sign in at render.com with GitHub and allow access to the `ERP_System` repository.
2. **New → Blueprint** → choose `ERP_System`, branch **`feature/mvp1`** (MVP1 is not on
   `main` yet).
3. Render asks for the secret values. Copy them from `.env.pilot`: `DATABASE_URL`,
   `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `PII_ENCRYPTION_KEY`. For `CORS_ORIGINS`, type `http://localhost:3001` for now; step 6
   changes it to the Vercel address.
4. **Apply**. The first build takes 5–10 minutes.

**Check:** open `https://<your-service>.onrender.com/api/v1/health`. It should show
`"status":"ok","database":"ok"`. If the build failed, open **Logs**: a database error usually
means a wrong URL or password in step 2.

## 4. Create the school and the first logins

The database now has its tables and roles but no school. On your computer:

```bash
cd backend
npm run pilot:setup -- --env-file=.env.pilot --school-name="<School name>" --school-code=<SHORT-CODE> --super-admin-email=<your email> --super-admin-name="<Your name>" --principal-email=<principal email> --principal-name="<Principal name>" --admin-email=<office email> --admin-name="<Admin name>"
```

It creates:

- the organisation and the school (time zone Asia/Kolkata);
- the active academic year (default `2026-2027`, 1 June 2026 to 30 April 2027; change it with
  `--year-name=`, `--year-start=` and `--year-end=`);
- the **MVP1 module set** (exams, fees, notices, parent login and the other later modules are
  switched off) with the **NFC card optional** and Aadhaar required;
- logins for the Super Admin, the Principal and the School Admin.

It prints each login's **first password once**. Hand them over privately. Each person must
choose a new password at first sign-in. The script can be run again safely: what already
exists is left alone and passwords are never changed.

**Check:** the output ends with the three logins and starts with your **pilot** project's URL
(not the development one).

## 5. Put the web app on Vercel

1. Sign in at vercel.com with GitHub → **Add New → Project** → import `ERP_System`.
2. **Root Directory:** `apps/web`. Framework preset: Vite. The build settings come from
   [`apps/web/vercel.json`](../apps/web/vercel.json); leave them as they are.
3. **Environment Variables:** `VITE_API_URL` = `https://<your-service>.onrender.com/api/v1`.
4. Deploy. Then **Settings → Git → Production Branch:** `feature/mvp1`.

**Check:** the address Vercel gives (for example `https://school-erp.vercel.app`) shows the
sign-in page.

## 6. Let the web app talk to the API

1. In Render → your service → **Environment**, set `CORS_ORIGINS` to the Vercel address,
   exactly, with no slash at the end, for example `https://school-erp.vercel.app`.
2. Save, then **Manual Deploy → Deploy latest commit**.

**Check:** sign in on the Vercel address with the School Admin login from step 4. The app asks
for a new password, then opens the Overview. **Settings → Modules in use** shows only the
MVP1 parts switched on.

## 7. Prepare the school (School Admin, on the web)

1. **Settings → Teacher check-in:** stand in the school and press "Use this device's location"
   (or type it), set the radius and the late time, and save.
2. **Settings → Default subjects:** check the subject list.
3. **Classes & Sections:** create the classes; each gets Section A, and you add more sections.
4. **Teachers:** register each teacher; hand over their Teacher ID and first password.
5. **Students:** register students one by one, or import the Excel sheet (dry run first).
6. **Teacher Assignments:** set class teachers and subject teachers.

## The Render Free plan

The free backend **sleeps after 15 minutes without requests**. The first request after that
waits about a minute while it wakes up, and notifications pause while it sleeps.

- Optional fix, free: create a monitor at an uptime service (for example UptimeRobot) that
  opens `https://<your-service>.onrender.com/api/v1/health` every 10 minutes during school
  hours. The free plan's 750 hours a month cover one service running all month.
- Lasting fix: switch the service to **Starter** (about $7 a month) in Render → Settings.
  Nothing else changes.

## Updating the pilot later

1. Push the new commits to `feature/mvp1`.
2. Vercel deploys the web app by itself.
3. Render: **Manual Deploy → Deploy latest commit** (automatic deploys are off so a push never
   changes the school's app by surprise). New migrations run during the build.

## Things to know about the free plans

- **Backups:** Supabase Free has no downloadable backups. Before trusting it with a full term's
  data, either move the project to Pro (about $25 a month, daily backups) or take a manual
  backup now and then with `pg_dump` using the session pooler URL.
- **Pausing:** a Supabase Free project that has no activity for 7 days is paused. Daily use
  prevents this; if it happens, press **Restore** in the dashboard.
- **Custom domain:** can be added later in Vercel and Render (for example
  `erp.schoolname.in`). Update `CORS_ORIGINS` and `VITE_API_URL` when you do; no code changes.
