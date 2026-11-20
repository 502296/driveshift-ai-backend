begin;
create table if not exists public.driveshift_app_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  installation text not null,
  feature text not null,
  event text not null,
  stage text not null,
  language text not null,
  version text not null,
  country text,
  region text
);
create index if not exists driveshift_app_events_recent_idx
  on public.driveshift_app_events (created_at desc, id desc);
create index if not exists driveshift_app_events_installation_idx
  on public.driveshift_app_events (installation);
alter table public.driveshift_app_events enable row level security;
revoke all on public.driveshift_app_events from public, anon, authenticated;
revoke all on sequence public.driveshift_app_events_id_seq from public, anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, delete on public.driveshift_app_events to service_role;
grant usage, select on sequence public.driveshift_app_events_id_seq to service_role;
commit;
