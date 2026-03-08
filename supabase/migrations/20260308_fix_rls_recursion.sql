-- Hotfix for stack depth recursion in RLS policy checks.
-- Root cause: membership helper functions queried household_members under RLS.
-- SECURITY DEFINER ensures these checks bypass RLS recursion safely.

create or replace function public.is_household_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = auth.uid()
  );
$$;

grant execute on function public.is_household_member(uuid) to authenticated;

create or replace function public.is_household_admin(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = auth.uid()
      and hm.role = 'admin'
  );
$$;

grant execute on function public.is_household_admin(uuid) to authenticated;
