<script lang="ts">
  import './app.css'
  import { Router, type Route } from 'svelte-wayfind'
  import Editor from './pages/Editor.svelte'
  import Docs from './pages/Docs.svelte'
  import Toolkit from './pages/Toolkit.svelte'
  import NotFound from './pages/NotFound.svelte'
  import OpenRouterWelcome from './components/OpenRouterWelcome.svelte'

  const routes: Route[] = [
    { path: '/', handler: Editor },
    { path: '/editor', handler: Editor },
    { path: '/docs', handler: Docs },
    { path: '/toolkit', handler: Toolkit },
  ]
</script>

<Router {routes} notFound={NotFound} />
<OpenRouterWelcome />
