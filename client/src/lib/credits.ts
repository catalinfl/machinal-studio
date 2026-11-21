export type CreditBalance = {
  monthlyAllowance: number
  monthlyRemaining: number
  purchasedRemaining: number
  remaining: number
  reserved: number
  debt: number
  nextReset: string
  pro: boolean
  usagePending: boolean
  allowancePeriod?: 'calendar-month' | 'prepaid-30-day'
}

export type CreditPack = { id: string; credits: number; usd: string }
export type MembershipPlan = { id: string; name: string; days: number; credits: number; usd: string }

export type BillingCatalog = {
  pricing: { configured: boolean; usdPerCredit: string; renderPerMinute: string }
  purchase: { available: boolean; packs: CreditPack[] }
  memberships?: { available: boolean; plans: MembershipPlan[]; renewal: 'manual'; includedCredits?: number; allowanceDays?: number }
  payments?: { mode: 'sandbox' | 'live' | 'unavailable' }
}

export type CreditSummary = BillingCatalog & {
  balance: CreditBalance
  membership?: { active: boolean; planId?: string; name?: string; until?: string }
}

export function formatCredits(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
}

export function formatReset(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(value))
}

export function formatUSD(value: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 6 }).format(Number(value))
}

export function formatCreditDeadline(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC', timeZoneName: 'short',
  }).format(new Date(value))
}
