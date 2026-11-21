import { lstat, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InstallerError } from './errors.mjs';
import { planTextFile, saveConfiguration } from './configuration.mjs';
import { EDITING_STYLES } from './setup-options.mjs';
import referenceFiles from './reference-files.json' with { type: 'json' };

export const SKILL_FILES = [
  'machinal-editing/SKILL.md',
  'machinal-recipes/SKILL.md',
  'machinal-recipes/references/example.edit.yaml',
  'machinal-credits/SKILL.md',
  'machinal-scenes/SKILL.md',
  'machinal-cinema/SKILL.md',
  'machinal-review/SKILL.md',
  'machinal-media/SKILL.md',
  'machinal-support/SKILL.md',
  ...referenceFiles,
];
const bundle = fileURLToPath(new URL('../skills/', import.meta.url));

export function skillsDirectory({ client, scope, cwd = process.cwd(), home = homedir(), env = process.env }) {
  if (!['project', 'global'].includes(scope)) throw new InstallerError('Choose project or global skill scope.');
  if (client === 'opencode') return join(scope === 'project' ? join(cwd, '.opencode') : join(env.XDG_CONFIG_HOME || join(home, '.config'), 'opencode'), 'skills');
  if (client === 'claude') return join(scope === 'project' ? join(cwd, '.claude') : env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'skills');
  if (client === 'codex') return join(scope === 'project' ? cwd : home, '.agents', 'skills');
  throw new InstallerError('Choose opencode, claude, or codex.');
}

export async function refuseSymlinkParents(file, root) {
  let directory = dirname(file);
  while (directory.length >= dirname(root).length) {
    try {
      if ((await lstat(directory)).isSymbolicLink()) throw new InstallerError('Skill directories must not be symlinks. Existing files were preserved.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (directory === dirname(root)) break;
    directory = dirname(directory);
  }
}

export async function planSkills(options) {
  if (!EDITING_STYLES.includes(options.style)) throw new InstallerError('Unsupported editing style.');
  const root = skillsDirectory(options);
  const contents = await Promise.all(SKILL_FILES.map(async (file) => [file, await readFile(join(bundle, file), 'utf8')]));
  contents.push(['machinal-editing/references/preferences.md', `# Installed editing preference\n\nDefault style: **${options.style}**.\n\nUse this only when the user's current brief does not choose a different style. Read machinal://skills/editing for the profile definitions. This preference does not add YAML fields or authorize paid work.\n`]);
  const plans = [];
  for (const [relative, content] of contents) {
    const file = join(root, relative);
    await refuseSymlinkParents(file, root);
    plans.push(await planTextFile(file, content));
  }
  return { root, plans, conflict: plans.some((plan) => plan.original !== null && plan.original !== plan.content) };
}

export async function saveSkills({ plans }) {
  const saved = [];
  try {
    for (const plan of plans) saved.push(await saveConfiguration(plan));
  } catch {
    const backups = saved.filter((result) => result.backup).length;
    throw new InstallerError(`MCP configuration was saved, but skill installation was incomplete (${saved.filter((result) => result.changed).length} files updated). ${backups} completed skill backups were retained beside their originals under <filename>.machinal-backup-*. Check permissions/disk space and run setup again; any backup made during the failed write is also retained.`);
  }
  return { changed: saved.filter((result) => result.changed).length, backups: saved.map((result) => result.backup).filter(Boolean) };
}
