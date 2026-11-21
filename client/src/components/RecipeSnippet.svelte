<script lang="ts">
  import { onDestroy } from 'svelte'

  let { title, description, yaml }: { title: string; description: string; yaml: string } = $props()
  let copied = $state(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(yaml)
    } catch {
      const input = document.createElement('textarea')
      input.value = yaml
      input.style.position = 'fixed'
      input.style.opacity = '0'
      document.body.appendChild(input)
      input.select()
      const success = document.execCommand('copy')
      input.remove()
      if (!success) return
    }
    copied = true
    clearTimeout(timer)
    timer = setTimeout(() => { copied = false }, 1800)
  }

  onDestroy(() => clearTimeout(timer))
</script>

<section class="snippet" aria-label={title}>
  <div class="snippet-head">
    <div><strong>{title}</strong><p>{description}</p></div>
    <button type="button" onclick={copy}>{copied ? 'Copied' : 'Copy YAML'}</button>
  </div>
  <pre><code>{yaml}</code></pre>
</section>

<style>
  .snippet { min-width:0; padding-top:var(--space-8); border-top:1px solid var(--border); }
  .snippet-head { display:flex; align-items:start; justify-content:space-between; gap:var(--space-4); }
  strong { color:var(--foreground); font-size:var(--text-xs); }
  p { margin:var(--space-2) 0 var(--space-5); color:var(--muted-foreground); font-size:var(--text-2xs); line-height:var(--leading-ui); }
  button { flex-shrink:0; min-height:32px; padding:0 var(--space-5); border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--surface-elevated); color:var(--foreground); font-size:var(--text-xs); font-weight:var(--weight-semibold); cursor:pointer; }
  button:hover { border-color:var(--primary-border); color:var(--primary); }
  button:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  pre { max-height:180px; margin:0; padding:var(--space-5); overflow:auto; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--input); color:var(--foreground); font:var(--text-2xs)/1.5 var(--font-mono); white-space:pre; }
</style>
