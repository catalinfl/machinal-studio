import { mount } from 'svelte'
import App from './App.svelte'
import { initAuth } from './stores/auth.svelte'

// Restore the PocketBase session before first render so the editor guard
// and all authenticated fetches see a valid token immediately.
const app = initAuth().then(() => mount(App, {
  target: document.getElementById('app')!,
}))

export default app
