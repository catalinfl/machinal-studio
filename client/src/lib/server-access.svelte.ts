import { pb } from './pocketbase'

let access = $state<{ owner: string; paid: boolean; until: number } | null>(null)

export function rememberServerAccess(paid: boolean) {
  access = { owner: String(pb.authStore.record?.id ?? ''), paid, until: Date.now() + 30_000 }
}

export function serverPaidAccess(): boolean {
  return Boolean(pb.authStore.isValid && access?.owner === pb.authStore.record?.id && access?.paid && access.until > Date.now())
}
