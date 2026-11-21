import { mount } from 'svelte'
import NativePortPreview from './pages/NativePortPreview.svelte'

const params = new URLSearchParams(location.search)
const target = document.getElementById('preview')
if (!target) throw new Error('The preview target is missing.')

const numeric = (name: string) => {
  const value = Number(params.get(name))
  return Number.isFinite(value) && value > 0 ? value : undefined
}

mount(NativePortPreview, {
  target,
  props: {
    id: params.get('id') ?? '',
    aspect: params.get('aspect') === 'portrait' ? 'portrait' : 'landscape',
    time: Number(params.get('time') ?? '0'),
    scale: Number(params.get('scale') ?? '1'),
    width: numeric('width'),
    height: numeric('height'),
    includePending: params.get('includePending') === 'true',
  },
})
