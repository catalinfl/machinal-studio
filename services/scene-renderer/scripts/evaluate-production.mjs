import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const judgments = new Set(['met', 'not_met', 'unverified']);
const metricKeys = ['elapsedSeconds', 'repairCount', 'sceneRenderCredits', 'renderCredits', 'aiCredits'];
const versionPattern = /^sha256:[a-f0-9]{64}$/;

export function validateEvaluation(manifest, run) {
  if (run.version !== 1 || !Array.isArray(run.cases) || run.cases.length !== manifest.cases.length) throw new Error('A run must contain every benchmark case exactly once');
  const seen = new Set();
  for (const result of run.cases) {
    const brief = manifest.cases.find(item => item.id === result.id);
    if (!brief || seen.has(result.id) || result.briefVersion !== brief.version) throw new Error(`Unknown, duplicate or stale benchmark case: ${result.id}`);
    seen.add(result.id);
    if (!versionPattern.test(result.compositionVersion) || !Array.isArray(result.sourceVersions) || result.sourceVersions.length === 0 || result.sourceVersions.some(version => !versionPattern.test(version))) throw new Error(`${result.id}: pin recipe and source versions`);
    if (!result.criteria || Object.keys(result.criteria).length !== manifest.criteria.length) throw new Error(`${result.id}: report all rubric dimensions`);
    for (const key of manifest.criteria) {
      const judgment = result.criteria[key];
      if (!judgment || !judgments.has(judgment.status) || typeof judgment.evidence !== 'string' || judgment.evidence.length > 2000 || judgment.status !== 'unverified' && !judgment.evidence.trim()) throw new Error(`${result.id}: ${key} needs an explicit judgment and timestamped evidence`);
    }
    if (!['passed', 'failed', 'unverified'].includes(result.technical)) throw new Error(`${result.id}: technical checks must be explicit`);
    for (const key of metricKeys) {
      const value = result.metrics?.[key];
      if (value !== null && (!Number.isFinite(value) || value < 0 || key === 'repairCount' && !Number.isInteger(value))) throw new Error(`${result.id}: invalid metric ${key}; use null for unmeasured values`);
    }
  }
}

export function compareEvaluations(manifest, baseline, candidate) {
  validateEvaluation(manifest, baseline);
  validateEvaluation(manifest, candidate);
  return {
    version: 1,
    evidence: 'reviewer-supplied judgments; this comparator does not inspect pixels, motion or audio',
    cases: manifest.cases.map(brief => {
      const before = baseline.cases.find(item => item.id === brief.id);
      const after = candidate.cases.find(item => item.id === brief.id);
      const metrics = Object.fromEntries(metricKeys.map(key => [key, before.metrics[key] === null || after.metrics[key] === null ? null : after.metrics[key] - before.metrics[key]]));
      return { id: brief.id, technical: { before: before.technical, after: after.technical }, criteria: manifest.criteria.map(key => ({ key, before: before.criteria[key], after: after.criteria[key] })), metricDeltas: metrics };
    }),
  };
}

async function main(args) {
  if (args.length !== 2) throw new Error('Usage: node scripts/evaluate-production.mjs BASELINE.json CANDIDATE.json');
  const manifest = JSON.parse(await readFile(new URL('../evaluation/briefs.json', import.meta.url), 'utf8'));
  const [baseline, candidate] = await Promise.all(args.map(async path => JSON.parse(await readFile(resolve(path), 'utf8'))));
  console.log(JSON.stringify(compareEvaluations(manifest, baseline, candidate), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
