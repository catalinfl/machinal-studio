export const DIRECT_TOOLS = [
  'list_projects', 'get_workflow_preferences', 'get_credits', 'get_capabilities',
  'get_recipe_schema', 'get_editing_reference', 'wait_for_job', 'get_job_result',
];

export async function installDirectTools(ctx, servers) {
  const names = [...servers];
  await ctx.tool.transform((editor) => {
    for (const server of names) {
      for (const name of DIRECT_TOOLS) {
        const id = `${server}_${name}`.replace(/[^a-z\d_-]/gi, '_');
        editor.update(id, (tool) => {
          const { pinned: _pinned, ...options } = tool.options ?? {};
          tool.options = { ...options, codemode: false };
          tool.description = `${tool.description ?? ''} OpenCode routing: this is the direct native tool ${id}; it is not callable through tools.${server}.${name} inside execute. Call the exposed native tool instead.`;
        });
      }
    }
  });
  await ctx.session.hook('context', (event) => {
    event.system.push({ type: 'text', text: 'machinal quick path: common project/preferences/credits/schema/reference/job-wait/result tools are exposed directly, so call their registered native tools without a Code Mode search. Discover only unknown tools and reuse their exact paths/signatures for this session; do not rediscover per step or use web search for MCP tool names. Read independent guides concurrently, and reuse unchanged schema/reference knowledge until schemaHash changes. For explicitly approved client-local downloads prefer machinal_download with projectId + jobId/file, or a public HTTPS url + directory + filename. It streams natively, with no PowerShell/curl/shell scripts, no key in arguments and no overwrite. A requested link stays a link; do not download unasked. Public internet downloads authorize neither project import nor media use/spending. Web search latency itself is controlled by the host search provider, not machinal.' });
  });
  await ctx.session.hook('context', (event) => {
    event.system.push({ type: 'text', text: `machinal direct/native tool IDs (NOT Code Mode paths): ${names.flatMap(server => DIRECT_TOOLS.map(name => `${server}_${name}`.replace(/[^a-z\d_-]/gi, '_'))).join(', ')}. Use the native tool names actually exposed by the host; never call these through tools.* in execute. All other tools require one catalog discovery. A missing Code Mode path is a routing issue, not evidence of lost authentication.` });
    event.system.push({ type: 'text', text: 'machinal recipe transfer in OpenCode: get_job_result accepts optional recipeFile (absolute new .edit.yaml path) to save resolved YAML verbatim as UTF-8 without overwriting. validate_recipe, compile_recipe, generate_assets and render_video accept compositionFile (absolute existing .edit.yaml) instead of composition/sourceJobId. These local integration fields use normal host file permissions and the original MCP execution/approval path; they transfer recipe text, not local media. Prefer this path for large recipes: patch the saved file, then send compositionFile. Never invent compression/base64/LZW transfer workarounds, reconstruct captions, switch to a guessed old namespace or stop merely because Code Mode lacks filesystem access. Direct tools are called directly; discover only the other required signatures once.' });
    event.system.push({ type: 'text', text: 'machinal continuity: carry actual source/generation/rendering approval through every covered stage to terminal completion and the requested delivery. userApproved asserts existing permission; do not ask again or stop for a continue message after timing/images/scenes. Ask only for missing permission, genuinely changed scope, exceeded hard budget or a precise persistent blocker. Host permission controls remain enabled and separate; never auto-approve them. Repair actual 422 source diagnostics within scope, but scene-render EACCES is infrastructure, not a reason to rewrite Svelte or regenerate successful assets.' });
    event.system.push({ type: 'text', text: 'machinal deterministic checkpoints: get_job_result and free validate_recipe/compile_recipe accept checkpointFile to save compact project/job IDs, exact compositionVersion and captionVersion. Save the timing baseline alongside recipeFile. When adding only visuals, use captionBaselineFile for deterministic comparison of every text entry and caption resultTextIds. Save a new preflight checkpoint after each recipe edit; paid calls can read checkpointFile to apply the reviewed hash automatically, without manual copying. These are tool inputs, not YAML fields; host file permissions and spending approval remain required. Summary preflight is the default; use fullResult=true only when the normalized document/plan is needed.' });
    event.system.push({ type: 'text', text: 'For authorized caption name/spelling corrections, preflight with the intact captionBaselineRecipeFile, exact captionTextEdits and captionEditsApproved=true; require captionReview.status=preserved before establishing a new baseline. Never drop the original comparison merely because a text edit was authorized. Preflight checkpoints explicitly record visualInspection=false: compilation is not pixel/video/audio inspection. Loopback delivery reachability=same-machine must be disclosed; cross-device links require configured HTTPS PUBLIC_API_URL, not a rewritten URL or another render.' });
  });
}
