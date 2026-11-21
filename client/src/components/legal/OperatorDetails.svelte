<script lang="ts">
  import { contactHref, legalOperator } from '../../lib/legal'

  let { privacy = false }: { privacy?: boolean } = $props()
  const email = $derived(privacy ? legalOperator.privacyEmail : legalOperator.email)
</script>

<dl class="operator-details">
  <div><dt>Operator</dt><dd>{legalOperator.name || 'Not yet supplied'}</dd></div>
  <div><dt>Registered address</dt><dd>{legalOperator.address || 'Not yet supplied'}</dd></div>
  <div><dt>Country</dt><dd>{legalOperator.country || 'Not yet supplied'}</dd></div>
  <div><dt>{privacy ? 'Privacy contact' : 'Contact'}</dt><dd>{#if email}<a href={contactHref(email, privacy ? 'Privacy request' : 'machinal enquiry')}>{email}</a>{:else}Not yet supplied{/if}</dd></div>
</dl>

<style>
  .operator-details { margin: 24px 0; }
  .operator-details > div { display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: 12px; padding: 12px 0; border-top: 1px solid var(--home-rule); font-size: 14px; line-height: 1.65; }
  dt { color: var(--home-muted); }
  dd { margin: 0; overflow-wrap: anywhere; white-space: pre-line; }
  @media (max-width: 600px) { .operator-details > div { grid-template-columns: 1fr; gap: 3px; } }
</style>
