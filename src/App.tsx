import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import dayjs from 'dayjs'
import { supabase } from './lib/supabase'
import type {
  HouseholdSummary,
  Invite,
  MealPlanEntry,
  Member,
  Membership,
  Recipe,
  ShoppingItem,
  SystemRole,
  TodoItem,
} from './types'

const mealTypes = ['breakfast', 'lunch', 'dinner'] as const
const recurrenceOptions = ['none', 'daily', 'weekly'] as const

type Tab = 'shopping' | 'recipes' | 'meal-plan' | 'todos' | 'group' | 'admin-suite'

function App() {
  const [loadingAuth, setLoadingAuth] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string>('')
  const [systemRole, setSystemRole] = useState<SystemRole>('member')

  const [memberships, setMemberships] = useState<Membership[]>([])
  const [activeHouseholdId, setActiveHouseholdId] = useState<string>('')
  const [activeTab, setActiveTab] = useState<Tab>('shopping')

  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([])
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [mealPlan, setMealPlan] = useState<MealPlanEntry[]>([])
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [members, setMembers] = useState<Member[]>([])

  const [adminHouseholds, setAdminHouseholds] = useState<HouseholdSummary[]>([])
  const [adminHouseholdId, setAdminHouseholdId] = useState<string>('')
  const [adminMembers, setAdminMembers] = useState<Member[]>([])
  const [adminInvites, setAdminInvites] = useState<Invite[]>([])

  const [status, setStatus] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [loadingData, setLoadingData] = useState(false)

  const activeMembership = useMemo(
    () => memberships.find((m) => m.household_id === activeHouseholdId) ?? null,
    [memberships, activeHouseholdId],
  )

  const hasMembership = memberships.length > 0
  const isSystemAdmin = systemRole === 'admin'

  useEffect(() => {
    const tokenFromUrl = new URLSearchParams(window.location.search).get('invite')
    if (tokenFromUrl) {
      setStatus('Invite token found. Use "Accept Invite" to join your household.')
    }

    const initSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      setUserId(session?.user.id ?? null)
      setUserEmail(session?.user.email ?? '')
      setLoadingAuth(false)
    }

    initSession().catch((initError) => {
      setError((initError as Error).message)
      setLoadingAuth(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null)
      setUserEmail(session?.user.email ?? '')
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!userId) {
      setMemberships([])
      setActiveHouseholdId('')
      setSystemRole('member')
      setAdminHouseholds([])
      setAdminHouseholdId('')
      return
    }

    const bootstrap = async () => {
      setError('')

      const { error: ensureRoleError } = await supabase.rpc('ensure_current_user_role')
      if (ensureRoleError) {
        setError(ensureRoleError.message)
      }

      await Promise.all([loadUserRole(userId), loadMemberships(userId)])
    }

    void bootstrap()
  }, [userId])

  useEffect(() => {
    if (!activeHouseholdId) {
      return
    }

    void loadHouseholdData(activeHouseholdId)
  }, [activeHouseholdId])

  useEffect(() => {
    if (!isSystemAdmin) {
      setAdminHouseholds([])
      setAdminHouseholdId('')
      return
    }

    void loadAdminHouseholds()
  }, [isSystemAdmin])

  useEffect(() => {
    if (!isSystemAdmin || !adminHouseholdId) {
      return
    }

    void loadAdminHouseholdData(adminHouseholdId)
  }, [isSystemAdmin, adminHouseholdId])

  async function loadUserRole(uid: string) {
    const { data, error: roleError } = await supabase
      .from('user_roles')
      .select('system_role')
      .eq('user_id', uid)
      .maybeSingle()

    if (roleError) {
      setError(roleError.message)
      return
    }

    setSystemRole((data?.system_role as SystemRole | undefined) ?? 'member')
  }

  async function loadMemberships(uid: string) {
    const { data, error: queryError } = await supabase
      .from('household_members')
      .select('household_id, member_email, households(name)')
      .eq('user_id', uid)
      .order('created_at', { ascending: true })

    if (queryError) {
      setError(queryError.message)
      return
    }

    const mapped = (data ?? []) as Membership[]
    setMemberships(mapped)

    if (mapped.length > 0) {
      setActiveHouseholdId((current) => current || mapped[0].household_id)
    }
  }

  async function loadHouseholdData(householdId: string) {
    setLoadingData(true)

    const [shoppingRes, recipesRes, mealRes, todoRes, membersRes] = await Promise.all([
      supabase
        .from('shopping_items')
        .select('*')
        .eq('household_id', householdId)
        .order('is_complete', { ascending: true })
        .order('created_at', { ascending: false }),
      supabase
        .from('recipes')
        .select('*')
        .eq('household_id', householdId)
        .order('created_at', { ascending: false }),
      supabase
        .from('meal_plan_entries')
        .select('*')
        .eq('household_id', householdId)
        .order('meal_date', { ascending: true }),
      supabase
        .from('todos')
        .select('*')
        .eq('household_id', householdId)
        .order('is_complete', { ascending: true })
        .order('due_date', { ascending: true, nullsFirst: false }),
      supabase
        .from('household_members')
        .select('id, household_id, user_id, member_email, role')
        .eq('household_id', householdId)
        .order('created_at', { ascending: true }),
    ])

    const firstError =
      shoppingRes.error ?? recipesRes.error ?? mealRes.error ?? todoRes.error ?? membersRes.error

    if (firstError) {
      setError(firstError.message)
      setLoadingData(false)
      return
    }

    setShoppingItems((shoppingRes.data ?? []) as ShoppingItem[])
    setRecipes((recipesRes.data ?? []) as Recipe[])
    setMealPlan((mealRes.data ?? []) as MealPlanEntry[])
    setTodos((todoRes.data ?? []) as TodoItem[])
    setMembers((membersRes.data ?? []) as Member[])
    setLoadingData(false)
  }

  async function loadAdminHouseholds() {
    const { data, error: householdsError } = await supabase
      .from('households')
      .select('id, name, created_at')
      .order('created_at', { ascending: true })

    if (householdsError) {
      setError(householdsError.message)
      return
    }

    const rows = (data ?? []) as HouseholdSummary[]
    setAdminHouseholds(rows)
    if (rows.length > 0) {
      setAdminHouseholdId((current) => current || rows[0].id)
    }
  }

  async function loadAdminHouseholdData(householdId: string) {
    const [membersRes, invitesRes] = await Promise.all([
      supabase
        .from('household_members')
        .select('id, household_id, user_id, member_email, role')
        .eq('household_id', householdId)
        .order('created_at', { ascending: true }),
      supabase
        .from('household_invites')
        .select('id, household_id, email, invite_token, expires_at, accepted_at')
        .eq('household_id', householdId)
        .is('accepted_at', null)
        .order('created_at', { ascending: false }),
    ])

    const firstError = membersRes.error ?? invitesRes.error
    if (firstError) {
      setError(firstError.message)
      return
    }

    setAdminMembers((membersRes.data ?? []) as Member[])
    setAdminInvites((invitesRes.data ?? []) as Invite[])
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setStatus('Signed out.')
  }

  if (loadingAuth) {
    return <div className="shell">Loading...</div>
  }

  if (!userId) {
    return (
      <AuthPanel
        setError={setError}
        setStatus={setStatus}
        onSignedIn={() => {
          setError('')
        }}
      />
    )
  }

  if (!hasMembership && !isSystemAdmin) {
    return (
      <div className="shell">
        <header className="hero">
          <h1>NineWest Household Hub</h1>
          <p>
            Signed in as <strong>{userEmail}</strong>. You do not have household access yet.
          </p>
          <button className="ghost" type="button" onClick={signOut}>
            Sign out
          </button>
        </header>
        <StatusBar error={error} status={status} />
      </div>
    )
  }

  return (
    <div className="shell">
      <header className="hero">
        <div>
          <h1>NineWest Household Hub</h1>
          <p>
            {hasMembership
              ? `${activeMembership?.households?.[0]?.name ?? 'Household'}  Signed in as ${userEmail}`
              : `Signed in as ${userEmail}`}
          </p>
        </div>

        <div className="row">
          {hasMembership ? (
            <select
              value={activeHouseholdId}
              onChange={(event) => setActiveHouseholdId(event.target.value)}
            >
              {memberships.map((membership) => (
                <option key={membership.household_id} value={membership.household_id}>
                  {membership.households?.[0]?.name ?? 'Unnamed'}
                </option>
              ))}
            </select>
          ) : null}

          <button className="ghost" type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <nav className="tabs">
        {hasMembership ? (
          <>
            <button
              className={activeTab === 'shopping' ? 'active' : ''}
              type="button"
              onClick={() => setActiveTab('shopping')}
            >
              Shopping
            </button>
            <button
              className={activeTab === 'recipes' ? 'active' : ''}
              type="button"
              onClick={() => setActiveTab('recipes')}
            >
              Recipes
            </button>
            <button
              className={activeTab === 'meal-plan' ? 'active' : ''}
              type="button"
              onClick={() => setActiveTab('meal-plan')}
            >
              Meal Plan
            </button>
            <button
              className={activeTab === 'todos' ? 'active' : ''}
              type="button"
              onClick={() => setActiveTab('todos')}
            >
              Todos
            </button>
            <button
              className={activeTab === 'group' ? 'active' : ''}
              type="button"
              onClick={() => setActiveTab('group')}
            >
              Group
            </button>
          </>
        ) : null}

        {isSystemAdmin ? (
          <button
            className={activeTab === 'admin-suite' ? 'active' : ''}
            type="button"
            onClick={() => setActiveTab('admin-suite')}
          >
            Admin Suite
          </button>
        ) : null}
      </nav>

      {loadingData && hasMembership ? <p>Refreshing household data...</p> : null}

      {activeTab === 'shopping' && hasMembership ? (
        <ShoppingSection
          householdId={activeHouseholdId}
          items={shoppingItems}
          onRefresh={() => loadHouseholdData(activeHouseholdId)}
          onError={setError}
        />
      ) : null}

      {activeTab === 'recipes' && hasMembership ? (
        <RecipesSection
          householdId={activeHouseholdId}
          recipes={recipes}
          onRefresh={() => loadHouseholdData(activeHouseholdId)}
          onError={setError}
        />
      ) : null}

      {activeTab === 'meal-plan' && hasMembership ? (
        <MealPlanSection
          householdId={activeHouseholdId}
          recipes={recipes}
          entries={mealPlan}
          onRefresh={() => loadHouseholdData(activeHouseholdId)}
          onError={setError}
        />
      ) : null}

      {activeTab === 'todos' && hasMembership ? (
        <TodoSection
          householdId={activeHouseholdId}
          todos={todos}
          onRefresh={() => loadHouseholdData(activeHouseholdId)}
          onError={setError}
        />
      ) : null}

      {activeTab === 'group' && hasMembership ? <GroupSection members={members} /> : null}

      {activeTab === 'admin-suite' && isSystemAdmin ? (
        <AdminSuite
          households={adminHouseholds}
          selectedHouseholdId={adminHouseholdId}
          selectedMembers={adminMembers}
          selectedInvites={adminInvites}
          onSelectHousehold={setAdminHouseholdId}
          onRefreshHouseholds={loadAdminHouseholds}
          onRefreshSelected={
            adminHouseholdId ? () => loadAdminHouseholdData(adminHouseholdId) : async () => undefined
          }
          onError={setError}
          onStatus={setStatus}
        />
      ) : null}

      <StatusBar error={error} status={status} />
    </div>
  )
}

function AuthPanel({
  setError,
  setStatus,
  onSignedIn,
}: {
  setError: (value: string) => void
  setStatus: (value: string) => void
  onSignedIn: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteToken, setInviteToken] = useState(
    new URLSearchParams(window.location.search).get('invite') ?? '',
  )

  const signIn = async (event: FormEvent) => {
    event.preventDefault()
    setError('')

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) {
      setError(signInError.message)
      return
    }

    onSignedIn()
    setStatus('Signed in successfully.')
  }

  const acceptInvite = async (event: FormEvent) => {
    event.preventDefault()
    setError('')

    if (!inviteToken) {
      setError('Invite token is required to join a household.')
      return
    }

    let signedIn = false

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (!signInError) {
      signedIn = true
    } else {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      })

      if (signUpError) {
        setError(signUpError.message)
        return
      }

      signedIn = Boolean(signUpData.session)

      if (!signedIn) {
        setStatus('Account created. Complete email confirmation, then sign in and accept invite again.')
        return
      }
    }

    if (!signedIn) {
      setError('Unable to authenticate while accepting invite.')
      return
    }

    const { error: rpcError } = await supabase.rpc('accept_household_invite', {
      p_invite_token: inviteToken,
    })

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    onSignedIn()
    setStatus('Invite accepted. You now have household access.')
    const url = new URL(window.location.href)
    url.searchParams.delete('invite')
    window.history.replaceState({}, '', url.toString())
  }

  return (
    <div className="shell auth-shell">
      <header className="hero">
        <h1>NineWest Household Hub</h1>
        <p>Invite-only household planning for shopping, recipes, meals, and recurring todos.</p>
      </header>

      <section className="card">
        <h2>Sign In</h2>
        <form onSubmit={signIn} className="stack">
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button type="submit">Sign In</button>
        </form>
      </section>

      <section className="card">
        <h2>Accept Invite</h2>
        <form onSubmit={acceptInvite} className="stack">
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <input
            type="password"
            required
            placeholder="Choose a password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <input
            type="text"
            required
            placeholder="Invite token"
            value={inviteToken}
            onChange={(event) => setInviteToken(event.target.value)}
          />
          <button type="submit">Accept Invite</button>
        </form>
      </section>
    </div>
  )
}

function ShoppingSection({
  householdId,
  items,
  onRefresh,
  onError,
}: {
  householdId: string
  items: ShoppingItem[]
  onRefresh: () => Promise<void>
  onError: (value: string) => void
}) {
  const [title, setTitle] = useState('')
  const [quantity, setQuantity] = useState('')

  const addItem = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) {
      return
    }

    const { error } = await supabase.from('shopping_items').insert({
      household_id: householdId,
      title: trimmed,
      quantity: quantity.trim() || null,
    })

    if (error) {
      onError(error.message)
      return
    }

    setTitle('')
    setQuantity('')
    await onRefresh()
  }

  const toggle = async (item: ShoppingItem) => {
    const { error } = await supabase
      .from('shopping_items')
      .update({ is_complete: !item.is_complete })
      .eq('id', item.id)

    if (error) {
      onError(error.message)
      return
    }

    await onRefresh()
  }

  const remove = async (id: string) => {
    const { error } = await supabase.from('shopping_items').delete().eq('id', id)
    if (error) {
      onError(error.message)
      return
    }
    await onRefresh()
  }

  return (
    <section className="card">
      <h2>Shopping List</h2>
      <form className="row" onSubmit={addItem}>
        <input
          type="text"
          placeholder="Add item"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <input
          type="text"
          placeholder="Qty (optional)"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
        <button type="submit">Add</button>
      </form>
      <ul className="list">
        {items.map((item) => (
          <li key={item.id} className={item.is_complete ? 'done' : ''}>
            <label>
              <input type="checkbox" checked={item.is_complete} onChange={() => toggle(item)} />
              {item.title}
              {item.quantity ? ` (${item.quantity})` : ''}
            </label>
            <button type="button" className="ghost" onClick={() => remove(item.id)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function RecipesSection({
  householdId,
  recipes,
  onRefresh,
  onError,
}: {
  householdId: string
  recipes: Recipe[]
  onRefresh: () => Promise<void>
  onError: (value: string) => void
}) {
  const [title, setTitle] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [servings, setServings] = useState('')
  const [notes, setNotes] = useState('')

  const addRecipe = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) {
      return
    }

    const parsedServings = Number(servings)

    const { error } = await supabase.from('recipes').insert({
      household_id: householdId,
      title: title.trim(),
      source_url: sourceUrl.trim() || null,
      servings: Number.isFinite(parsedServings) && parsedServings > 0 ? parsedServings : null,
      notes: notes.trim() || null,
    })

    if (error) {
      onError(error.message)
      return
    }

    setTitle('')
    setSourceUrl('')
    setServings('')
    setNotes('')
    await onRefresh()
  }

  const remove = async (id: string) => {
    const { error } = await supabase.from('recipes').delete().eq('id', id)
    if (error) {
      onError(error.message)
      return
    }
    await onRefresh()
  }

  return (
    <section className="card">
      <h2>Recipes</h2>
      <form className="stack" onSubmit={addRecipe}>
        <div className="row">
          <input
            type="text"
            placeholder="Recipe name"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <input
            type="number"
            min={1}
            placeholder="Servings"
            value={servings}
            onChange={(event) => setServings(event.target.value)}
          />
        </div>
        <input
          type="url"
          placeholder="Source URL"
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
        />
        <textarea
          placeholder="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
        />
        <button type="submit">Save Recipe</button>
      </form>
      <ul className="list">
        {recipes.map((recipe) => (
          <li key={recipe.id}>
            <div>
              <strong>{recipe.title}</strong>
              {recipe.servings ? <span>  Serves {recipe.servings}</span> : null}
              {recipe.source_url ? (
                <span>
                  {' '}
                   <a href={recipe.source_url}>link</a>
                </span>
              ) : null}
              {recipe.notes ? <p>{recipe.notes}</p> : null}
            </div>
            <button type="button" className="ghost" onClick={() => remove(recipe.id)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function MealPlanSection({
  householdId,
  recipes,
  entries,
  onRefresh,
  onError,
}: {
  householdId: string
  recipes: Recipe[]
  entries: MealPlanEntry[]
  onRefresh: () => Promise<void>
  onError: (value: string) => void
}) {
  const [mealDate, setMealDate] = useState(dayjs().format('YYYY-MM-DD'))
  const [mealType, setMealType] = useState<(typeof mealTypes)[number]>('dinner')
  const [recipeId, setRecipeId] = useState('')

  const addMeal = async (event: FormEvent) => {
    event.preventDefault()

    const selectedRecipe = recipes.find((recipe) => recipe.id === recipeId)

    const { error } = await supabase.from('meal_plan_entries').upsert(
      {
        household_id: householdId,
        meal_date: mealDate,
        meal_type: mealType,
        recipe_id: selectedRecipe?.id ?? null,
        recipe_title: selectedRecipe?.title ?? 'Unplanned meal',
      },
      { onConflict: 'household_id,meal_date,meal_type' },
    )

    if (error) {
      onError(error.message)
      return
    }

    await onRefresh()
  }

  const remove = async (id: string) => {
    const { error } = await supabase.from('meal_plan_entries').delete().eq('id', id)
    if (error) {
      onError(error.message)
      return
    }
    await onRefresh()
  }

  return (
    <section className="card">
      <h2>Meal Plan</h2>
      <form className="row" onSubmit={addMeal}>
        <input
          type="date"
          value={mealDate}
          onChange={(event) => setMealDate(event.target.value)}
          required
        />
        <select
          value={mealType}
          onChange={(event) => setMealType(event.target.value as (typeof mealTypes)[number])}
        >
          {mealTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <select value={recipeId} onChange={(event) => setRecipeId(event.target.value)}>
          <option value="">Choose recipe</option>
          {recipes.map((recipe) => (
            <option key={recipe.id} value={recipe.id}>
              {recipe.title}
            </option>
          ))}
        </select>
        <button type="submit">Plan Meal</button>
      </form>
      <ul className="list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <span>
              <strong>{entry.meal_date}</strong>  {entry.meal_type}  {entry.recipe_title ?? 'Unplanned meal'}
            </span>
            <button type="button" className="ghost" onClick={() => remove(entry.id)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function TodoSection({
  householdId,
  todos,
  onRefresh,
  onError,
}: {
  householdId: string
  todos: TodoItem[]
  onRefresh: () => Promise<void>
  onError: (value: string) => void
}) {
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [recurrence, setRecurrence] = useState<(typeof recurrenceOptions)[number]>('none')
  const [notes, setNotes] = useState('')

  const addTodo = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) {
      return
    }

    const { error } = await supabase.from('todos').insert({
      household_id: householdId,
      title: title.trim(),
      due_date: dueDate || null,
      recurrence,
      notes: notes.trim() || null,
    })

    if (error) {
      onError(error.message)
      return
    }

    setTitle('')
    setDueDate('')
    setRecurrence('none')
    setNotes('')
    await onRefresh()
  }

  const toggle = async (todo: TodoItem) => {
    const { error } = await supabase
      .from('todos')
      .update({ is_complete: !todo.is_complete })
      .eq('id', todo.id)

    if (error) {
      onError(error.message)
      return
    }

    await onRefresh()
  }

  const remove = async (id: string) => {
    const { error } = await supabase.from('todos').delete().eq('id', id)
    if (error) {
      onError(error.message)
      return
    }
    await onRefresh()
  }

  return (
    <section className="card">
      <h2>Weekly / Daily Todos</h2>
      <form className="stack" onSubmit={addTodo}>
        <div className="row">
          <input
            type="text"
            value={title}
            placeholder="Todo"
            onChange={(event) => setTitle(event.target.value)}
          />
          <select
            value={recurrence}
            onChange={(event) => setRecurrence(event.target.value as (typeof recurrenceOptions)[number])}
          >
            {recurrenceOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </div>
        <textarea
          rows={2}
          value={notes}
          placeholder="Notes"
          onChange={(event) => setNotes(event.target.value)}
        />
        <button type="submit">Add Todo</button>
      </form>
      <ul className="list">
        {todos.map((todo) => (
          <li key={todo.id} className={todo.is_complete ? 'done' : ''}>
            <label>
              <input type="checkbox" checked={todo.is_complete} onChange={() => toggle(todo)} />
              {todo.title}
              {todo.recurrence !== 'none' ? ` (${todo.recurrence})` : ''}
              {todo.due_date ? `  due ${todo.due_date}` : ''}
            </label>
            <button type="button" className="ghost" onClick={() => remove(todo.id)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function GroupSection({ members }: { members: Member[] }) {
  return (
    <section className="card">
      <h2>Group</h2>
      <p>You can see your group name and all member emails in this household.</p>
      <ul className="list">
        {members.map((member) => (
          <li key={member.id}>
            <span>{member.member_email}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function AdminSuite({
  households,
  selectedHouseholdId,
  selectedMembers,
  selectedInvites,
  onSelectHousehold,
  onRefreshHouseholds,
  onRefreshSelected,
  onError,
  onStatus,
}: {
  households: HouseholdSummary[]
  selectedHouseholdId: string
  selectedMembers: Member[]
  selectedInvites: Invite[]
  onSelectHousehold: (householdId: string) => void
  onRefreshHouseholds: () => Promise<void>
  onRefreshSelected: () => Promise<void>
  onError: (value: string) => void
  onStatus: (value: string) => void
}) {
  const [newHouseholdName, setNewHouseholdName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')

  const createHousehold = async (event: FormEvent) => {
    event.preventDefault()
    if (!newHouseholdName.trim()) {
      return
    }

    const { error } = await supabase.rpc('create_household_with_admin', {
      p_household_name: newHouseholdName.trim(),
    })

    if (error) {
      onError(error.message)
      return
    }

    setNewHouseholdName('')
    onStatus('Household created.')
    await onRefreshHouseholds()
  }

  const deleteHousehold = async (householdId: string) => {
    const { error } = await supabase.from('households').delete().eq('id', householdId)
    if (error) {
      onError(error.message)
      return
    }

    onStatus('Household deleted.')
    await onRefreshHouseholds()
    onSelectHousehold('')
  }

  const createInvite = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedHouseholdId || !inviteEmail.trim()) {
      return
    }

    const { data, error } = await supabase
      .from('household_invites')
      .insert({
        household_id: selectedHouseholdId,
        email: inviteEmail.trim().toLowerCase(),
      })
      .select('invite_token')
      .single()

    if (error) {
      onError(error.message)
      return
    }

    const inviteLink = `${window.location.origin}${window.location.pathname}?invite=${data.invite_token}`
    await navigator.clipboard.writeText(inviteLink)
    onStatus(`Invite link copied for ${inviteEmail}.`)
    setInviteEmail('')
    await onRefreshSelected()
  }

  const cancelInvite = async (id: string) => {
    const { error } = await supabase.from('household_invites').delete().eq('id', id)
    if (error) {
      onError(error.message)
      return
    }
    await onRefreshSelected()
  }

  const removeMember = async (id: string) => {
    const { error } = await supabase.from('household_members').delete().eq('id', id)
    if (error) {
      onError(error.message)
      return
    }
    await onRefreshSelected()
  }

  return (
    <section className="card">
      <h2>Admin Suite</h2>
      <p>System admins can create households, invite members, and manage membership.</p>

      <form className="row" onSubmit={createHousehold}>
        <input
          type="text"
          placeholder="New household name"
          value={newHouseholdName}
          onChange={(event) => setNewHouseholdName(event.target.value)}
        />
        <button type="submit">Create Household</button>
      </form>

      <div className="row">
        <select value={selectedHouseholdId} onChange={(event) => onSelectHousehold(event.target.value)}>
          <option value="">Choose household</option>
          {households.map((household) => (
            <option key={household.id} value={household.id}>
              {household.name}
            </option>
          ))}
        </select>
        {selectedHouseholdId ? (
          <button type="button" className="ghost" onClick={() => deleteHousehold(selectedHouseholdId)}>
            Delete Household
          </button>
        ) : null}
      </div>

      {selectedHouseholdId ? (
        <>
          <form className="row" onSubmit={createInvite}>
            <input
              type="email"
              placeholder="Invite email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
            />
            <button type="submit">Create Invite</button>
          </form>

          <h3>Members</h3>
          <ul className="list">
            {selectedMembers.map((member) => (
              <li key={member.id}>
                <span>{member.member_email}</span>
                <button type="button" className="ghost" onClick={() => removeMember(member.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <h3>Pending Invites</h3>
          <ul className="list">
            {selectedInvites.map((invite) => (
              <li key={invite.id}>
                <span>
                  {invite.email}
                  {invite.expires_at ? `  expires ${dayjs(invite.expires_at).format('YYYY-MM-DD')}` : ''}
                </span>
                <button type="button" className="ghost" onClick={() => cancelInvite(invite.id)}>
                  Cancel
                </button>
              </li>
            ))}
            {selectedInvites.length === 0 ? <li>No pending invites</li> : null}
          </ul>
        </>
      ) : null}
    </section>
  )
}

function StatusBar({ status, error }: { status: string; error: string }) {
  if (!status && !error) {
    return null
  }

  return (
    <footer className="statusbar">
      {status ? <p className="status">{status}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </footer>
  )
}

export default App
