export type SystemRole = 'admin' | 'member'

export type Membership = {
  household_id: string
  member_email: string
  households: Array<{
    name: string
  }> | null
}

export type ShoppingItem = {
  id: string
  household_id: string
  title: string
  quantity: string | null
  is_complete: boolean
}

export type Recipe = {
  id: string
  household_id: string
  title: string
  ingredients: string | null
  method: string | null
  notes: string | null
  source_url: string | null
  servings: number | null
}

export type MealPlanEntry = {
  id: string
  household_id: string
  meal_date: string
  meal_type: 'breakfast' | 'lunch' | 'dinner'
  recipe_id: string | null
  recipe_title: string | null
}

export type TodoItem = {
  id: string
  household_id: string
  title: string
  notes: string | null
  due_date: string | null
  recurrence: 'none' | 'daily' | 'weekly'
  is_complete: boolean
}

export type Member = {
  id: string
  household_id: string
  user_id: string
  member_email: string
  role: 'member'
}

export type Invite = {
  id: string
  household_id: string
  email: string
  invite_token: string
  expires_at: string | null
  accepted_at: string | null
}

export type HouseholdSummary = {
  id: string
  name: string
  created_at: string
}
