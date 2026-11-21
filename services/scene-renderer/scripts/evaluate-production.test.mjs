import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compareEvaluations, validateEvaluation } from './evaluate-production.mjs';

const manifest = { criteria: ['meaningful_action'], cases: [{ id: 'process', version: 1 }] };
const version = 'sha256:'+'a'.repeat(64);
const run = () => ({ version: 1, cases: [{ id: 'process', briefVersion: 1, compositionVersion: version, sourceVersions: [version], technical: 'passed', criteria: { meaningful_action: { status: 'unverified', evidence: '' } }, metrics: { elapsedSeconds: 12, repairCount: 0, sceneRenderCredits: null, renderCredits: null, aiCredits: null } }] });

test('the tracked fixture catalog contains all eight production briefs and rubric dimensions', async () => {
  const catalog = JSON.parse(await readFile(new URL('../evaluation/briefs.json', import.meta.url),'utf8'));
  assert.equal(catalog.version,1);
  assert.equal(catalog.cases.length,8);
  assert.equal(new Set(catalog.cases.map(item => item.id)).size,8);
  assert.equal(catalog.criteria.length,5);
  assert.ok(catalog.cases.every(item => item.version === 1 && item.brief && item.observe.length > 0));
});

test('comparison keeps unknown evidence/costs unknown and has no fabricated beauty score', () => {
  const before = run(), after = run();
  after.cases[0].criteria.meaningful_action = { status: 'met', evidence: '00:03-00:05: job A moves to worker while B waits; reviewed preview revision pinned above' };
  after.cases[0].metrics.elapsedSeconds = 10;
  const result = compareEvaluations(manifest, before, after);
  assert.equal(result.cases[0].metricDeltas.elapsedSeconds, -2);
  assert.equal(result.cases[0].metricDeltas.aiCredits, null);
  assert.equal(result.cases[0].criteria[0].before.status, 'unverified');
  assert.equal(result.score, undefined);
});

test('incomplete, stale, unsupported or unsubstantiated results are rejected', () => {
  for (const mutate of [
    result => result.cases.push(result.cases[0]),
    result => { result.cases[0].briefVersion = 2; },
    result => { result.cases[0].compositionVersion = ''; },
    result => { result.cases[0].criteria.meaningful_action.status = 'met'; },
    result => { result.cases[0].metrics.aiCredits = -1; },
    result => { result.cases[0].metrics.repairCount = 1.5; },
  ]) {
    const result = run(); mutate(result);
    assert.throws(() => validateEvaluation(manifest, result));
  }
});
