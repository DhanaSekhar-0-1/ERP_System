# Recommended Production Technology Stack

Passwordencoded on databse_url because password contains # on Amma143#0000
     
	 # → %23

## Project Context

This stack is recommended for the school ERP described in
[school-erp-architecture.md](./school-erp-architecture.md). It supports a
dynamic application across web and mobile while keeping the backend,
authorization, audit logging, and database rules centralized.

Cloudflare:
  DDoS protection
  WAF
  IP rate limits
  Bot protection
  Turnstile
  HTTPS

NestJS backend:
  Account limits
  IP/device limits
  MFA
  RBAC
  School and record authorization
  Token validation
  Audit logs

Redis:
  Temporary counters
  Login protection windows
  OTP limits
  Session revocation
  API rate limits

## Recommended Stack

| Layer | Recommendation |
|---|---|
| Web application | Next.js + React + TypeScript |
| Mobile application | React Native + Expo + TypeScript |
| Shared code | TypeScript monorepo |
| Backend API | Node.js + NestJS + TypeScript |
| API style | REST + OpenAPI/Swagger |
| Database | PostgreSQL |
| Initial database platform | Supabase PostgreSQL |
| ORM | Prisma |
| Cache | Redis |
| Background jobs | BullMQ + Redis |
| Authentication | Supabase Auth initially, with business authorization in NestJS |
| File storage | Supabase Storage initially; Cloudflare R2 later if needed |
| CDN, DNS, and WAF | Cloudflare |
| Mobile delivery | Expo Application Services (EAS) |
| CI/CD | GitHub Actions |
| Error monitoring | Sentry |

## Frontend Strategy

Use one TypeScript ecosystem for both clients:

```text
apps/
  web/          Next.js web application
  mobile/       React Native + Expo mobile application
  api/          NestJS backend

packages/
  types/        Shared TypeScript domain types
  validation/   Shared Zod validation schemas
  permissions/  Shared RBAC definitions
  api-client/   Shared typed API client
  config/       Shared TypeScript and lint configuration
```

### Web

Use Next.js and React for the Admin, Principal, Teacher, Accountant, Parent,
and other web portals.

### Mobile

Use React Native with Expo for Android and iOS. This is preferable to
Flutter for this project because the web and mobile teams can share
TypeScript types, validation, API clients, permissions, and domain logic.

Flutter remains a valid alternative if the team already has substantially
more Flutter/Dart experience, but it would create a separate UI ecosystem
from the React web application.

## Backend Strategy

Use NestJS rather than an unstructured Express application. NestJS runs on
Node.js and provides a modular structure appropriate for the ERP's
authorization and workflow requirements.

Recommended backend modules:

```text
auth/
users/
organizations/
schools/
academic-years/
students/
attendance/
exams/
homework/
fees/
complaints/
notifications/
documents/
audit/
```

NestJS should own:

- Role and permission enforcement
- School and organization data boundaries
- Tier 2, Tier 3, and Tier 4 change workflows
- Approval transactions
- Audit logging
- Payment verification and reconciliation
- Notification orchestration
- File access control
- Domain validation

The frontend must not be trusted to enforce permissions by itself.

## Database

Use PostgreSQL. SQL is the database language; PostgreSQL is the database
engine.

PostgreSQL is a good fit because this ERP needs:

- Foreign keys and relational integrity
- Transactions
- Approval workflows
- Historical records
- Complex reporting queries
- Audit records
- Fee and payment relationships
- Constraints and unique indexes

The data model should include historical enrollment records rather than
overwriting a student's class directly:

```text
Student
StudentEnrollment
  - student_id
  - academic_year_id
  - class_id
  - section_id
  - roll_number
  - status
```

All operational records should be scoped to the correct school and, where
applicable, academic year.

## Supabase Usage

Supabase is a good initial managed platform for:

- PostgreSQL
- Authentication
- Database migrations
- File storage
- Backups on an appropriate plan
- Local development tooling

Use separate Supabase projects for:

```text
Development
Staging
Production
```

Use migrations stored in source control. Never expose the Supabase
service-role key in web or mobile code.

The application should use this flow:

```text
Web/Mobile → NestJS API → Supabase PostgreSQL
```

Do not make the frontend directly responsible for implementing ERP business
rules against Supabase tables. NestJS should be the main business layer.

## Cloudflare Usage

Supabase cannot be directly "pushed to Cloudflare"; they provide different
services.

Use Cloudflare for:

- DNS
- HTTPS and TLS
- CDN
- WAF
- DDoS protection
- Rate limiting
- Public asset delivery

Use Supabase for the initial PostgreSQL database and storage. Move files to
Cloudflare R2 later only if its pricing or scaling characteristics are more
appropriate.

Do not move the complete NestJS ERP backend to Cloudflare Workers at the
beginning. A standard Node.js container is simpler for database transactions,
payment webhooks, queues, report generation, and complex backend libraries.

## Cache and Background Jobs

Use Redis for:

- Dashboard and configuration caching
- Rate limiting
- Temporary OTP and verification data
- Idempotency keys
- Session-related temporary data
- Notification jobs
- Report generation jobs
- Offline-sync reconciliation

Use BullMQ with Redis for asynchronous work such as:

- Push and SMS notifications
- Report generation
- Receipt generation
- Payment reconciliation
- Offline synchronization processing

Do not use Cloudflare KV as the primary cache for attendance, marks, fees, or
approval workflows because those operations require stronger consistency.

## Deployment Architecture

```text
                    ┌────────────────────┐
                    │ Web Browser        │
                    │ Next.js Web App    │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │ React Native App   │
                    │ Expo Android/iOS   │
                    └─────────┬──────────┘
                              │ HTTPS
                    ┌─────────▼──────────┐
                    │ Cloudflare         │
                    │ DNS/WAF/CDN        │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │ NestJS API         │
                    │ REST + OpenAPI     │
                    └──────┬─────┬───────┘
                           │     │
             ┌─────────────▼─┐ ┌─▼──────────────┐
             │ PostgreSQL    │ │ Redis          │
             │ Supabase      │ │ Cache + Queue  │
             └───────────────┘ └────────────────┘
                           │
                 ┌─────────▼──────────┐
                 │ Private Storage    │
                 │ Supabase/R2        │
                 └────────────────────┘
```

## Environment Strategy

### Development

```text
Next.js + React + TypeScript
React Native + Expo + TypeScript
NestJS + TypeScript
Local PostgreSQL or Supabase development project
Prisma migrations
Docker Redis or managed development Redis
Supabase Storage
```

### Staging

Use a separate:

- Supabase project
- Redis instance
- Storage bucket
- API deployment
- Environment-variable set

Run migrations and automated tests before production deployment.

### Production

Use:

- Next.js web deployment
- Expo production builds
- Containerized NestJS API
- Managed PostgreSQL
- Managed Redis
- Private object storage
- Cloudflare DNS, CDN, and WAF
- Centralized logs and error monitoring
- Automated backups
- CI/CD with production approval

## Security Requirements

The system handles student, attendance, marks, complaint, payment, and
personal data. Production implementation must include:

- Server-side authorization on every sensitive endpoint
- Organization and school-level data scoping
- Short-lived access tokens
- Refresh-token rotation and revocation
- Secure mobile token storage
- Password hashing with Argon2id or bcrypt
- Login rate limiting
- MFA for School Admin and Principal accounts
- Append-only audit records
- Private document storage
- Short-lived signed file URLs
- Payment webhook signature verification
- Idempotent payment processing
- Database backups and recovery procedures
- Separate staging and production environments
- Secrets stored outside source control
- No service-role keys in frontend code
- Input validation on every API boundary

## Final Recommendation

Use:

```text
Web:          Next.js + React + TypeScript
Mobile:       React Native + Expo + TypeScript
Backend:      Node.js + NestJS + TypeScript
API:          REST + OpenAPI
Database:     PostgreSQL
Initial cloud: Supabase PostgreSQL/Auth/Storage
ORM:          Prisma
Cache/jobs:   Redis + BullMQ
Edge/security: Cloudflare DNS + CDN + WAF
Files:        Supabase Storage initially, Cloudflare R2 later if needed
Deployment:   Docker containers, GitHub Actions, Expo EAS
```

This approach is cost-effective for the initial release and preserves a
clear path to production-scale infrastructure without changing the core
student, class, section, user, permission, or audit architecture.
