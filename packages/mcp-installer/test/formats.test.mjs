import assert from 'node:assert/strict';
import test from 'node:test';
import { parse } from 'jsonc-parser';
import { getStaticTOMLValue, parseTOML } from 'toml-eslint-parser';
import { serverEntry, updateJSON, updateTOML } from '../src/formats.mjs';

const URL = 'https://api.example.com/mcp';
const tomlValue = (source) => getStaticTOMLValue(parseTOML(source));

test('OpenCode V2 uses remote, oauth:false, and an environment reference', () => {
  const entry = serverEntry('opencode', URL);
  const result = updateJSON('', 'opencode', 'machinal', entry);
  const value = parse(result.content);
  assert.deepEqual(value.mcp.servers.machinal, entry);
  assert.equal(value.$schema, 'https://opencode.ai/config.json');
  assert.equal(result.conflict, false);
});

test('machinal setup removes its same-endpoint legacy MCP alias without changing unrelated servers', () => {
  const entry = serverEntry('opencode', URL);
  const source = JSON.stringify({ mcp: { servers: { directional: entry, docs: { type: 'remote', url: 'https://docs.example/mcp' } } } });
  const result = updateJSON(source, 'opencode', 'machinal', entry);
  const config = parse(result.content);
  assert.equal(config.mcp.servers.directional, undefined);
  assert.deepEqual(config.mcp.servers.machinal, entry);
  assert.equal(config.mcp.servers.docs.url, 'https://docs.example/mcp');
  assert.equal(updateJSON(result.content, 'opencode', 'machinal', entry).content, result.content);
  const other = JSON.stringify({ mcp: { servers: { directional: { ...entry, url: 'https://different.example/mcp' } } } });
  assert.equal(parse(updateJSON(other, 'opencode', 'machinal', entry).content).mcp.servers.directional.url, 'https://different.example/mcp');
});

test('JSONC comments, trailing commas, CRLF, and other settings survive editing', () => {
  const original = '{\r\n  // Keep this comment\r\n  "model": "my/model",\r\n  "mcp": { "timeout": {"startup": 40000}, "servers": {"docs": {"type": "remote", "url": "https://docs.example/mcp"}} },\r\n}\r\n';
  const result = updateJSON(original, 'opencode', 'machinal', serverEntry('opencode', URL));
  assert.ok(result.content.includes('// Keep this comment\r\n'));
  const before = parse(original);
  const after = parse(result.content);
  assert.equal(after.model, before.model);
  assert.deepEqual(after.mcp.timeout, before.mcp.timeout);
  assert.deepEqual(after.mcp.servers.docs, before.mcp.servers.docs);
  assert.ok(!/(?<!\r)\n/.test(result.content));
});

test('Claude preserves other settings and uses its literal environment syntax', () => {
  const result = updateJSON('{"theme":"dark","mcpServers":{"other":{"command":"example"}}}', 'claude', 'machinal', serverEntry('claude', URL));
  const value = JSON.parse(result.content);
  assert.equal(value.theme, 'dark');
  assert.deepEqual(value.mcpServers.other, { command: 'example' });
  assert.equal(value.mcpServers.machinal.headers.Authorization, 'Bearer ${MACHINAL_API_KEY}');
});

test('JSON setup is idempotent and flags only changed existing servers as conflicts', () => {
  const entry = serverEntry('opencode', URL);
  const first = updateJSON('', 'opencode', 'machinal', entry);
  assert.deepEqual(updateJSON(first.content, 'opencode', 'machinal', entry), { content: first.content, conflict: false });
  const updated = updateJSON(first.content, 'opencode', 'machinal', serverEntry('opencode', 'https://other.example/mcp'));
  assert.equal(updated.conflict, true);
});

test('BOM and indentation are retained', () => {
  const source = '\uFEFF{\n\t"model": "example"\n}\n';
  const result = updateJSON(source, 'opencode', 'machinal', serverEntry('opencode', URL));
  assert.ok(result.content.startsWith('\uFEFF'));
  assert.ok(result.content.includes('\n\t"mcp"'));
});

for (const source of ['[]', '{"mcp":false}', '{"mcp":{"servers":[]}}', '{broken', '{"model":"a","model":"b"}']) {
  test(`unsafe JSON is refused without exposing its contents: ${source}`, () => {
    assert.throws(() => updateJSON(source, 'opencode', 'machinal', serverEntry('opencode', URL)));
  });
}

test('Claude does not silently accept JSONC', () => {
  assert.throws(() => updateJSON('{/* comment */ "mcpServers":{}}', 'claude', 'machinal', serverEntry('claude', URL)));
});

test('OpenCode V1 settings are not silently mixed with V2', () => {
  assert.throws(() => updateJSON('{"mcp":{"existing":{"type":"remote","url":"https://example.com"}}}', 'opencode', 'machinal', serverEntry('opencode', URL)), /V1/);
});

test('Codex appends a standard table while retaining comments and all other bytes', () => {
  const source = '# Keep this comment\r\nmodel = "example"\r\n\r\n[mcp_servers.docs]\r\ncommand = "docs-server"\r\n';
  const result = updateTOML(source, 'machinal', serverEntry('codex', URL));
  assert.ok(result.content.startsWith(source));
  assert.equal(result.conflict, false);
  assert.deepEqual(tomlValue(result.content).mcp_servers.machinal, serverEntry('codex', URL));
  assert.ok(!/(?<!\r)\n/.test(result.content));
});

test('Codex repeated setup does not change bytes or report a conflict', () => {
  const first = updateTOML('', 'machinal', serverEntry('codex', URL));
  assert.deepEqual(updateTOML(first.content, 'machinal', serverEntry('codex', URL)), { content: first.content, conflict: false });
});

test('Codex replacement removes old nested server fields but preserves other tables', () => {
  const source = '# User preferences\nmodel = "example"\n[mcp_servers."machinal"] # old transport\ncommand = "old"\n[mcp_servers.machinal.env]\nOLD = "value"\n# Keep docs\n[mcp_servers.docs]\nurl = "https://docs.example/mcp"\n[profiles.quick]\nmodel = "small"\n';
  const result = updateTOML(source, 'machinal', serverEntry('codex', URL));
  assert.equal(result.conflict, true);
  const value = tomlValue(result.content);
  assert.deepEqual(value.mcp_servers.machinal, serverEntry('codex', URL));
  assert.equal(value.mcp_servers.docs.url, 'https://docs.example/mcp');
  assert.equal(value.profiles.quick.model, 'small');
  assert.ok(result.content.includes('# Keep docs'));
});

test('TOML-looking headers inside multiline strings are not treated as tables', () => {
  const source = 'instructions = """\n[mcp_servers.machinal]\nnot a real table\n"""\n';
  const result = updateTOML(source, 'machinal', serverEntry('codex', URL));
  assert.equal(tomlValue(result.content).instructions, tomlValue(source).instructions);
});

test('Codex safely refuses unsupported inline/dotted replacement and malformed TOML', () => {
  for (const source of ['mcp_servers = { machinal = { url = "old" } }', 'mcp_servers.machinal.url = "old"', 'model = "unterminated', 'mcp_servers = 123']) {
    assert.throws(() => updateTOML(source, 'machinal', serverEntry('codex', URL)));
  }
});

test('Codex protects an unrelated inline MCP table instead of producing invalid TOML', () => {
  assert.throws(() => updateTOML('mcp_servers = { docs = { command = "docs" } }', 'machinal', serverEntry('codex', URL)), /safely edit/);
});
