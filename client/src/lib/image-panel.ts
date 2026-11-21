export const IMAGE_STYLE_OPTIONS = [
  { value: 'auto', label: 'AI recommended', prompt: 'Choose and apply a coherent visual style that matches the subject and its role in a polished video edit' },
  { value: 'cinematic', label: 'Cinematic', prompt: 'cinematic editorial photography, controlled contrast, realistic light, refined color' },
  { value: 'graphic', label: 'Graphic cutout', prompt: 'bold editorial cutout, clean silhouette, restrained graphic detail' },
  { value: 'illustration', label: 'Illustrated', prompt: 'modern editorial illustration, tactile shapes, confident composition' },
  { value: 'product', label: 'Product', prompt: 'premium product photography, precise materials, clean commercial lighting' },
] as const

export type ImageStyle = (typeof IMAGE_STYLE_OPTIONS)[number]['value']
