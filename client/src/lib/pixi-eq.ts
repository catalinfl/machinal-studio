export function eqUniforms(values: Record<string, number>): Record<string, number> {
  const contrast = Math.fround(values.uContrast ?? 1)
  const brightness = Math.fround(values.uBrightness ?? 0)
  const saturation = Math.fround(values.uSaturation ?? 1)
  const contrastQ = Math.trunc(contrast * 4096)
  const saturationQ = Math.trunc(saturation * 4096)
  return {
    uContrast: contrast, uBrightness: brightness, uSaturation: saturation,
    uGamma: Math.fround(values.uGamma ?? 1), uIntensity: values.uIntensity ?? 1,
    uContrastQ: contrastQ,
    uBrightnessQ: Math.trunc(Math.trunc(100 * brightness + 100) * 511 / 200) - 128 - Math.trunc(contrastQ / 32),
    uSaturationQ: saturationQ,
    uChromaBias: 127 - Math.trunc(saturationQ / 32),
    uOutputYuv: values.uOutputYuv ?? 0,
  }
}
