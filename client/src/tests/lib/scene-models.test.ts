import { expect, it } from 'vitest'
import { validateEmbeddedSceneModels } from '../../lib/scene-models'

function modelSource() {
  const bytes = new Uint8Array(32)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, bytes.length, true)
  return 'data:model/gltf-binary;base64,' + btoa(String.fromCharCode(...bytes))
}

it('accepts bounded GLB transport headers without inventing remote asset requests', () => {
  expect(() => validateEmbeddedSceneModels(undefined)).not.toThrow()
  expect(() => validateEmbeddedSceneModels({model_1:modelSource(),model_2:modelSource()})).not.toThrow()
})

it('rejects malformed, oversized, unrecognized or remote model attachments', () => {
  for (const models of [null, [], {model_3:modelSource()}, {model_1:'https://example.invalid/a.glb'},
    {model_1:'data:model/gltf-binary;base64,'}, {model_1:'data:model/gltf-binary;base64,@@@@'},
    {model_1:'data:model/gltf-binary;base64,' + 'A'.repeat(6_000_000)}, {model_1:'data:model/gltf-binary;base64,' + btoa('not a GLB'.repeat(5))}]) {
    expect(() => validateEmbeddedSceneModels(models)).toThrow()
  }
})
