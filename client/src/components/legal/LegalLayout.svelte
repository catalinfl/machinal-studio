<script lang="ts">
  import type { Snippet } from 'svelte'
  import ProductShell from '../product/ProductShell.svelte'
  import { legalIsDraft, LEGAL_REVISION, LEGAL_REVISION_LABEL } from '../../lib/legal'
  import { onMount } from 'svelte'
  import { scrollToLegalSection } from '../../lib/legal-section-navigation'

  let { title, description, sections, children }: {
    title: string
    description: string
    sections: { id: string; title: string }[]
    children: Snippet
  } = $props()

  onMount(() => {
    const id = window.location.hash.slice(1)
    document.getElementById(id)?.scrollIntoView({ block: 'start' })
  })
</script>

<svelte:head><title>{title} | machinal</title><meta name="description" content={description} />{#if legalIsDraft}<meta name="robots" content="noindex" />{/if}</svelte:head>

<ProductShell>
  <header class="legal-header"><h1>{title}</h1><p>{description}</p><div class="revision"><span>{legalIsDraft ? 'Draft for review' : 'Last updated'}</span><time datetime={LEGAL_REVISION}>{LEGAL_REVISION_LABEL}</time></div></header>
  {#if legalIsDraft}<aside class="draft-note"><strong>Before public launch</strong><p>These terms and notices are a draft. Operator details and deployment-specific providers, retention and legal requirements must be completed and reviewed before this service is offered publicly.</p></aside>{/if}
  <div class="legal-layout">
    <nav class="contents" aria-label="On this page"><h2>On this page</h2>{#each sections as section}<a href={`#${section.id}`} onclick={scrollToLegalSection}>{section.title}</a>{/each}<div><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a><a href="/cookies">Cookies &amp; storage</a></div></nav>
    <article class="legal-article">{@render children()}</article>
  </div>
</ProductShell>

<style>
  .legal-header { max-width: 850px; padding: 16px 0 32px; }
  .legal-header p { margin: 20px 0; color: var(--home-muted); font-size: 18px; line-height: 1.7; max-width: 65ch; }
  .revision { display: flex; gap: 16px; color: var(--home-muted); font-size: 12px; }
  .revision span { color: var(--home-accent); }
  .draft-note { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 28px; margin-bottom: 40px; padding: 20px 24px; background: var(--home-tint); border: 1px solid var(--home-rule); }
  .draft-note strong { font-size: 14px; font-weight: 500; }
  .draft-note p { margin: 0; max-width: 85ch; font-size: 14px; line-height: 1.7; }
  .legal-layout { display: grid; grid-template-columns: 220px minmax(0, 760px); gap: clamp(36px, 7vw, 100px); align-items: start; }
  .contents { position: sticky; top: 24px; }
  .contents h2 { margin: 0 0 12px; font-size: 14px; font-weight: 500; }
  .contents a { display: block; padding-block: 8px; font-size: 13px; color: var(--home-muted); line-height: 1.5; text-decoration: none; }
  .contents a:hover { color: var(--home-accent); text-decoration: underline; }
  .contents > div { border-top: 1px solid var(--home-rule); margin-top: 20px; padding-top: 12px; }
  .legal-article { min-width: 0; font-size: 16px; line-height: 1.8; overflow-wrap: anywhere; }
  .legal-article :global(section) { margin-bottom: 38px; scroll-margin-top: 28px; }
  .legal-article :global(h2) { margin: 0 0 18px; padding-top: 18px; border-top: 1px solid var(--home-rule); font-size: 23px; font-weight: 500; line-height: 1.3; letter-spacing: -.025em; }
  .legal-article :global(h3) { margin: 24px 0 10px; font-size: 17px; font-weight: 500; line-height: 1.5; }
  .legal-article :global(p) { margin: 0 0 16px; }
  .legal-article :global(ul) { padding-left: 22px; margin: 0 0 18px; }
  .legal-article :global(li) { padding-left: 4px; margin-bottom: 10px; }
  .legal-article :global(li::marker) { color: var(--home-accent); }
  .legal-article :global(a) { color: var(--home-accent); }
  .legal-article :global(code) { padding: 2px 5px; background: var(--home-code); color: var(--home-code-ink); font: .8em/1.6 var(--font-mono); }
  .legal-article :global(strong) { font-weight: 600; }
  @media (max-width: 850px) { .legal-layout { grid-template-columns: 1fr; gap: 32px; } .contents { position: static; display: grid; grid-template-columns: 1fr 1fr; column-gap: 24px; padding-bottom: 20px; border-bottom: 1px solid var(--home-rule); } .contents h2, .contents > div { grid-column: 1 / -1; } .contents > div { display: flex; flex-wrap: wrap; gap: 4px 20px; } .draft-note { grid-template-columns: 1fr; gap: 8px; } }
  @media (max-width: 440px) { .legal-header p { font-size: 16px; } .contents { grid-template-columns: 1fr; } .draft-note { padding: 18px; } }
</style>
