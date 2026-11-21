export interface PreviewControlsOptions {
  getOnVolumeInput: () => (volume: number) => void
}

export function usePreviewControls(options: PreviewControlsOptions) {
  const onVolumeEvent = (event: Event): void => {
    options.getOnVolumeInput()(Number((event.target as HTMLInputElement).value))
  }
  return {
    onVolumeEvent,
  }
}
