-- Core schema for NineWest Household Hub
create extension if not exists pgcrypto;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  member_email text not null,
  role text not null check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  unique (household_id, user_id)
);

create table if not exists public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  email text not null,
  invite_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  expires_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (household_id, email, accepted_at)
);

create table if not exists public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null,
  quantity text,
  is_complete boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null,
  notes text,
  source_url text,
  servings int,
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.meal_plan_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  meal_date date not null,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner')),
  recipe_id uuid references public.recipes (id) on delete set null,
  recipe_title text,
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (household_id, meal_date, meal_type)
);

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null,
  notes text,
  due_date date,
  recurrence text not null default 'none' check (recurrence in ('none', 'daily', 'weekly')),
  is_complete boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists idx_household_members_user on public.household_members (user_id);
create index if not exists idx_household_invites_token on public.household_invites (invite_token);
create index if not exists idx_shopping_household on public.shopping_items (household_id, created_at desc);
create index if not exists idx_recipes_household on public.recipes (household_id, created_at desc);
create index if not exists idx_meals_household_date on public.meal_plan_entries (household_id, meal_date);
create index if not exists idx_todos_household_due on public.todos (household_id, due_date);

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

  v_email := coalesce(auth.jwt() ->> 'email', 'unknown@example.com');

  insert into public.households (name, created_by)
  values (p_household_name, auth.uid())
  returning id into v_household_id;

  insert into public.household_members (household_id, user_id, member_email, role)
  values (v_household_id, auth.uid(), v_email, 'admin');

  return v_household_id;
end;
$$;

grant execute on function public.create_household_with_admin(text) to authenticated;

create or replace function public.accept_household_invite(p_invite_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.household_invites%rowtype;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  select *
  into v_invite
  from public.household_invites hi
  where hi.invite_token = p_invite_token
    and hi.accepted_at is null
  limit 1;

  if not found then
    raise exception 'Invite is invalid or already used';
  end if;

  if lower(v_invite.email) <> v_email then
    raise exception 'Invite email does not match authenticated user';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    raise exception 'Invite has expired';
  end if;

  insert into public.household_members (household_id, user_id, member_email, role)
  values (v_invite.household_id, auth.uid(), lower(v_invite.email), 'member')
  on conflict (household_id, user_id) do nothing;

  update public.household_invites
  set accepted_at = now()
  where id = v_invite.id;

  return v_invite.household_id;
end;
$$;

grant execute on function public.accept_household_invite(text) to authenticated;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.shopping_items enable row level security;
alter table public.recipes enable row level security;
alter table public.meal_plan_entries enable row level security;
alter table public.todos enable row level security;

create policy "members can view households"
on public.households
for select
to authenticated
using (public.is_household_member(id));

create policy "authenticated can create household"
on public.households
for insert
to authenticated
with check (created_by = auth.uid());

create policy "members can read members"
on public.household_members
for select
to authenticated
using (public.is_household_member(household_id));

create policy "admin can delete members"
on public.household_members
for delete
to authenticated
using (
  (public.is_household_admin(household_id) and user_id <> auth.uid())
  or user_id = auth.uid()
);

create policy "members can read invites"
on public.household_invites
for select
to authenticated
using (public.is_household_member(household_id));

create policy "admins can create invites"
on public.household_invites
for insert
to authenticated
with check (
  public.is_household_admin(household_id)
  and invited_by = auth.uid()
);

create policy "admins can delete invites"
on public.household_invites
for delete
to authenticated
using (public.is_household_admin(household_id));

create policy "members can read shopping"
on public.shopping_items
for select
to authenticated
using (public.is_household_member(household_id));

create policy "members can create shopping"
on public.shopping_items
for insert
to authenticated
with check (public.is_household_member(household_id) and created_by = auth.uid());

create policy "members can update shopping"
on public.shopping_items
for update
to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

create policy "members can delete shopping"
on public.shopping_items
for delete
to authenticated
using (public.is_household_member(household_id));

create policy "members can read recipes"
on public.recipes
for select
to authenticated
using (public.is_household_member(household_id));

create policy "members can create recipes"
on public.recipes
for insert
to authenticated
with check (public.is_household_member(household_id) and created_by = auth.uid());

create policy "members can update recipes"
on public.recipes
for update
to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

create policy "members can delete recipes"
on public.recipes
for delete
to authenticated
using (public.is_household_member(household_id));

create policy "members can read meals"
on public.meal_plan_entries
for select
to authenticated
using (public.is_household_member(household_id));

create policy "members can create meals"
on public.meal_plan_entries
for insert
to authenticated
with check (public.is_household_member(household_id) and created_by = auth.uid());

create policy "members can update meals"
on public.meal_plan_entries
for update
to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

create policy "members can delete meals"
on public.meal_plan_entries
for delete
to authenticated
using (public.is_household_member(household_id));

create policy "members can read todos"
on public.todos
for select
to authenticated
using (public.is_household_member(household_id));

create policy "members can create todos"
on public.todos
for insert
to authenticated
with check (public.is_household_member(household_id) and created_by = auth.uid());

create policy "members can update todos"
on public.todos
for update
to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

create policy "members can delete todos"
on public.todos
for delete
to authenticated
using (public.is_household_member(household_id));
