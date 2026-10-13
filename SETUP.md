# DriveShift Admin + Supabase — initial operations console

Prepared against the uploaded origin/main snapshot, 12 October 2026.
This is an additive patch, NOT a replacement for your complete repository.

## What is implemented

- Admin console at `/admin/index.html`: email/password sign-in, sign-out, refresh.
- Current active membership checked on the server for every overview request.
- Operational request counts, failures and average processing duration.
- Rolling 24-hour view, latest 1,000 records maximum; the UI labels truncated samples.
- Telemetry on diagnose, camera-diagnose-v2, camera-visual-evidence and diagnose-image.
- No images, reports, conversation content, IP addresses or user identifiers in telemetry.
- Audio files are unchanged and are not instrumented.
- Tokens are memory-only, cleared on page reload; access tokens refresh while the page is used.
- Database grants are explicit, RLS enabled, ordinary browser users have no table access.

This version is for monitoring. Feature switches, subscriptions, user administration,
team invitation UI and rate limiting are NOT implemented. Roles are stored as
owner/admin/viewer; all three can read this initial overview. No mutation endpoints
are exposed. Dashboard counts are recorded API calls, not unique users, diagnoses,
OpenAI tokens or billing costs. There is no historical backfill.

## 1. Supabase database

In project `driveshift-admin`, open SQL Editor and run `supabase/001_admin.sql`.
It creates only two DriveShift tables. No existing tables are dropped.

## 2. Your administrator account

In Authentication > Users, create an email/password user that you control.
If creating directly as owner, confirm that user's email using the dashboard's
confirmation option. Keep the password private.
Disable public new-user sign-ups for this admin-only Supabase project.
Keep the Email provider enabled.
Copy the new user's UUID. Replace REPLACE_WITH_AUTH_USER_UUID in
`supabase/002_owner.sql` and run that query in SQL Editor.
Signing up or logging in alone NEVER grants administrator access.

## 3. Vercel environment variables

In Supabase, copy the Project URL and the new publishable and secret API keys
from Connect / Settings > API Keys. Match them to these exact names in Vercel:

| Name | Value |
|---|---|
| SUPABASE_URL | Project URL, https://...supabase.co |
| SUPABASE_PUBLISHABLE_KEY | New publishable key (sb_publishable_...) |
| SUPABASE_SECRET_KEY | New secret key (sb_secret_...), server only |
| DRIVESHIFT_TELEMETRY_ENABLED | true |

Keep the existing OPENAI_API_KEY unchanged. Do not paste real keys into Git,
.env.example, Flutter, browser code, or chat. The secret key bypasses RLS and
belongs only in server environment variables. Select Production; use Preview
only for intentional testing with the matching Supabase project.

If using email links/password-reset in a later extension, configure Authentication
URL Configuration using the exact deployed Vercel origin; this version signs in
with password directly and does not implement a reset/link callback.

## 4. Apply code in a separate checkout

From the confirmed backend checkout (DriveShift-Reasoning...), first ensure
`git fetch origin` has succeeded. Then create a new worktree from origin/main:

```bash
git worktree add -b feat/admin-supabase ../DriveShift-Admin origin/main
```

Extract the ZIP. Copy the contents of `DriveShift-admin-supabase-patch` into that
new DriveShift-Admin directory, preserving subdirectories and replacing only the
four included API handlers. The original checkout remains unchanged.
Do not delete the existing api/data, api/helpers, audio files or other files.
The supplied package.json is unchanged from the uploaded snapshot; no npm
libraries need to be installed for this patch.
If a vercel.json has been added since the snapshot, merge its settings rather
than overwrite it.

```bash
cd ../DriveShift-Admin
node --test test/admin.test.mjs
git diff --stat
git status --short
```

Review, commit and push the feature branch. Preview the Vercel deployment before
merging into main. Adding environment variables requires a new deployment.
Do not push or merge before reviewing the complete change.

## 5. Verify on the actual deployment

1. Open `https://YOUR_VERCEL_DOMAIN/admin/index.html` and log in as owner.
2. Sign-in without an active admin_members row must be denied by overview.
3. Run one real diagnostic and refresh; recorded counts should increase.
4. Confirm diagnose follow-ups and camera results still behave as before.
5. Confirm that a browser cannot read either table using the publishable key.
6. Deactivate the owner's membership temporarily, refresh, and verify denial;
   reactivate via SQL Editor to regain access.

Without all three Supabase credentials, admin APIs return 503; existing diagnostic
responses continue working. Set DRIVESHIFT_TELEMETRY_ENABLED=false and redeploy
to disable recording without changing diagnostic behavior.
Writes are best effort: failures are logged generically and do not alter the
diagnostic response. A pending write is bounded to 1.2 seconds and awaited after
the response has been sent to avoid abandoned serverless work. Operational counts
can miss requests on database/network failures. Duration excludes telemetry writes.

## Retention

Rows are retained until removed. For a 30-day policy, run periodically in SQL Editor:

```sql
delete from public.driveshift_request_events
where created_at < now() - interval '30 days';
```

No recurring cleanup task has been scheduled by this package.

## Validation performed

9 local automated tests: token rejection, missing membership, server authorization,
database outage fail-closed, statistics, disabled telemetry, failed telemetry,
response preservation/private-data exclusion, public-config secret exclusion.
All JavaScript files passed node --check. The four existing handler bodies are
unchanged except for import/export telemetry wrapping.
No live Supabase migration, Vercel deployment, real login, SQL execution or browser
end-to-end verification was performed. Complete step 5 before production use.

## البدء بالعربية

1. شغّل ملف supabase/001_admin.sql في SQL Editor بمشروع driveshift-admin.
2. أنشئ حسابك داخل Authentication > Users، ثم أضف UUID الخاص به عبر 002_owner.sql.
3. ضع المتغيرات الأربعة أعلاه في Vercel، والمفتاح السري يبقى على الخادم فقط.
4. طبّق الحزمة في نسخة منفصلة من الخادم، اختبرها، ثم انشر نسخة معاينة.
5. افتح /admin/index.html وسجّل الدخول واختبر طلب تشخيص حقيقي.

الحزمة لوحة متابعة أولية، ولا يعني تجهيزها أن الربط أو النشر تم بالفعل.
