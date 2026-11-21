export const PAID_REQUIRED_MESSAGE = 'Check your own OpenRouter balance and key in Settings.'
export const PAID_SERVER_BODY = 'provider balance required'

export function isPaidUserSync(): boolean { return true }
export async function fetchIsPaid(_signal?: AbortSignal): Promise<boolean> { return true }
export function isPaidRequiredError(_cause: unknown): boolean { return false }
