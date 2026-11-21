import type { Report, Result, Sample } from './parity'

const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

function frameHTML(result: Result, sample: Sample): string {
  const images = (['pixi', 'ffmpeg', 'difference', 'overlay'] as const).map(kind => `
    <figure>
      <img loading="lazy" width="160" height="90" src="${escape(sample[kind])}" alt="${kind} ${escape(result.id)} at ${sample.time}s">
      <figcaption>${kind}${kind === 'difference' ? ' ×4' : ''}</figcaption>
    </figure>`)
  return `<p>${sample.time}s · MAE ${sample.mae.toFixed(2)} · changed ${sample.changedPercent.toFixed(1)}%</p><div class="frames">${images.join('')}</div>`
}

function resultHTML(result: Result): string {
  const worst = result.samples.length ? Math.max(...result.samples.map(sample => sample.mae)).toFixed(2) : 'unavailable'
  const notes = [...result.notes]
  if (result.error) notes.push(result.error.split('\n').filter(line => /error|failed|match|Index expression/i.test(line)).slice(0, 3).join('\n'))
  const debug = { graph: result.graph, params: result.params, notes: result.notes, error: result.error, plans: result.plans }
  return `<details>
    <summary>${escape(result.id)} / ${result.variant} — ${result.status} · MAE ${worst}</summary>
    ${notes.map(note => `<p>${escape(note)}</p>`).join('')}
    ${result.samples.map(sample => frameHTML(result, sample)).join('')}
    <details><summary>Filtergraph, parameters and shader plans</summary><pre>${escape(JSON.stringify(debug, null, 2))}</pre></details>
  </details>`
}

export function reportHTML(report: Report, stylesheet: string): string {
  const score = (result: Result) => result.status === 'error' ? Infinity : Math.max(0, ...result.samples.map(sample => sample.mae))
  const sections = [...report.results].sort((a, b) => score(b) - score(a)).map(resultHTML)
  return `<!doctype html>
  <html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Measured effect parity</title><link rel="stylesheet" href="${escape(stylesheet)}">
  <main><h1>Measured preview / render differences</h1>
  <p>${escape(report.date)} · ${report.results.length} cases. Largest errors first. MAE is RGB error 0–255, not a perceptual quality score. Partial cases do not validate editor temporal behavior.</p>
  <p>${escape(report.fixture)}</p>
  <p>${escape(report.ffmpegVersion)}. This is WASM kernel coverage, not native export certification.</p>
  ${sections.join('')}</main></html>`
}
