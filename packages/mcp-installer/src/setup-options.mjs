import { InstallerError } from './errors.mjs';
import { isLoopbackEndpoint, normalizeEndpoint } from './connection.mjs';
import styleProfiles from '../skills/machinal-editing/references/styles.json' with { type: 'json' };

export const DEFAULT_LOCAL_URL = 'http://127.0.0.1:8080/mcp';
export const EDITING_STYLES = styleProfiles.map((profile) => profile.id);

export async function chooseClient(value, { interactive, ui }) {
  if (value && ['opencode', 'claude', 'codex'].includes(value)) return value;
  if (value || !interactive) throw new InstallerError('Specify --client opencode, --client claude, or --client codex.');
  return ui.select({ message: 'Client', choices: [
    { name: 'OpenCode V2', value: 'opencode' },
    { name: 'Claude Code', value: 'claude' },
    { name: 'Codex', value: 'codex' },
  ] });
}

export async function chooseEndpoint(values, { env, interactive, ui }) {
  let mode = values.mode === 'hosted' ? 'server' : values.mode;
  if (mode && !['local', 'server'].includes(mode)) throw new InstallerError('Choose --mode local or --mode server (--mode hosted is still an alias for server).');
  let rawURL = values.url || env.MACHINAL_API_ORIGIN || env.DIRECTION_API_ORIGIN;
  const inferred = rawURL ? 'server' : undefined;
  if (!mode && interactive && !values.url) {
    mode = await ui.select({ message: 'API location', default: inferred ?? 'server', choices: [
      { name: 'Server — machinal account', value: 'server', short: 'Server', description: 'Hosted API: application key, account and credits.' },
      { name: 'Local — your own Docker', value: 'local', short: 'Local', description: 'Your hardware, volume and OpenRouter key. No machinal account.' },
    ] });
  }
  mode ??= inferred;
  if (mode === 'local' && !values.url && (!rawURL || !isLoopbackEndpoint(normalizeEndpoint(rawURL)))) rawURL = DEFAULT_LOCAL_URL;
  if (interactive && !values.url) {
    rawURL = await ui.input({
      message: mode === 'local' ? 'Local API URL' : 'Server API URL (not the website)',
      default: rawURL ?? DEFAULT_LOCAL_URL, required: true,
      validate: (value) => {
        try {
          const url = normalizeEndpoint(value);
          return mode !== 'local' || isLoopbackEndpoint(url) || 'Local mode needs a loopback URL. Choose Server for a remote API.';
        } catch (error) { return error.message; }
      },
    });
  }
  if (!rawURL) throw new InstallerError('Specify --url with your API origin, or --mode local for the loopback default.');
  const url = normalizeEndpoint(rawURL);
  mode ??= 'server';
  if (mode === 'local' && !isLoopbackEndpoint(url)) {
    throw new InstallerError('Local mode requires a loopback API URL. Use --mode server for a deployed HTTPS API.');
  }
  return { mode, url };
}

export async function chooseSkillOptions(values, { interactive, ui }) {
  if (values['no-skills']) {
    if (values.style || values['replace-skills']) throw new InstallerError('--no-skills cannot be combined with --style or --replace-skills.');
    return null;
  }
  if (values.style && !EDITING_STYLES.includes(values.style)) throw new InstallerError(`Choose --style from: ${EDITING_STYLES.join(', ')}.`);
  if (interactive && !await ui.confirm({ message: 'Install editing, recipe, scene, credit and media skills?', default: true })) return null;
  const style = values.style ?? (interactive ? await ui.select({
    message: 'Default editing style (change per brief)', default: 'auto',
    choices: styleProfiles.map(({ id, label }) => ({ name: id === 'auto' ? 'Auto — adapt to the brief' : label, short: id, value: id })),
  }) : 'auto');
  return { style };
}
