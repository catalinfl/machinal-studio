import { applyEdits, modify, parse } from 'jsonc-parser';
import { InstallerError } from './errors.mjs';
import { VERSION } from './version.mjs';

const installedPackage = /\/node_modules\//.test(import.meta.url);
export const OPENCODE_AUTH_PLUGIN = installedPackage ? `@machinal/mcp@${VERSION}` : new URL('./opencode-plugin', import.meta.url).href;

export function configureOpenCodeAuth(content, name, url) {
  const config = parse(content);
  const plugins = config.plugins ?? [];
  if (!Array.isArray(plugins)) throw new InstallerError('OpenCode plugins must be an array. No configuration was changed.');
  const index = plugins.findIndex((entry) => (typeof entry === 'string' ? entry : entry?.package) === OPENCODE_AUTH_PLUGIN);
  const existing = index < 0 || typeof plugins[index] === 'string' ? {} : plugins[index].options ?? {};
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)
    || (existing.servers !== undefined && (!existing.servers || typeof existing.servers !== 'object' || Array.isArray(existing.servers)))) {
    throw new InstallerError('The machinal authentication plugin options are invalid. No configuration was changed.');
  }
  const servers = { ...existing.servers, [name]: url };
  if (name === 'machinal' && servers.directional === url) delete servers.directional;
  const entry = { package: OPENCODE_AUTH_PLUGIN, options: { ...existing, servers } };
  if (index >= 0 && JSON.stringify(plugins[index]) === JSON.stringify(entry)) return content;
  const indent = content.match(/^[ \t]+(?=")/m)?.[0] ?? '  ';
  const path = config.plugins ? ['plugins', index < 0 ? -1 : index] : ['plugins'];
  const value = config.plugins ? entry : [entry];
  return applyEdits(content, modify(content, path, value, {
    formattingOptions: { insertSpaces: !indent.includes('\t'), tabSize: indent.length, eol: content.includes('\r\n') ? '\r\n' : '\n' },
  }));
}
