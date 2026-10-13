begin;
create table if not exists public.driveshift_admin_members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 role text not null check (role in ('owner', 'admin', 'viewer')),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.driveshift_request_events (
 id bigint generated always as identity primary key,
 created_at timestamptz not null default now(),
 endpoint text not null check (endpoint in ('diagnose', 'camera-diagnose-v2', 'camera-visual-evidence', 'diagnose-image')),
 http_status integer not null check (http_status between 100 and 599),
 duration_ms bigint not null check (duration_ms >= 0),
 outcome text not null check (outcome in ('analysis', 'follow_up', 'explanation', 'error', 'response'))
);
create index if not exists driveshift_request_events_created_idx on public.driveshift_request_events (created_at desc, id desc);
alter table public.driveshift_admin_members enable row level security;
alter table public.driveshift_request_events enable row level security;
-- No browser/ordinary authenticated user can read or modify these tables.
revoke all on public.driveshift_admin_members, public.driveshift_request_events from public, anon, authenticated;
revoke all on sequence public.driveshift_request_events_id_seq from public, anon, authenticated;
-- Explicit grants required because automatic exposure was disabled at project creation.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.driveshift_admin_members to service_role;
grant select, insert, delete on public.driveshift_request_events to service_role;
grant usage, select on sequence public.driveshift_request_events_id_seq to service_role;
commit;
