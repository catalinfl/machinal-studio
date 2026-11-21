import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/svelte'
import { tick } from 'svelte'
import EditorPageHarness from './EditorPageHarness.svelte'
import type { useEditorPage } from '../../composables/useEditorPage.svelte'

vi.mock('../../lib/session', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/session')>(),
  startProjectSession: () => () => {},
}))

vi.mock('../../lib/compositions', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/compositions')>(),
  startDocumentSync: () => () => {},
}))

function mountPage() {
  let page!: ReturnType<typeof useEditorPage>
  render(EditorPageHarness, { onReady: (value) => { page = value } })
  return page
}

describe('editor panel selection', () => {
  it('keeps free panels mutually exclusive', async () => {
    const page = mountPage()
    page.toggleEffects()
    await tick()
    expect(page.showEffects).toBe(true)
    expect(page.showMediaBin).toBe(false)
    page.toggleText()
    await tick()
    expect(page.showText).toBe(true)
    expect(page.showEffects).toBe(false)
    expect(page.activePanel).toBe('text')
  })

  it('closes the text panel when opening the clip inspector', async () => {
    const page = mountPage()
    page.toggleText()
    await tick()
    page.openClipInspector()
    await tick()
    expect(page.showText).toBe(false)
    expect(page.mobilePanelOpen).toBe(false)
  })

  it('keeps panel coordinates independent from panel selection', async () => {
    const page = mountPage()
    page.aiPanelX = 120
    page.aiPanelY = 80
    page.toggleTransitions()
    await tick()
    expect(page.showTransitions).toBe(true)
    expect(page.aiPanelX).toBe(120)
    expect(page.aiPanelY).toBe(80)
  })

  it('restores the workspace when the current library is selected from an expanded preview', async () => {
    const page = mountPage()
    page.toggleWorkspaceFocus('preview')
    await tick()
    expect(page.workspaceFocus).toBe('preview')
    page.selectPanel('media')
    await tick()
    expect(page.workspaceFocus).toBe('balanced')
    expect(page.showMediaBin).toBe(true)
  })

  it('keeps preview and timeline expansion mutually exclusive without inventing an active panel', async () => {
    const page = mountPage()
    page.closeMobilePanel()
    await tick()
    expect(page.activePanel).toBeNull()
    page.toggleWorkspaceFocus('preview')
    await tick()
    expect(page.workspaceFocus).toBe('preview')
    page.toggleWorkspaceFocus('timeline')
    await tick()
    expect(page.workspaceFocus).toBe('timeline')
    page.toggleWorkspaceFocus('timeline')
    await tick()
    expect(page.workspaceFocus).toBe('balanced')
    expect(page.activePanel).toBeNull()
  })
})
