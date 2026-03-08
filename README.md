# NineWest Household Hub

Invite-only household organizer built with React + Vite and Supabase.

## What it includes

- Shopping list
- Recipes
- Meal plan (breakfast/lunch/dinner)
- Daily/weekly/one-off todos
- Household access management (members + invites)

## Tech choices

- Frontend: React + TypeScript + Vite
- Backend: Supabase (Auth + Postgres + RLS)
- Hosting: GitHub Pages

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and fill values:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

3. Run development server:

```bash
npm run dev
```

4. Build for production:

```bash
npm run build
```

## Supabase setup

Run migration file:

- `supabase/migrations/20260308_init_household_schema.sql`
- `supabase/migrations/20260308_fix_rls_recursion.sql`
- `supabase/migrations/20260308_system_admin_model.sql`
- `supabase/migrations/20260308_recipe_fields.sql`

You can run it either with Supabase CLI (`supabase db push`) or paste into SQL Editor.

### Important auth settings

- Enable Email/Password sign-in.
- For the smoothest invite flow in this build, disable email confirmation requirement for new users.
- If you keep email confirmation on, invited users must confirm email first, then sign in and accept invite.

### Set your first system admin

After running migrations, promote your own account to system admin:

```sql
update public.user_roles
set system_role = 'admin'
where user_id = (
	select id from auth.users where email = 'YOUR_EMAIL@EXAMPLE.COM'
);
```

You can later demote/promote users by updating `public.user_roles.system_role`.

## Invite-only flow

1. Admin creates a household.
2. Admin creates an invite for an email address.
3. App generates an invite link (copied to clipboard), format: `?invite=<token>`.
4. Invited user opens link, sets password, and joins household.
5. Access to data is protected by RLS membership checks.

## GitHub Pages deployment

Workflow is included at `.github/workflows/deploy-pages.yml`.

### Required repository secrets

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

If you store secrets under the `github-pages` Environment instead of repository-wide secrets, this workflow supports that as well.

### Required repo settings

1. In GitHub repo: `Settings` -> `Pages`.
2. Set Source to `GitHub Actions`.
3. Push to `main` branch.

The app is configured with Vite `base` for repository Pages path (`/NineWestPages/`) when running in GitHub Actions.

### Troubleshooting: Missing Supabase environment variables at runtime

If the site loads with:

`Missing Supabase environment variables. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.`

then the build ran without those secrets. Verify:

1. `Settings` -> `Secrets and variables` -> `Actions` has both secrets, or `Settings` -> `Environments` -> `github-pages` has both.
2. Secret names match exactly:
	- `VITE_SUPABASE_URL`
	- `VITE_SUPABASE_ANON_KEY`
3. Re-run the latest `Deploy to GitHub Pages` workflow after saving secrets.

## Notes

- This project is frontend-only and calls Supabase directly.
- No custom Node backend is required for the current scope.
