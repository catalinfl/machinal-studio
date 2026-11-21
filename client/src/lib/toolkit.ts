import { stringify } from 'yaml'
import { CATALOG_EFFECTS, CATALOG_LOOKS, CATALOG_MOTIONS, CATALOG_TEXT_PRESETS, CATALOG_TRANSITIONS } from './edit-catalog'
import type { EffectParameterDef } from './effects'

export type ToolkitKind = 'styles' | 'effects' | 'transitions' | 'motion' | 'text'
export type ToolkitEntry = { id: string; label: string; category: string; description: string; kind: ToolkitKind; parameters?: EffectParameterDef[] }

export const toolkitEntries: ToolkitEntry[] = [
  ...CATALOG_LOOKS.map(entry => ({ ...entry, kind: 'styles' as const })),
  ...CATALOG_EFFECTS.map(entry => ({ ...entry, description: entry.summary, kind: 'effects' as const })),
  ...CATALOG_TRANSITIONS.map(entry => ({ ...entry, description: entry.summary, kind: 'transitions' as const })),
  ...CATALOG_MOTIONS.map(entry => ({ ...entry, category: 'Movement', description: entry.hint, kind: 'motion' as const })),
  ...CATALOG_TEXT_PRESETS.map(entry => ({ ...entry, category: 'isCaption' in entry.values && entry.values.isCaption ? 'Captions' : 'Titles & text', kind: 'text' as const })),
]

export const toolkitKinds: { id: ToolkitKind; label: string; count: number }[] = [
  { id: 'styles', label: 'Styles', count: CATALOG_LOOKS.length },
  { id: 'effects', label: 'Effects', count: CATALOG_EFFECTS.length },
  { id: 'transitions', label: 'Transitions', count: CATALOG_TRANSITIONS.length },
  { id: 'motion', label: 'Motion', count: CATALOG_MOTIONS.length },
  { id: 'text', label: 'Text', count: CATALOG_TEXT_PRESETS.length },
]

export function filterToolkit(kind: ToolkitKind, query: string, category: string): ToolkitEntry[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  return toolkitEntries.filter(entry => entry.kind === kind && (!category || entry.category === category)
    && terms.every(term => `${entry.label} ${entry.description} ${entry.category} ${entry.id}`.toLowerCase().includes(term)))
}

export function toolkitRecipe(entry: ToolkitEntry): string {
  if (entry.kind === 'transitions') return stringify({ version: 1, mode: 'modify', commands: [{ type: 'transition.set', target: { kind: 'transition', position: 'all' }, preset: entry.id }] })
  if (entry.kind === 'text') return stringify({ version: 1, mode: 'modify', texts: [{ id: 'your-title', text: 'Your next story starts here.', start: 0, duration: 3, preset: entry.id }] })
  const apply = entry.kind === 'styles' ? { look: entry.id } : entry.kind === 'motion' ? { motion: entry.id } : { effect: { preset: entry.id } }
  return stringify({ version: 2, mode: 'modify', rules: [{ id: `your-${entry.kind}`, target: { kind: 'video', position: 'all' }, apply }] })
}
