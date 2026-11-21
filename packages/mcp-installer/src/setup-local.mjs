import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { checkConnection } from './connection.mjs';
import { planConfiguration, planTextFile, saveConfiguration } from './configuration.mjs';
import { prepareLocalDocker } from './docker.mjs';
import { InstallerError } from './errors.mjs';
import { chooseSkillOptions } from './setup-options.mjs';
import { refuseSymlinkParents, saveSkills, skillsDirectory } from './skills.mjs';
import localReferenceFiles from './local-reference-files.json' with { type: 'json' };

async function approveConflict(conflict, allowed, message, context) {
  if (!conflict || allowed) return;
  if (!context.interactive || !await context.ui.confirm({ message, default: false })) {
    throw new InstallerError('Existing settings were preserved. Choose another name or explicitly approve replacement.');
  }
}

export async function setupLocal(values, endpoint, context) {
  const { client, scope, url } = endpoint;
  const { cwd, home, env, log, interactive, ui } = context;
  if (values['session-key']) throw new InstallerError('--session-key is a Server option. Local mode never reads application credentials.');
  const skillOptions = await chooseSkillOptions(values, context);
  const options = { client, scope, url, mode: 'local', cwd, home, env, name: values.name ?? 'machinal-local' };
  const plan = await planConfiguration(options);
  let skills;
  if (skillOptions) {
    const root = skillsDirectory(options);
    const localSkill = await readFile(new URL('../skills/machinal-local/SKILL.md', import.meta.url), 'utf8');
    const contents = [['machinal-local/SKILL.md', `${localSkill}\nDefault editorial style: ${skillOptions.style}. The current brief always wins.\n`]];
    for (const file of localReferenceFiles) contents.push([file, await readFile(new URL(`../skills/${file}`, import.meta.url), 'utf8')]);
    const plans = [];
    for (const [relative, content] of contents) {
      const file = join(root, relative);
      await refuseSymlinkParents(file, root);
      plans.push(await planTextFile(file, content));
    }
    skills = { root, plans, conflict: plans.some(file => file.original !== null && file.original !== file.content) };
  }
  await approveConflict(plan.conflict, values.replace, 'Replace only this named local MCP configuration?', context);
  await approveConflict(skills?.conflict, values['replace-skills'], 'Back up and replace the machinal-local skill?', context);
  log('Local Docker: no machinal account, application key, S3 or credits. Your OpenRouter key belongs only in the local editor or container.');
  const verify = context.checkConnection ?? checkConnection;
  let result;
  try {
    result = await verify(url, undefined, { local: true });
  } catch (error) {
    if (error.code !== 'network' || !error.retryable) throw error;
    await prepareLocalDocker(values, url, context);
    result = await verify(url, undefined, { local: true });
  }
  if (result.mode !== 'local') throw new InstallerError('The endpoint is not a verified machinal-local installation. Choose Server for an authenticated deployment.');
  const saved = await saveConfiguration(plan);
  if (saved.backup) log(`Configuration backup: ${saved.backup}`);
  if (skills) {
    const installed = await saveSkills(skills);
    for (const backup of installed.backups) log(`Skill backup: ${backup}`);
  }
  log(`Local MCP verified: ${result.toolCount} tools. Configuration: ${plan.file}`);
  log('No key store or client authentication plugin was used. Configure your own OpenRouter key at http://localhost:5173 when AI is needed.');
  if (!values['no-launch'] && interactive && await ui.confirm({ message: `Start ${client} now? No application key is needed.`, default: true })) {
    return context.launch(client, null, { cwd, env, local: true });
  }
  log('Setup complete. Start your client normally and keep the Docker containers running. Client connection not checked.');
  return 0;
}
