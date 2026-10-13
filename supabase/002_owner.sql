-- First create your user in Supabase Authentication > Users.
-- Replace ONLY the UUID below with that user's ID. This is not your password.
insert into public.driveshift_admin_members (user_id, role, active)
values ('REPLACE_WITH_AUTH_USER_UUID'::uuid, 'owner', true)
on conflict (user_id) do update set role = 'owner', active = true;
