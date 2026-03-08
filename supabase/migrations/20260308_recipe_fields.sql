-- Add dedicated recipe fields for structured ingredients and method text.
alter table public.recipes
  add column if not exists ingredients text,
  add column if not exists method text;

update public.recipes
set method = coalesce(method, notes)
where method is null and notes is not null;
