export const LEGAL_REVISION = '2026-11-01'
export const LEGAL_REVISION_LABEL = '1 November 2026'

function publicSetting(value: string | undefined): string {
  return value?.trim() ?? ''
}

export const legalOperator = {
  name: publicSetting(import.meta.env.VITE_LEGAL_OPERATOR_NAME),
  address: publicSetting(import.meta.env.VITE_LEGAL_OPERATOR_ADDRESS),
  country: publicSetting(import.meta.env.VITE_LEGAL_OPERATOR_COUNTRY),
  email: publicSetting(import.meta.env.VITE_LEGAL_CONTACT_EMAIL),
  privacyEmail: publicSetting(import.meta.env.VITE_LEGAL_PRIVACY_EMAIL)
    || publicSetting(import.meta.env.VITE_LEGAL_CONTACT_EMAIL),
}

export const legalOperatorComplete = Object.values(legalOperator).every(Boolean)

// Set true only after completing the deployment-specific review in docs/LEGAL_LAUNCH.md.
export const LEGAL_REVIEW_COMPLETE = false
export const legalIsDraft = !legalOperatorComplete || !LEGAL_REVIEW_COMPLETE

export function contactHref(email: string, subject: string): string {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}`
}
