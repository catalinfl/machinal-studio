import { describe, expect, it } from 'vitest'
import { AUTOMATION_GUIDES, DOCS_FAQ, PRODUCT_GUIDES } from '../../lib/docs-content'

describe('customer documentation', () => {
  it('describes credit charges without revealing AI suppliers or internal conversion rules', () => {
    const pricing = AUTOMATION_GUIDES.find(section => section.id === 'pricing')!
    const copy = [...pricing.paragraphs, ...pricing.facts!].join(' ')

    expect(copy).toContain('AI tools consume credits')
    expect(copy).toContain('final usage is confirmed after processing')
    expect(copy).toContain('Rendering is charged per output minute')
    expect(copy).toContain('amount owed must be covered')
    expect(copy).not.toMatch(/openrouter|provider|upstream|supplier|markup|30%|0\.3\b|3\.33/i)
    expect(copy).not.toMatch(/temporarily reserves|hold it at a time/)
  })

  it('keeps the public guides and FAQs free of the internal AI service name', () => {
    expect(JSON.stringify([PRODUCT_GUIDES, AUTOMATION_GUIDES, DOCS_FAQ])).not.toMatch(/openrouter|jev/i)
    expect(DOCS_FAQ.find(item => item.question === 'Do failed or cancelled jobs cost credits?')?.answer).toContain('credit charges may still be pending')
  })
})
