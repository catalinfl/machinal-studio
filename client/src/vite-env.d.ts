/// <reference types="svelte" />
/// <reference types="vite/client" />

declare module '*.svelte' {
  import type { ComponentType } from 'svelte'
  const component: ComponentType
  export default component
}

interface ImportMetaEnv {
  readonly VITE_API_BASE: string
  readonly VITE_LEGAL_OPERATOR_NAME?: string
  readonly VITE_LEGAL_OPERATOR_ADDRESS?: string
  readonly VITE_LEGAL_OPERATOR_COUNTRY?: string
  readonly VITE_LEGAL_CONTACT_EMAIL?: string
  readonly VITE_LEGAL_PRIVACY_EMAIL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
