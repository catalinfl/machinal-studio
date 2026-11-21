import assert from 'node:assert/strict';
import test from 'node:test';
import { backupSummary, createLogger } from '../src/presentation.mjs';

test('backup details are one bounded message rather than a line per skill', () => {
  const backups = Array.from({ length: 80 }, (_, i) => `/skills/file${i}.machinal-backup-123`);
  const summary = backupSummary({ backup: '/project/config.machinal-backup-123' }, { backups }, '/project/skills');
  assert.match(summary, /Backups: 81 original files/);
  assert.match(summary, /Skills: 80 files under \/project\/skills/);
  assert.match(summary, /<filename>.machinal-backup/);
  assert.match(summary, /restore by copying/);
  assert.ok(!summary.includes('\n'));
  assert.ok(summary.length < 700);
  assert.equal(backupSummary({}, { backups: [] }), null);
});

test('piped output, NO_COLOR and dumb terminals remain plain', () => {
  for (const options of [
    { stream: { isTTY: false }, env: {} },
    { stream: { isTTY: true }, env: { NO_COLOR: '' } },
    { stream: { isTTY: true }, env: { TERM: 'dumb' } },
  ]) {
    const logs = [];
    const log = createLogger({ ...options, write: (value) => logs.push(value) });
    log('Configured: ready');
    log('Warning: unavailable');
    log('Problem', 'error');
    assert.ok(logs.every((line) => !line.includes('\x1b')));
  }
});

test('routine output stays neutral; only warning and error labels use semantic color', () => {
  const logs = [];
  const log = createLogger({ stream: { isTTY: true }, env: {}, write: (value) => logs.push(value) });
  for (const message of ['Configured: ready', 'Backups: 4', 'Mode: local', 'Checking MCP']) log(message);
  log('Warning: unavailable');
  log('Low balance: 20 credits');
  log('Problem', 'error');
  assert.deepEqual(logs.slice(0, 4), ['Configured: ready', 'Backups: 4', 'Mode: local', 'Checking MCP']);
  assert.equal(logs[4], '\x1b[33mWarning:\x1b[39m unavailable');
  assert.equal(logs[5], '\x1b[33mLow balance:\x1b[39m 20 credits');
  assert.equal(logs[6], '\x1b[31mError:\x1b[39m Problem');
  assert.ok(logs.every((line) => !/\x1b\[(32|35|36)m/.test(line)));
});

test('section hierarchy uses whitespace and weight, not extra accent colors', () => {
  const logs = [];
  createLogger({ stream: { isTTY: true }, env: {}, write: (line) => logs.push(line) })('Setup ready', 'heading');
  assert.equal(logs[0], '\n\x1b[1mSetup ready\x1b[22m');
});
