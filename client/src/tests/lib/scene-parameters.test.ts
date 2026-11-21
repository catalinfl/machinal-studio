import { describe, expect, it } from 'vitest'
import { validateSceneParameters } from '../../lib/scene-parameters'

describe('scene parameter validation', () => {
  it('accepts bounded object values including explicit zero', () => {
    expect(() => validateSceneParameters({ receiver: { x: 0, y: 120, opacity: 0, delay: 0, color: '#ff9900' } })).not.toThrow()
    expect(() => validateSceneParameters(undefined)).not.toThrow()
  })
  it('rejects malformed, unrecognized and unbounded data', () => {
    for (const value of [null, [], { actor: { opacity: 3 } }, { actor: { x: Infinity } }, { actor: { color: 'url(x)' } }, { actor: { constructor: 1 } }, { actor: { x: null } }]) expect(() => validateSceneParameters(value)).toThrow()
  })
})
