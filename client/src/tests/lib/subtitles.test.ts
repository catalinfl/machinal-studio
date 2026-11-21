import { describe, expect, it } from 'vitest'
import { captionWordsForText, formatCaptionTime, groupCaptionCuesByWords, parseSRT, scaleCaptionWords, splitCaptionCueByWords, wrapSubtitleText } from '../../lib/subtitles'

describe('subtitles', () => {
  it('parses CRLF cues, multiline text, and comma timestamps', () => {
    const cues = parseSRT('\uFEFF1\r\n00:00:01,250 --> 00:00:03,500\r\nFirst line\r\nSecond line\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,125\r\nLast cue\r\n')

    expect(cues).toEqual([
      { start: 1.25, end: 3.5, text: 'First line\nSecond line' },
      { start: 4, end: 5.125, text: 'Last cue' },
    ])
  })

  it('ignores malformed ranges and sorts valid cues', () => {
    const cues = parseSRT(`2
00:00:04.000 --> 00:00:05.000
Later

bad
not a timestamp
Ignored

1
00:00:01.000 --> 00:00:02.000
Earlier`)

    expect(cues.map((cue) => cue.text)).toEqual(['Earlier', 'Later'])
  })

  it('wraps captions without dropping words', () => {
    expect(wrapSubtitleText('one two three four five', 10)).toBe('one two\nthree four\nfive')
  })

  it('splits a cue into the selected number of words while preserving timing', () => {
    const chunks = splitCaptionCueByWords({
      start: 1,
      end: 3,
      text: 'one two three four five',
      words: [
        { text: 'one', start: 1, end: 1.3 },
        { text: 'two', start: 1.3, end: 1.7 },
        { text: 'three', start: 1.7, end: 2.1 },
        { text: 'four', start: 2.1, end: 2.5 },
        { text: 'five', start: 2.5, end: 3 },
      ],
    }, 2)

    expect(chunks.map((chunk) => chunk.text)).toEqual(['one two', 'three four', 'five'])
    expect(chunks[1]).toMatchObject({ start: 1.7, end: 2.5 })
  })

  it('preserves phrase timings when the transcript has no measured word timestamps', () => {
    expect(splitCaptionCueByWords({ start: 2, end: 6, text: 'one two three four' }, 2)).toEqual([
      {
        start: 2,
        end: 6,
        text: 'one two three four',
      },
    ])
  })

  it('does not highlight provider phrases as if they were individual words', () => {
    const cue = { start: 0, end: 2, text: 'își petrece copilăria', words: [
      { text: 'își petrece', start: 0, end: 0.8 },
      { text: 'copilăria', start: 0.8, end: 1.3 },
      { text: '.', start: 1.3, end: 2 },
    ] }
    expect(splitCaptionCueByWords(cue, 1)).toEqual([{ ...cue, words: [] }])
    expect(captionWordsForText(cue.text, 2, cue.words)).toEqual([])
  })

  it('groups single-word server cues using the client word count', () => {
    const cues = groupCaptionCuesByWords([
      { start: 0, end: 0.4, text: 'one', words: [{ text: 'one', start: 0, end: 0.4 }] },
      { start: 0.5, end: 0.9, text: 'two', words: [{ text: 'two', start: 0.5, end: 0.9 }] },
      { start: 1, end: 1.4, text: 'three', words: [{ text: 'three', start: 1, end: 1.4 }] },
      { start: 1.5, end: 1.9, text: 'four', words: [{ text: 'four', start: 1.5, end: 1.9 }] },
      { start: 2, end: 2.4, text: 'five', words: [{ text: 'five', start: 2, end: 2.4 }] },
    ], 4)

    expect(cues.map((cue) => cue.text)).toEqual(['one two three four', 'five'])
    expect(cues[0]).toMatchObject({ start: 0, end: 1.9 })
    expect(cues[0].words).toHaveLength(4)
  })

  it('preserves same-length spelling corrections but clears unverified structural timings', () => {
    const words = [
      { text: 'one', start: 0, end: 0.4 },
      { text: 'two', start: 0.5, end: 1 },
    ]
    expect(captionWordsForText('ONE TWO', 1, words)).toEqual([
      { text: 'ONE', start: 0, end: 0.4 },
      { text: 'TWO', start: 0.5, end: 1 },
    ])
    expect(captionWordsForText('one new two', 1, words)).toEqual([])
    expect(scaleCaptionWords(words, 1, 2)[1]).toEqual({ text: 'two', start: 1, end: 2 })
    expect(formatCaptionTime(65.432)).toBe('00:01:05.432')
  })
})
