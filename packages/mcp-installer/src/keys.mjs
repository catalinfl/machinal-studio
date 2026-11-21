import { checkConnection, normalizeEndpoint, validateAPIKey } from './connection.mjs';
import { InstallerError } from './errors.mjs';
import { API_KEYS_URL } from './presentation.mjs';

async function promptKey({ interactive, ui, log, verbose }) {
  if (!interactive) throw new InstallerError(`No API key is available. Create one at ${API_KEYS_URL}, then supply MACHINAL_API_KEY securely, save a key with key set on Windows, or rerun in an interactive terminal for hidden entry. Nothing was saved.`);
  log(verbose ? `To create a new application key, open ${API_KEYS_URL} (use your own website's /api-keys page for a self-hosted account), then return here for hidden entry. Active Premium/API access is required. Never paste the key into chat.`
    : `Create a key: open ${API_KEYS_URL} (or your self-hosted /api-keys page). Premium/API access required. Enter it only in the hidden prompt, never in chat.`);
  return validateAPIKey(await ui.password({ message: 'machinal API key (Ctrl+C to cancel):', mask: '*', validate: (value) => {
    try { validateAPIKey(value); return true; } catch { return `Enter the complete mach_ application key from ${API_KEYS_URL}.`; }
  } }));
}

async function chooseAvailableKey(value, source, context) {
  const { interactive, ui, log } = context;
  const location = source === 'saved' ? 'Windows Credential Manager' : 'MACHINAL_API_KEY';
  let key;
  try { key = validateAPIKey(value); } catch {
    if (!interactive) throw new InstallerError(`The API key from ${location} is invalid. Use key set to replace it, key delete to remove a saved key, or --session-key to bypass saved credentials. Check MACHINAL_API_KEY if set. Create a key at ${API_KEYS_URL}. Nothing was changed.`);
    log(`Warning: the API key from ${location} has an invalid format. You can enter a replacement without deleting the current key first.`);
  }

  if (interactive) {
    const action = await ui.select({
      message: `API key from ${location}`,
      default: key ? 'reuse' : 'key',
      choices: [
        ...(key ? [{ name: 'Use the current API key', value: 'reuse' }] : []),
        { name: 'Enter a different key', value: 'key', description: 'Hidden entry. The saved key is kept until you approve replacement.' },
        { name: 'Create a new key', value: 'create', description: API_KEYS_URL },
        { name: 'Cancel', value: 'cancel', description: 'Keep the current key and settings.' },
      ],
    });
    if (action === 'key' || action === 'create') return { key: await promptKey(context), source: 'prompt' };
    if (action !== 'reuse' || !key) throw new InstallerError('Cancelled. The current API key and settings were not changed.');
  }

  if (!interactive) log(`Using the API key from ${location}.`);
  return { key, source };
}

export async function readKey(context, { sessionOnly = false } = {}) {
  const { env, credentialStore, log } = context;
  const environmentKey = env.MACHINAL_API_KEY || env.DIRECTION_API_KEY;
  if (environmentKey) return chooseAvailableKey(environmentKey, 'environment', context);

  if (credentialStore && !sessionOnly) {
    let saved;
    try { saved = await credentialStore.read(); } catch (error) {
      if (!context.interactive) throw error;
      log('Warning: Windows Credential Manager is unavailable. Continue with hidden entry for this session; no saved credential will be changed unless you approve saving after verification.');
      return { key: await promptKey(context), source: 'prompt' };
    }
    if (saved !== null) return chooseAvailableKey(saved, 'saved', context);
  }

  return { key: await promptKey(context), source: 'prompt' };
}

export async function offerKeyStorage(credentials, context, { sessionOnly = false } = {}) {
  const { credentialStore, interactive, ui, log } = context;
  if (!credentialStore || !interactive || sessionOnly || credentials.source === 'saved') return;

  let previous;
  try {
    previous = await credentialStore.read();
  } catch {
    log('Warning: Windows Credential Manager is unavailable. The key has not been saved; it is available for this session only.');
    return;
  }
  if (previous === credentials.key) return;

  const message = previous === null
    ? 'Remember this API key in Windows Credential Manager on this device?'
    : 'Replace the API key saved in Windows Credential Manager with this key?';
  if (!await ui.confirm({ message, default: false })) return;

  try {
    await credentialStore.write(credentials.key);
    log(context.verbose ? 'API key saved in Windows Credential Manager. The automatic OpenCode MCP integration will load it and reconnect; legacy launcher sessions also read it.'
      : 'API key saved in Windows Credential Manager. OpenCode will load it automatically.');
    const environmentKey = context.env.MACHINAL_API_KEY || context.env.DIRECTION_API_KEY;
    if (environmentKey && environmentKey.trim() !== credentials.key) {
      log('Warning: an API-key environment variable still contains a different key and takes precedence next time. Unset it before launching to use the saved replacement. Running clients were not changed.');
    }
  } catch {
    log('Warning: the API key could not be saved in Windows Credential Manager. Use it for this session or retry with key set. No plaintext fallback is used.');
  }
}

export async function manageKey(action, values, context) {
  if (!['set', 'delete'].includes(action)) throw new InstallerError('Use key set or key delete.');
  const { credentialStore, interactive, ui, log, env } = context;
  if (!credentialStore) throw new InstallerError('Saved-key management is currently supported only on Windows. Use MACHINAL_API_KEY or hidden entry on this platform.');

  if (action === 'set') {
    if (!interactive) throw new InstallerError('Run key set in an interactive terminal. The new key must be entered through the hidden prompt, never command arguments.');
    const endpoint = values.url === undefined ? null : normalizeEndpoint(values.url);
    const key = await promptKey(context);
    if (endpoint) {
      log('Checking the replacement key against MCP before changing Windows Credential Manager (no paid operations)...');
      await (context.checkConnection ?? checkConnection)(endpoint, key);
      log('MCP verified: the replacement API key was accepted. The saved key has not been changed yet.');
    }
    if (!await ui.confirm({ message: 'Save this key in Windows Credential Manager, replacing any previously saved key?', default: false })) {
      log('Saved API key was not changed.');
      return 0;
    }
    await credentialStore.write(key);
    log(endpoint
      ? 'API key saved in Windows Credential Manager after successful MCP verification.'
      : 'API key saved in Windows Credential Manager. Its format was checked; run setup to verify API access.');
    log('The automatic OpenCode MCP integration picks up saved-key changes without restarting OpenCode. Existing clients without that integration still use their previous key; use launch opencode / launch claude / launch codex for legacy environment-based connections.');
  } else {
    if (!values.yes && !interactive) throw new InstallerError('Run key delete interactively, or use key delete --yes to explicitly confirm removal.');
    if (!values.yes && !await ui.confirm({ message: 'Delete the API key saved in Windows Credential Manager?', default: false })) {
      log('Saved API key was not changed.');
      return 0;
    }
    const deleted = await credentialStore.delete();
    log(deleted ? 'Saved API key deleted from Windows Credential Manager.' : 'No API key was saved in Windows Credential Manager.');
    log('This does not revoke the key in your account or remove it from running clients or environment variables.');
  }

  if (env.MACHINAL_API_KEY || env.DIRECTION_API_KEY) log('An API-key environment variable is set and still takes precedence over the saved key. Unset it before launching if you want to use saved credentials.');
  return 0;
}
