import { InstallerError } from './errors.mjs';

export const WINDOWS_CREDENTIAL = Object.freeze({
  service: 'Machinal/mcp',
  account: 'MACHINAL_API_KEY',
  target: 'Machinal/mcp.MACHINAL_API_KEY',
});

const LEGACY_WINDOWS_CREDENTIAL = Object.freeze({
  service: 'direction.al/mcp',
  account: 'DIRECTION_API_KEY',
});

export function createCredentialStore({
  platform = process.platform,
  load = () => import('@napi-rs/keyring'),
  service = WINDOWS_CREDENTIAL.service,
  account = WINDOWS_CREDENTIAL.account,
} = {}) {
  if (platform !== 'win32') return null;

  let modulePromise;
  let entry;
  let legacyEntry;
  const getModule = () => modulePromise ??= load();
  const getEntry = () => entry ??= getModule().then(({ AsyncEntry }) => new AsyncEntry(service, account));
  const canReadLegacy = service === WINDOWS_CREDENTIAL.service && account === WINDOWS_CREDENTIAL.account;
  const getLegacyEntry = () => legacyEntry ??= getModule().then(({ AsyncEntry }) => new AsyncEntry(
    LEGACY_WINDOWS_CREDENTIAL.service, LEGACY_WINDOWS_CREDENTIAL.account,
  ));

  return {
    async read() {
      try {
        const current = await (await getEntry()).getPassword();
        if (current != null || !canReadLegacy) return current;
        return await (await getLegacyEntry()).getPassword();
      } catch {
        throw new InstallerError('Could not read Windows Credential Manager. Retry, or use --session-key to bypass saved credentials.');
      }
    },
    async write(key) {
      try {
        await (await getEntry()).setPassword(key);
      } catch {
        throw new InstallerError('Could not save the API key in Windows Credential Manager. No plaintext fallback is used.');
      }
    },
    async delete() {
      try {
        const deleted = await (await getEntry()).deleteCredential();
        if (canReadLegacy) {
          try { return Boolean(await (await getLegacyEntry()).deleteCredential()) || Boolean(deleted); } catch {}
        }
        return Boolean(deleted);
      } catch {
        throw new InstallerError('Could not delete the API key from Windows Credential Manager. Retry or remove its Machinal/mcp entry manually.');
      }
    },
  };
}
