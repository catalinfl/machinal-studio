import { dirname, resolve } from 'node:path';
import { InstallerError } from './errors.mjs';
import { checkConnection } from './connection.mjs';
import { planConfiguration, saveConfiguration } from './configuration.mjs';
import { compactCreditSummaryLines, creditSummaryLines } from './credits.mjs';
import { chooseClient, chooseEndpoint, chooseSkillOptions } from './setup-options.mjs';
import { offerKeyStorage, readKey } from './keys.mjs';
import { planSkills, saveSkills } from './skills.mjs';
import { prepareLocalDocker } from './docker.mjs';
import { API_KEYS_URL, backupSummary } from './presentation.mjs';
import { setupLocal } from './setup-local.mjs';

async function confirmReplacement(conflict, allowed, message, errorMessage, { interactive, ui }) {
  if (!conflict || allowed) return;
  if (!interactive || !await ui.confirm({ message, default: false })) throw new InstallerError(errorMessage);
}

async function scopeFor(values, { interactive, ui }) {
  return values.scope ?? (interactive ? ui.select({
    message: 'Available in', default: 'project', choices: [
      { name: 'This project', value: 'project' }, { name: 'All my projects', value: 'global' },
    ],
  }) : 'project');
}

function reportConfiguration(result, saved, { log, verbose }, installed, file) {
  if (!verbose) {
    log('Setup ready', 'heading');
    log(`MCP verified: ${result.toolCount} tools. Client connection not checked.`);
    log(`Configuration ${saved.changed ? 'saved' : 'already up to date'}: ${file}`);
    if (installed) log(`Skills ready: ${installed.changed} bundled files updated.`);
    if (result.referenceWarning) log(result.referenceWarning);
    if (result.mediaWarning) log(result.mediaWarning);
    if (result.credits) {
      for (const line of compactCreditSummaryLines(result.credits)) log(line);
    } else {
      log(result.creditsWarning);
    }
    return;
  }
  log(`Configured: ${result.toolCount} API tools verified. ${saved.changed ? 'Configuration saved.' : 'Configuration already up to date.'}`);
  if (result.referenceWarning) log(result.referenceWarning);
  if (result.mediaWarning) log(result.mediaWarning);
  if (result.credits) {
    for (const line of creditSummaryLines(result.credits)) log(line);
  } else {
    log(result.creditsWarning);
  }
  log('Only non-secret connection settings were written. The API check does not verify a running client connection.');
}

async function planClientStartup(values, client, credentials, { env, interactive, ui, log, verbose }, automaticAuth) {
  const hasEnvironmentKey = (env.MACHINAL_API_KEY || env.DIRECTION_API_KEY)?.trim() === credentials.key;
  const hasAutomaticKey = automaticAuth && credentials.source === 'saved';
  if (!hasEnvironmentKey && !hasAutomaticKey) {
    log('Warning: the verified key is available only to this installer. A saved key or hidden prompt does not provide MACHINAL_API_KEY to clients started separately.');
  }
  const launchNow = !values['no-launch'] && interactive && await ui.confirm({
    message: `Start ${client} now with the verified API key?`, default: true,
  });
  if (!launchNow && !hasEnvironmentKey && !hasAutomaticKey) {
    throw new InstallerError('The verified API key is not available in the client environment. No configuration, skills, or saved credentials were changed. Rerun setup without --no-launch and accept starting the client with the key, or supply MACHINAL_API_KEY in the environment used to start the client. A key in Windows Credential Manager is read by machinal-mcp launch, not by a client started directly.');
  }
  if (hasAutomaticKey && verbose) log('OpenCode will read the saved machinal key automatically through its MCP authentication integration. No separate launcher or environment setup is required for later sessions.');
  return launchNow;
}

async function verifyEndpoint(values, endpoint, initial, context) {
  const verify = context.checkConnection ?? checkConnection;
  let credentials = initial;
  let dockerAttempted = false;
  for (let attempt = 1; ; attempt++) {
    try {
      return { result: await verify(endpoint.url, credentials.key), credentials };
    } catch (error) {
      if (endpoint.mode === 'local' && error.code === 'network' && error.retryable && !dockerAttempted && attempt < 3) {
        dockerAttempted = true;
        await prepareLocalDocker(values, endpoint.url, context);
        continue;
      }
      if (!context.interactive || attempt >= 3 || !(error.status === 401 || error.retryable)) throw error;
      context.log(`Warning: ${error.message} Configuration and skills have not been changed.`);
      const action = await context.ui.select({ message: 'How would you like to continue?', choices: [
        ...(error.status === 401 ? [
          { name: 'Enter a different API key I already have (hidden)', value: 'key' },
          { name: `Create a new API key — ${API_KEYS_URL}`, value: 'create' },
        ] : []),
        { name: 'Retry connection with the current key', value: 'retry' },
        { name: 'Cancel — keep existing settings', value: 'cancel' },
      ] });
      if (action === 'key' || action === 'create') credentials = await readKey({ ...context, env: {}, credentialStore: null }, { sessionOnly: true });
      else if (action !== 'retry') throw error;
    }
  }
}

export async function setup(values, context) {
  const { cwd, home, env, interactive, ui, log, launch, verbose } = context;
  if (interactive) {
    log('machinal MCP', 'heading');
    log('Connect your client. Setup does not render, generate media or use API credits.');
  }
  const client = await chooseClient(values.client, context);
  const scope = await scopeFor(values, context);
  if (scope === 'project' && dirname(resolve(cwd)) === resolve(cwd)) {
    log('Warning: project setup is running at a drive/filesystem root. Its settings may apply to all descendant projects. Prefer running setup inside your project folder.');
  }
  const endpoint = await chooseEndpoint(values, context);
  const { mode, url } = endpoint;
  if (mode === 'local') return setupLocal(values, { client, scope, url }, context);
  if (mode !== 'local' && (values['start-docker'] || values['docker-dir'])) throw new InstallerError('--start-docker and --docker-dir require --mode local. Server mode never manages Docker.');
  const skillOptions = await chooseSkillOptions(values, context);
  const options = { client, scope, cwd, home, env, url, name: values.name ?? 'machinal' };
  const plan = await planConfiguration(options);
  const skills = skillOptions ? await planSkills({ ...options, ...skillOptions }) : null;
  if (verbose) {
    log(`Mode: ${mode}. ${mode === 'local' ? 'Runs on this user’s computer. Reuses a running API or offers Docker setup from a checkout with your approval. Authentication and billing still apply.' : 'Connects to an existing server, including development Docker on localhost. No server is installed or started.'}`);
    log(`MCP endpoint: ${url}`);
    log(`Configuration: ${plan.file}`);
    if (skills) log(`Bundled skills: ${skills.root} (default style: ${skillOptions.style}).`);
  } else {
    log(`Endpoint: ${url}`);
    log(`Will configure: ${plan.file}`);
    if (skills?.conflict) log(`Bundled skills: ${skills.root}`);
    if (mode === 'local') log('Local Docker: Authentication and billing still apply.');
  }
  await confirmReplacement(plan.conflict, values.replace,
    'This named server already has different settings. Replace only this server?',
    'Existing server settings were preserved. Choose another --name, or explicitly use --replace.', context);
  await confirmReplacement(skills?.conflict, values['replace-skills'],
    'Some bundled skill files already differ. Back up and replace only these bundled files?',
    'Existing skills were preserved. Use --no-skills to keep them, or explicitly use --replace-skills.', context);

  const keyOptions = { sessionOnly: values['session-key'] };
  if (interactive) log('API access', 'heading');
  const initial = await readKey(context, keyOptions);
  log('Checking MCP authentication, tool discovery, and live credits (no paid operations)...');
  const { result, credentials } = await verifyEndpoint(values, endpoint, initial, context);
  const { key } = credentials;
  const launchNow = await planClientStartup(values, client, credentials, context, plan.automaticAuth);
  if (verbose) log(`MCP verified: ${result.toolCount} tools. Saving client configuration...`);
  const saved = await saveConfiguration(plan);
  if (plan.automaticAuth && verbose) log('Automatic OpenCode MCP authentication configured: one saved machinal key, in-memory headers, secure replacement and automatic reconnection.');
  if (verbose) reportConfiguration(result, saved, context);
  let installed;
  try {
    if (skills) {
      installed = await saveSkills(skills);
      if (verbose) log(`Skills ready: machinal-editing, machinal-recipes, machinal-scenes, machinal-credits, machinal-media (${installed.changed} files updated).`);
    }
  } finally {
    const summary = backupSummary(saved, installed, skills?.root);
    if (summary) log(summary);
  }
  if (client === 'claude') log('If prompted, approve the project MCP configuration in Claude Code.');
  if (client === 'codex' && scope === 'project') log('Codex loads project MCP settings only in trusted projects.');

  await offerKeyStorage(credentials, context, keyOptions);
  if (!verbose) reportConfiguration(result, saved, context, installed, plan.file);

  if (launchNow) {
    if (!verbose) log(`Starting ${client}...`);
    return launch(client, key, { cwd, env });
  }
  log(verbose ? 'Warning: no client was started or connected. Existing client processes do not inherit environment changes.'
    : 'Client not started. Existing client processes were not changed.');
  if (plan.automaticAuth && credentials.source === 'saved') {
    log(verbose ? 'OpenCode can start normally. Its MCP integration reads the one saved machinal key and reconnects automatically when that key is replaced.'
      : 'Next: open OpenCode normally. Its MCP integration uses your saved key.');
  } else {
    log(`Next session: npx @machinal/mcp launch ${client}`);
    log('Or start the client yourself with MACHINAL_API_KEY in its environment.');
  }
  return 0;
}
