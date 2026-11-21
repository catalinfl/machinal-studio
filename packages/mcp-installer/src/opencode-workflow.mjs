const productionSkills = ['machinal-editing', 'machinal-recipes', 'machinal-scenes', 'machinal-cinema', 'machinal-review', 'machinal-credits'];
const videoIntent = /\b(video|film|documentar\w*|cinematic\w*|montaj|reel|tiktok|animation|animație|animatie)\b/iu;
const implementationIntent = /\b(renderer|plugin|bug|codul|code|test\w*|repar\w*|debug\w*|fix|refactor\w*)\b/iu;
const productionIntent = /\b(creează|creeaza|realizează|realizeaza|generează|genereaza|create|make|produce|render|randează|randeaza|editează|editeaza|edit)\b/iu;

export async function installWorkflowStartup(ctx) {
  if (ctx.skill?.transform) {
    await ctx.skill.transform(editor => {
      for (const id of [...productionSkills, 'machinal-media', 'machinal-support']) {
        const legacy = id.replace('machinal-', 'directional-');
        if (editor.get(id) && editor.get(legacy)) editor.remove(legacy);
      }
    });
  }
  await ctx.session.hook('prompt', async event => {
    const prompt = event.prompt;
    if (!prompt) return;
    const selected = new Set((prompt.skills ?? []).map(skill => skill.id));
    const explicit = productionSkills.some(id => selected.has(id));
    const text = (prompt.text ?? '').normalize('NFD').replace(/\p{M}/gu, '');
    if (!explicit && !(videoIntent.test(text) && productionIntent.test(text) && !implementationIntent.test(text))) return;
    const available = new Set((await ctx.skill.list()).map(skill => skill.id));
    for (const id of productionSkills) {
      if (available.has(id) && !selected.has(id)) {
        (prompt.skills ??= []).push({ id });
      }
    }
  });
  await ctx.session.hook('context', event => {
    event.system.push({ type: 'text', text: 'machinal production startup: relevant installed production skills, including machinal-cinema, are attached through the native prompt skill resolver for explicit video creation/edit requests or selected machinal production skills. For ambiguous requests, load them before planning. Read the exact chosen film-style source with get_editing_reference(topic=film-styles,id=...) before the production contract; a style name alone is not direction. Skill loading grants no source-use or spending permission. Save production state, sources, resolved recipeFile and job IDs as checkpoints; resume the existing jobs/assets after interruption, not new paid submissions.' });
  });
}
