-- System-admin authorization model
-- Moves admin authority from per-household roles to global user_roles.

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  system_role text not null default 'member' check (system_role in ('member', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_current_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_roles_set_updated_at on public.user_roles;
create trigger user_roles_set_updated_at
before update on public.user_roles
for each row execute function public.set_current_timestamp_updated_at();

-- Backfill known users and preserve prior "admin" intent.
insert into public.user_roles (user_id, system_role)
select distinct hm.user_id, 'member'
from public.household_members hm
on conflict (user_id) do nothing;

update public.user_roles ur
set system_role = 'admin'
where ur.user_id in (
  select distinct hm.user_id
  from public.household_members hm
  where hm.role = 'admin'
);

update public.household_members
set role = 'member'
where role <> 'member';

alter table public.household_members
  drop constraint if exists household_members_role_check;

alter table public.household_members
  add constraint household_members_role_check check (role = 'member');

create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.system_role = 'admin'
  );
$$;

grant execute on function public.is_system_admin() to authenticated;

create or replace function public.ensure_current_user_role()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  insert into public.user_roles (user_id, system_role)
  values (auth.uid(), 'member')
  on conflict (user_id) do nothing;
end;
$$;

grant execute on function public.ensure_current_user_role() to authenticated;

-- Keep this function for compatibility; global admin authority now applies.
create or replace function public.is_household_admin(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_system_admin();
$$;

grant execute on function public.is_household_admin(uuid) to authenticated;

create or replace function public.create_household_with_admin(p_household_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_system_admin() then
    raise exception 'Only system admins can create households';
  end if;

  v_email := lower(coalesce(auth.jwt() ->> 'email', 'unknown@example.com'));

  insert into public.households (name, created_by)
  values (p_household_name, auth.uid())
  returning id into v_household_id;

  insert into public.household_members (household_id, user_id, member_email, role)
  values (v_household_id, auth.uid(), v_email, 'member')
  on conflict (household_id, user_id) do nothing;

  return v_household_id;
end;
$$;

grant execute on function public.create_household_with_admin(text) to authenticated;

alter table public.user_roles enable row level security;

drop policy if exists "members can view households" on public.households;
drop policy if exists "authenticated can create household" on public.households;
drop policy if exists "members can read members" on public.household_members;
drop policy if exists "admin can delete members" on public.household_members;
drop policy if exists "members can read invites" on public.household_invites;
drop policy if exists "admins can create invites" on public.household_invites;
drop policy if exists "admins can delete invites" on public.household_invites;

drop policy if exists "user can read own role" on public.user_roles;
drop policy if exists "system admin can read all roles" on public.user_roles;
drop policy if exists "system admin can manage roles" on public.user_roles;

drop policy if exists "system admins and members can view households" on public.households;
drop policy if exists "system admins can create households" on public.households;
drop policy if exists "system admins can update households" on public.households;
drop policy if exists "system admins can delete households" on public.households;
drop policy if exists "system admins and members can read household members" on public.household_members;
drop policy if exists "system admins can insert household members" on public.household_members;
drop policy if exists "system admins can update household members" on public.household_members;
drop policy if exists "system admins can delete household members" on public.household_members;
drop policy if exists "system admins can read invites" on public.household_invites;
drop policy if exists "system admins can create invites" on public.household_invites;
drop policy if exists "system admins can delete invites" on public.household_invites;

create policy "user can read own role"
on public.user_roles
for select
to authenticated
using (user_id = auth.uid());

create policy "system admin can read all roles"
on public.user_roles
for select
to authenticated
using (public.is_system_admin());

create policy "system admin can manage roles"
on public.user_roles
for all
to authenticated
using (public.is_system_admin())
with check (public.is_system_admin());

create policy "system admins and members can view households"
on public.households
for select
to authenticated
using (public.is_system_admin() or public.is_household_member(id));

create policy "system admins can create households"
on public.households
for insert
to authenticated
with check (public.is_system_admin() and created_by = auth.uid());

create policy "system admins can update households"
on public.households
for update
to authenticated
using (public.is_system_admin())
with check (public.is_system_admin());

create policy "system admins can delete households"
on public.households
for delete
to authenticated
using (public.is_system_admin());

create policy "system admins and members can read household members"
on public.household_members
for select
to authenticated
using (public.is_system_admin() or public.is_household_member(household_id));

create policy "system admins can insert household members"
on public.household_members
for insert
to authenticated
with check (public.is_system_admin() and role = 'member');

create policy "system admins can update household members"
on public.household_members
for update
to authenticated
using (public.is_system_admin())
with check (public.is_system_admin() and role = 'member');

create policy "system admins can delete household members"
on public.household_members
for delete
to authenticated
using (public.is_system_admin());

create policy "system admins can read invites"
on public.household_invites
for select
to authenticated
using (public.is_system_admin());

create policy "system admins can create invites"
on public.household_invites
for insert
to authenticated
with check (public.is_system_admin() and invited_by = auth.uid());

create policy "system admins can delete invites"
on public.household_invites
for delete
to authenticated
using (public.is_system_admin());
