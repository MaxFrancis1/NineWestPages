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

type Tab = 'shopping' | 'recipes' | 'meal-plan' | 'todos' | 'group' | 'admin-suite'
type ThemeMode = 'system' | 'light' | 'dark'

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
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const stored = window.localStorage.getItem('theme-mode')
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored
    }
    return 'system'
  })

  const activeMembership = useMemo(
    () => memberships.find((m) => m.household_id === activeHouseholdId) ?? null,
    [memberships, activeHouseholdId],
  )

  const getHouseholdName = (membership: Membership | null) => {
    if (!membership?.households) {
      return null
    }

    if (Array.isArray(membership.households)) {
      return membership.households[0]?.name ?? null
    }

    return membership.households.name
  }

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

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    const applyTheme = () => {
      const resolvedTheme =
        themeMode === 'system' ? (media.matches ? 'dark' : 'light') : themeMode
      document.documentElement.setAttribute('data-theme', resolvedTheme)
    }

    applyTheme()

    const onSystemThemeChange = () => {
      if (themeMode === 'system') {
        applyTheme()
      }
    }

    media.addEventListener('change', onSystemThemeChange)
    window.localStorage.setItem('theme-mode', themeMode)

    return () => media.removeEventListener('change', onSystemThemeChange)
  }, [themeMode])

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
          <h1>{getHouseholdName(activeMembership) ?? 'Household'}</h1>
          <p>
            {hasMembership
              ? `Signed in as ${userEmail}`
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
                  {getHouseholdName(membership) ?? 'Unnamed'}
                </option>
              ))}
            </select>
          ) : null}

          <select
            value={themeMode}
            onChange={(event) => setThemeMode(event.target.value as ThemeMode)}
            aria-label="Theme mode"
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>

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
              To-Do's
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
  const [showAddModal, setShowAddModal] = useState(false)
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
    setShowAddModal(false)
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
      <div className="row section-head">
        <h2>Shopping List</h2>
        <button type="button" onClick={() => setShowAddModal(true)}>
          Add Item
        </button>
      </div>
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

      {showAddModal ? (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h3>Add Shopping Item</h3>
            <form className="stack" onSubmit={addItem}>
              <input
                type="text"
                autoFocus
                placeholder="Add item"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
              <input
                type="text"
                placeholder="Qty (optional)"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
              <div className="row">
                <button type="submit">Add</button>
                <button type="button" className="ghost" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
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
  const [ingredients, setIngredients] = useState('')
  const [method, setMethod] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({})

  const filteredRecipes = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) {
      return recipes
    }

    return recipes.filter((recipe) => recipe.title.toLowerCase().includes(query))
  }, [recipes, search])

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
      ingredients: ingredients.trim() || null,
      method: method.trim() || null,
      notes: method.trim() || null,
    })

    if (error) {
      onError(error.message)
      return
    }

    setTitle('')
    setSourceUrl('')
    setServings('')
    setIngredients('')
    setMethod('')
    setShowCreateModal(false)
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

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => ({
      ...current,
      [id]: !current[id],
    }))
  }

  return (
    <section className="card">
      <div className="row section-head">
        <h2>Recipes</h2>
        <button type="button" onClick={() => setShowCreateModal(true)}>
          Add Recipe
        </button>
      </div>
      <input
        type="text"
        placeholder="Search recipes by name"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <ul className="list">
        {filteredRecipes.map((recipe) => {
          const isExpanded = Boolean(expandedIds[recipe.id])
          return (
            <li key={recipe.id} className="recipe-item">
              <div className="recipe-main">
                <div className="recipe-title-row">
                  <strong>{recipe.title}</strong>
                  {recipe.servings ? <span>Serves {recipe.servings}</span> : null}
                </div>
                {isExpanded ? (
                  <div className="recipe-details">
                    {recipe.source_url ? (
                      <p>
                        <strong>Source:</strong> <a href={recipe.source_url}>Open Link</a>
                      </p>
                    ) : null}
                    {recipe.ingredients ? (
                      <p>
                        <strong>Ingredients:</strong>
                        <br />
                        {recipe.ingredients}
                      </p>
                    ) : null}
                    {recipe.method || recipe.notes ? (
                      <p>
                        <strong>Method:</strong>
                        <br />
                        {recipe.method ?? recipe.notes}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="recipe-actions">
                <button type="button" className="ghost" onClick={() => toggleExpanded(recipe.id)}>
                  {isExpanded ? 'Collapse' : 'Expand'}
                </button>
                <button type="button" className="ghost" onClick={() => remove(recipe.id)}>
                  Remove
                </button>
              </div>
            </li>
          )
        })}
        {filteredRecipes.length === 0 ? <li>No recipes found</li> : null}
      </ul>

      {showCreateModal ? (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h3>Add Recipe</h3>
            <form className="stack" onSubmit={addRecipe}>
              <div className="row">
                <input
                  type="text"
                  autoFocus
                  placeholder="Recipe name"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  required
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
                placeholder="Ingredients (one per line)"
                value={ingredients}
                onChange={(event) => setIngredients(event.target.value)}
                rows={4}
              />
              <textarea
                placeholder="Method"
                value={method}
                onChange={(event) => setMethod(event.target.value)}
                rows={3}
              />
              <div className="row">
                <button type="submit">Save Recipe</button>
                <button type="button" className="ghost" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
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
  const [weekOffset, setWeekOffset] = useState(0)
  const [editingSlot, setEditingSlot] = useState<{
    mealDate: string
    mealType: (typeof mealTypes)[number]
  } | null>(null)
  const [mealText, setMealText] = useState('')

  const weekStart = useMemo(
    () => dayjs().startOf('week').add(weekOffset, 'week'),
    [weekOffset],
  )
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => weekStart.add(index, 'day')),
    [weekStart],
  )

  const addMeal = async (event: FormEvent) => {
    event.preventDefault()
    if (!editingSlot) {
      return
    }

    const title = mealText.trim()
    if (!title) {
      return
    }

    const selectedRecipe = recipes.find(
      (recipe) => recipe.title.toLowerCase() === title.toLowerCase(),
    )

    const { error } = await supabase.from('meal_plan_entries').upsert(
      {
        household_id: householdId,
        meal_date: editingSlot.mealDate,
        meal_type: editingSlot.mealType,
        recipe_id: selectedRecipe?.id ?? null,
        recipe_title: selectedRecipe?.title ?? title,
      },
      { onConflict: 'household_id,meal_date,meal_type' },
    )

    if (error) {
      onError(error.message)
      return
    }

    setMealText('')
    setEditingSlot(null)
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

  const openEditor = (
    slot: { mealDate: string; mealType: (typeof mealTypes)[number] },
    initialText: string,
  ) => {
    setEditingSlot(slot)
    setMealText(initialText)
  }

  const closeEditor = () => {
    setEditingSlot(null)
    setMealText('')
  }

  return (
    <section className="card">
      <h2>Meal Plan</h2>
      <div className="row week-controls">
        <button type="button" className="ghost" onClick={() => setWeekOffset((value) => value - 1)}>
          Previous Week
        </button>
        <p>
          {weekStart.format('D MMM')} - {weekStart.add(6, 'day').format('D MMM')}
        </p>
        <button type="button" className="ghost" onClick={() => setWeekOffset(0)}>
          This Week
        </button>
        <button type="button" className="ghost" onClick={() => setWeekOffset((value) => value + 1)}>
          Next Week
        </button>
      </div>

      <div className="meal-week-grid">
        {weekDays.map((day) => {
          const dayLabel = day.format('ddd')
          const dayKey = day.format('YYYY-MM-DD')
          return (
            <article key={dayKey} className="meal-day-block">
              <header>
                <strong>{dayLabel}</strong>
                <span>{day.format('D MMM')}</span>
              </header>
              {mealTypes.map((type) => {
                const entry = entries.find(
                  (mealEntry) => mealEntry.meal_date === dayKey && mealEntry.meal_type === type,
                )
                return (
                  <div key={`${dayKey}-${type}`} className="meal-slot">
                    <p className="meal-slot-title">{type}</p>
                    {entry ? (
                      <div className="meal-slot-content">
                        <span>{entry.recipe_title ?? 'Unplanned meal'}</span>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            openEditor({ mealDate: dayKey, mealType: type }, entry.recipe_title ?? '')
                          }}
                        >
                          Edit
                        </button>
                        <button type="button" className="ghost" onClick={() => remove(entry.id)}>
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div className="meal-slot-content">
                        <p className="meal-empty">Not planned</p>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            openEditor({ mealDate: dayKey, mealType: type }, '')
                          }}
                        >
                          Add
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </article>
          )
        })}
      </div>

      {editingSlot ? (
        <div className="modal-overlay" onClick={closeEditor}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h3>
              Edit {editingSlot.mealType} {dayjs(editingSlot.mealDate).format('D MMM')}
            </h3>
            <form className="stack" onSubmit={addMeal}>
              <input
                type="text"
                list="recipe-suggestions"
                autoFocus
                placeholder="Type meal or recipe"
                value={mealText}
                onChange={(event) => setMealText(event.target.value)}
                required
              />
              <datalist id="recipe-suggestions">
                {recipes.map((recipe) => (
                  <option key={recipe.id} value={recipe.title} />
                ))}
              </datalist>
              <div className="row">
                <button type="submit">Add</button>
                <button type="button" className="ghost" onClick={closeEditor}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
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
  const [showAddModal, setShowAddModal] = useState(false)
  const [targetList, setTargetList] = useState<'weekly' | 'adhoc'>('adhoc')
  const [title, setTitle] = useState('')

  const weeklyTodos = todos.filter((todo) => todo.recurrence === 'weekly')
  const adhocTodos = todos.filter((todo) => todo.recurrence !== 'weekly')

  useEffect(() => {
    const maybeResetWeekly = async () => {
      const isSunday = dayjs().day() === 0
      const hasCompletedWeekly = weeklyTodos.some((todo) => todo.is_complete)
      const weekKey = dayjs().startOf('week').format('YYYY-MM-DD')
      const resetKey = `weekly-reset:${householdId}`
      const alreadyResetThisWeek = window.localStorage.getItem(resetKey) === weekKey

      if (!isSunday || !hasCompletedWeekly || alreadyResetThisWeek) {
        return
      }

      const { error } = await supabase
        .from('todos')
        .update({ is_complete: false })
        .eq('household_id', householdId)
        .eq('recurrence', 'weekly')
        .eq('is_complete', true)

      if (error) {
        onError(error.message)
        return
      }

      window.localStorage.setItem(resetKey, weekKey)

      await onRefresh()
    }

    void maybeResetWeekly()
  }, [householdId, weeklyTodos, onRefresh, onError])

  const openAddModal = (listType: 'weekly' | 'adhoc') => {
    setTargetList(listType)
    setTitle('')
    setShowAddModal(true)
  }

  const addTodo = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) {
      return
    }

    const { error } = await supabase.from('todos').insert({
      household_id: householdId,
      title: trimmed,
      recurrence: targetList === 'weekly' ? 'weekly' : 'none',
      due_date: null,
      notes: null,
    })

    if (error) {
      onError(error.message)
      return
    }

    setTitle('')
    setShowAddModal(false)
    await onRefresh()
  }

  const toggleWeekly = async (todo: TodoItem) => {
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

  const clearAdhocOnCheck = async (todo: TodoItem) => {
    const { error } = await supabase.from('todos').delete().eq('id', todo.id)
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
      <h2>To-Do's</h2>
      <div className="todo-columns">
        <article className="todo-column">
          <div className="todo-column-header">
            <h3>Weekly</h3>
            <button type="button" onClick={() => openAddModal('weekly')}>
              Add
            </button>
          </div>
          <ul className="list checklist-list">
            {weeklyTodos.map((todo) => (
              <li key={todo.id} className={todo.is_complete ? 'done' : ''}>
                <label>
                  <input type="checkbox" checked={todo.is_complete} onChange={() => toggleWeekly(todo)} />
                  {todo.title}
                </label>
                <button type="button" className="ghost" onClick={() => remove(todo.id)}>
                  Delete
                </button>
              </li>
            ))}
            {weeklyTodos.length === 0 ? <li>No weekly tasks yet</li> : null}
          </ul>
        </article>

        <article className="todo-column">
          <div className="todo-column-header">
            <h3>Ad-hoc</h3>
            <button type="button" onClick={() => openAddModal('adhoc')}>
              Add
            </button>
          </div>
          <ul className="list checklist-list">
            {adhocTodos.map((todo) => (
              <li key={todo.id}>
                <label>
                  <input type="checkbox" checked={false} onChange={() => clearAdhocOnCheck(todo)} />
                  {todo.title}
                </label>
                <button type="button" className="ghost" onClick={() => remove(todo.id)}>
                  Delete
                </button>
              </li>
            ))}
            {adhocTodos.length === 0 ? <li>No ad-hoc tasks right now</li> : null}
          </ul>
        </article>
      </div>

      {showAddModal ? (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h3>Add {targetList === 'weekly' ? 'Weekly' : 'Ad-hoc'} To-Do</h3>
            <form className="stack" onSubmit={addTodo}>
              <input
                type="text"
                autoFocus
                placeholder="What needs doing?"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
              <div className="row">
                <button type="submit">Add</button>
                <button type="button" className="ghost" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
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
  const [generatedInviteLink, setGeneratedInviteLink] = useState('')
  const [generatedInviteToken, setGeneratedInviteToken] = useState('')
  const [showHouseholdModal, setShowHouseholdModal] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')

  const selectedHousehold = useMemo(
    () => households.find((household) => household.id === selectedHouseholdId) ?? null,
    [households, selectedHouseholdId],
  )

  useEffect(() => {
    setShowDeleteConfirm(false)
    setDeleteConfirmName('')
  }, [selectedHouseholdId])

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
    setShowHouseholdModal(false)
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
    setShowDeleteConfirm(false)
    setDeleteConfirmName('')
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
    setGeneratedInviteLink(inviteLink)
    setGeneratedInviteToken(data.invite_token)
    await onRefreshSelected()
  }

  const copyInviteLink = async (token: string) => {
    const link = `${window.location.origin}${window.location.pathname}?invite=${token}`
    try {
      await navigator.clipboard.writeText(link)
      onStatus('Invite link copied to clipboard.')
    } catch {
      onError('Could not copy to clipboard. Please copy the link manually.')
    }
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

      <button type="button" onClick={() => setShowHouseholdModal(true)}>
        Create Household
      </button>

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
          <button
            type="button"
            className="ghost"
            onClick={() => setShowDeleteConfirm((current) => !current)}
          >
            {showDeleteConfirm ? 'Cancel Delete' : 'Delete Household'}
          </button>
        ) : null}
      </div>

      {selectedHouseholdId && showDeleteConfirm && selectedHousehold ? (
        <div className="card delete-guard">
          <p>
            Type <strong>{selectedHousehold.name}</strong> to confirm deletion.
          </p>
          <div className="row">
            <input
              type="text"
              placeholder="Confirm household name"
              value={deleteConfirmName}
              onChange={(event) => setDeleteConfirmName(event.target.value)}
            />
            <button
              type="button"
              className="danger"
              disabled={deleteConfirmName.trim() !== selectedHousehold.name}
              onClick={() => deleteHousehold(selectedHouseholdId)}
            >
              Confirm Delete
            </button>
          </div>
        </div>
      ) : null}

      {selectedHouseholdId ? (
        <>
          <button type="button" onClick={() => setShowInviteModal(true)}>
            Create Invite
          </button>

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
                <button type="button" className="ghost" onClick={() => copyInviteLink(invite.invite_token)}>
                  Copy URL
                </button>
                <button type="button" className="ghost" onClick={() => cancelInvite(invite.id)}>
                  Cancel
                </button>
              </li>
            ))}
            {selectedInvites.length === 0 ? <li>No pending invites</li> : null}
          </ul>
        </>
      ) : null}

      {showHouseholdModal ? (
        <div className="modal-overlay" onClick={() => setShowHouseholdModal(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h3>Create Household</h3>
            <form className="stack" onSubmit={createHousehold}>
              <input
                type="text"
                autoFocus
                placeholder="New household name"
                value={newHouseholdName}
                onChange={(event) => setNewHouseholdName(event.target.value)}
                required
              />
              <div className="row">
                <button type="submit">Create</button>
                <button type="button" className="ghost" onClick={() => setShowHouseholdModal(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showInviteModal && selectedHouseholdId ? (
        <div
          className="modal-overlay"
          onClick={() => {
            setShowInviteModal(false)
            setGeneratedInviteLink('')
            setGeneratedInviteToken('')
            setInviteEmail('')
          }}
        >
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h3>Create Invite</h3>
            {generatedInviteLink ? (
              <div className="stack">
                <p>Invite created for <strong>{inviteEmail}</strong>. Copy the link below and share it:</p>
                <input
                  aria-label="Invite link"
                  type="text"
                  readOnly
                  value={generatedInviteLink}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <div className="row">
                  <button type="button" onClick={() => copyInviteLink(generatedInviteToken)}>
                    Copy Link
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setShowInviteModal(false)
                      setGeneratedInviteLink('')
                      setGeneratedInviteToken('')
                      setInviteEmail('')
                    }}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form className="stack" onSubmit={createInvite}>
                <input
                  type="email"
                  autoFocus
                  placeholder="Invite email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  required
                />
                <div className="row">
                  <button type="submit">Create Invite</button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setShowInviteModal(false)
                      setInviteEmail('')
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
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
