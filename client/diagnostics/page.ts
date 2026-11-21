import { EFFECTS } from '../src/lib/effects'
import { runParity, type Report, type Result } from './parity'

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const select = element<HTMLSelectElement>('effect')
const status = element('status')
const results = element('results')
const run = element<HTMLButtonElement>('run')
const stop = element<HTMLButtonElement>('stop')
const download = element<HTMLButtonElement>('download')
let report: Report | undefined
let controller: AbortController | undefined

for (const effect of EFFECTS) select.add(new Option(`${effect.kind} · ${effect.label}`, effect.id))

function append(result: Result) {
  const details = document.createElement('details')
  const summary = document.createElement('summary')
  const worst = result.samples.length ? Math.max(...result.samples.map(sample => sample.mae)).toFixed(2) : 'unavailable'
  summary.textContent = `${result.id} / ${result.variant} — ${result.status}; worst MAE ${worst}`
  details.append(summary)
  if (result.status === 'error') details.className = 'error'
  for (const note of [...result.notes, ...(result.error ? [result.error.split('\n').filter(line => /error|failed|match|Index expression/i.test(line)).slice(0, 3).join('\n')] : [])]) {
    const message = document.createElement('p')
    message.textContent = note
    details.append(message)
  }
  for (const sample of result.samples) {
    const caption = document.createElement('p')
    caption.textContent = `${sample.time.toFixed(2)}s · MAE ${sample.mae.toFixed(2)} · max ${sample.max} · changed ${sample.changedPercent.toFixed(1)}%`
    const frames = document.createElement('div')
    frames.className = 'frames'
    for (const [label, source] of [['Pixi preview', sample.pixi], ['FFmpeg render', sample.ffmpeg], ['Difference ×4', sample.difference], ['Overlay 50/50', sample.overlay]]) {
      const figure = document.createElement('figure')
      const image = document.createElement('img')
      image.src = source
      image.alt = `${result.id} at ${sample.time}s: ${label}`
      image.width = 160
      image.height = 90
      image.loading = 'lazy'
      const figcaption = document.createElement('figcaption')
      figcaption.textContent = label
      figure.append(image, figcaption)
      frames.append(figure)
    }
    details.append(caption, frames)
  }
  const debug = document.createElement('pre')
  debug.textContent = JSON.stringify({ params: result.params, graph: result.graph, notes: result.notes, error: result.error, plans: result.plans }, null, 2)
  const technical = document.createElement('details')
  const technicalSummary = document.createElement('summary')
  technicalSummary.textContent = 'Filtergraph, parameters and shader plans'
  technical.append(technicalSummary, debug)
  details.append(technical)
  results.append(details)
}

element<HTMLFormElement>('controls').onsubmit = async event => {
  event.preventDefault()
  controller = new AbortController()
  report = undefined
  results.replaceChildren()
  run.disabled = download.disabled = true
  stop.disabled = false
  status.textContent = 'Loading FFmpeg and initializing WebGL…'
  try {
    report = await runParity((result, done, total) => {
      append(result)
      status.textContent = `${done}/${total} · ${result.id}`
    }, { ids: select.value ? [select.value] : undefined, ramps: element<HTMLInputElement>('ramps').checked, signal: controller.signal })
    status.textContent = `${controller.signal.aborted ? 'Stopped' : 'Finished'}: ${report.results.length} cases; ${report.results.filter(result => result.status === 'error').length} errors; ${report.results.filter(result => result.status === 'partial').length} partial. Open a row to inspect frames.`
    download.disabled = false
  } catch (error) {
    status.textContent = `Comparison failed: ${String(error)}. Reload and retry.`
  } finally {
    run.disabled = false
    stop.disabled = true
  }
}
stop.onclick = () => { controller?.abort(); stop.disabled = true; status.textContent = 'Stopping after the current effect…' }
download.onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'effect-parity.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
