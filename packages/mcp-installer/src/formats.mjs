import { isDeepStrictEqual } from 'node:util';
import { applyEdits, findNodeAtLocation, getNodeValue, modify, parseTree } from 'jsonc-parser';
import { getStaticTOMLValue, parseTOML } from 'toml-eslint-parser';
import { InstallerError } from './errors.mjs';

export function serverEntry(client, url, local = false) {
	if (local) {
		if (client === 'opencode') return { type: 'remote', url, oauth: false };
		if (client === 'claude') return { type: 'http', url };
		if (client === 'codex') return { url };
	}
  switch (client) {
    case 'opencode':
      return { type: 'remote', url, oauth: false, headers: { Authorization: 'Bearer {env:MACHINAL_API_KEY}' } };
    case 'claude':
      return { type: 'http', url, headers: { Authorization: 'Bearer ${MACHINAL_API_KEY}' } };
    case 'codex':
      return { url, bearer_token_env_var: 'MACHINAL_API_KEY' };
    default:
      throw new InstallerError('Choose opencode, claude, or codex.');
  }
}

function assertUniqueKeys(node) {
  if (node.type === 'object') {
    const keys = node.children.map((property) => property.children[0].value);
    if (new Set(keys).size !== keys.length) {
      throw new InstallerError('The configuration has duplicate JSON keys. Resolve them before running setup.');
    }
  }
  for (const child of node.children ?? []) assertUniqueKeys(child);
}

export function updateJSON(original, client, name, entry) {
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
  const source = original.slice(bom.length) || '{}\n';
  const errors = [];
  const tree = parseTree(source, errors, { allowTrailingComma: client === 'opencode', disallowComments: client !== 'opencode' });
  if (errors.length || tree?.type !== 'object') {
    throw new InstallerError('The existing configuration is not a valid JSON object. It was left unchanged.');
  }
  assertUniqueKeys(tree);

  const path = client === 'opencode' ? ['mcp', 'servers', name] : ['mcpServers', name];
  for (let depth = 1; depth < path.length; depth++) {
    const node = findNodeAtLocation(tree, path.slice(0, depth));
    if (node && node.type !== 'object') {
      throw new InstallerError('The existing MCP settings must be objects. The configuration was left unchanged.');
    }
  }

  if (client === 'opencode') {
    const mcpNode = findNodeAtLocation(tree, ['mcp']);
    const mcp = mcpNode && getNodeValue(mcpNode);
    if (mcp && Object.values(mcp).some((value) => value?.type === 'local' || value?.type === 'remote')) {
      throw new InstallerError('This file uses OpenCode V1 MCP settings. Migrate its MCP section to V2 before running setup.');
    }
  }

  const currentNode = findNodeAtLocation(tree, path);
  const current = currentNode ? structuredClone(getNodeValue(currentNode)) : undefined;
  const conflict = currentNode !== undefined && !isDeepStrictEqual(current, entry);
  const indent = source.match(/^[ \t]+(?=")/m)?.[0] ?? '  ';
  const options = { formattingOptions: { insertSpaces: !indent.includes('\t'), tabSize: indent.length, eol: source.includes('\r\n') ? '\r\n' : '\n' } };
  let content = source;
  if (!isDeepStrictEqual(current, entry)) content = applyEdits(content, modify(content, path, entry, options));
  if (client === 'opencode' && name === 'machinal') {
    const legacy = findNodeAtLocation(tree, ['mcp', 'servers', 'directional']);
    if (legacy && getNodeValue(legacy)?.url === entry.url) {
      content = applyEdits(content, modify(content, ['mcp', 'servers', 'directional'], undefined, options));
    }
  }
  if (client === 'opencode' && !findNodeAtLocation(tree, ['$schema'])) {
    content = applyEdits(content, modify(content, ['$schema'], 'https://opencode.ai/config.json', options));
  }

  return { content: bom + content, conflict };
}

function parseConfigTOML(source) {
  try {
    const ast = parseTOML(source, { tomlVersion: '1.0.0' });
    return { ast, value: getStaticTOMLValue(ast) };
  } catch {
    throw new InstallerError('The Codex configuration is not valid TOML. It was left unchanged.');
  }
}

function withoutServer(value, name) {
  const copy = structuredClone(value);
  if (copy.mcp_servers) {
    delete copy.mcp_servers[name];
    if (!Object.keys(copy.mcp_servers).length) delete copy.mcp_servers;
  }
  return copy;
}

export function updateTOML(original, name, entry) {
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
  const source = original.slice(bom.length);
  const { ast, value } = parseConfigTOML(source);
  const servers = value.mcp_servers;
  if (servers !== undefined && (!servers || typeof servers !== 'object' || Array.isArray(servers))) {
    throw new InstallerError('Codex mcp_servers must be a table. The configuration was left unchanged.');
  }

  const current = servers && Object.hasOwn(servers, name) ? servers[name] : undefined;
  if (isDeepStrictEqual(current, entry)) return { content: original, conflict: false };

  const tables = ast.body[0].body.filter((node) => node.type === 'TOMLTable'
    && node.resolvedKey[0] === 'mcp_servers' && node.resolvedKey[1] === name);
  if (current !== undefined && !tables.some((node) => node.resolvedKey.length === 2 && node.kind === 'standard')) {
    throw new InstallerError('Use a standard [mcp_servers.NAME] table for this server, or choose a new --name. No settings were changed.');
  }

  let content = source;
  for (const table of tables.toSorted((left, right) => right.range[0] - left.range[0])) {
    content = content.slice(0, table.range[0]) + content.slice(table.range[1]);
  }
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const section = [`[mcp_servers.${name}]`, `url = ${JSON.stringify(entry.url)}`, ...(entry.bearer_token_env_var ? ['bearer_token_env_var = "MACHINAL_API_KEY"'] : []), ''].join(eol);
  content += (content ? `${eol}${eol}` : '') + section;

  let updated;
  try {
    updated = parseConfigTOML(content).value;
  } catch {
    throw new InstallerError('Cannot safely edit inline or dotted MCP tables. Use standard [mcp_servers.NAME] tables, or a new configuration. No settings were changed.');
  }
  if (!isDeepStrictEqual(withoutServer(value, name), withoutServer(updated, name))) {
    throw new InstallerError('Could not preserve unrelated Codex settings. The configuration was left unchanged.');
  }

  return { content: bom + content, conflict: current !== undefined };
}
