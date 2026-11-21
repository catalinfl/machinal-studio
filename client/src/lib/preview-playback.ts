interface PlaybackVoice {
  element: HTMLVideoElement
  isAudio: boolean
}

interface AudioSettings {
  muted: boolean
  volume: number
}

const CHANNEL_FADE_SECONDS = 0.02
const EXIT_FADE_SECONDS = 0.04
const MASTER_FADE_SECONDS = 0.03

export class PreviewPlayback {
  readonly voices = new Map<string, PlaybackVoice>()
  private context: AudioContext | null = null
  private masterGain: GainNode | null = null
  private ready = false
  private readonly nodes = new Map<string, { source: MediaElementAudioSourceNode; gain: GainNode }>()
  private readonly playing = new Map<string, boolean>()
  private readonly desired = new Map<string, boolean>()
  private readonly pending = new Map<string, HTMLVideoElement>()

  constructor(private readonly settings: () => AudioSettings) {}

  ensureAudio() {
    if (this.context) return
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    try {
      this.context = new Ctor({ latencyHint: 'interactive' })
      this.masterGain = this.context.createGain()
      const { muted, volume } = this.settings()
      this.masterGain.gain.value = muted ? 0 : volume / 100
      this.masterGain.connect(this.context.destination)
    } catch {
      this.context = null
      this.masterGain = null
    }
  }

  async resume(): Promise<void> {
    if (!this.context) return
    try {
      await this.context.resume()
      if (this.context?.state === 'running') this.ready = true
    } catch {
      // Browsers can refuse audio until a user gesture.
    }
  }

  register(key: string, element: HTMLVideoElement, isAudio: boolean) {
    this.voices.set(key, { element, isAudio })
  }

  release(key: string, element: HTMLVideoElement) {
    if (this.voices.get(key)?.element !== element) return
    this.desired.set(key, false)
    try { element.pause() } catch {}
    const node = this.nodes.get(key)
    if (node) {
      try { node.source.disconnect() } catch {}
      try { node.gain.disconnect() } catch {}
    }
    this.voices.delete(key)
    this.nodes.delete(key)
    this.playing.delete(key)
    this.desired.delete(key)
    this.pending.delete(key)
  }

  private ensureGraph(key: string, element: HTMLVideoElement) {
    if (!this.context || !this.masterGain || !this.ready || this.nodes.has(key)) return
    try {
      const source = this.context.createMediaElementSource(element)
      const gain = this.context.createGain()
      gain.gain.value = 0
      source.connect(gain).connect(this.masterGain)
      this.nodes.set(key, { source, gain })
    } catch {
      // An already-connected element falls back to direct element audio.
    }
  }

  private ramp(param: AudioParam, target: number, seconds: number) {
    if (!this.context || Math.abs(param.value - target) < 1e-4) return
    const time = this.context.currentTime
    param.cancelScheduledValues(time)
    param.setValueAtTime(param.value, time)
    param.linearRampToValueAtTime(target, time + seconds)
  }

  sync(key: string, element: HTMLVideoElement, targetTime: number, playing: boolean, rate: number, fps: number) {
    if (element.playbackRate !== rate) element.playbackRate = rate
    if (element.defaultPlaybackRate !== rate) element.defaultPlaybackRate = rate
    const tolerance = (playing ? 0.2 : 0.25 / fps) * rate
    if (!element.seeking && Number.isFinite(element.currentTime) && Math.abs(element.currentTime - targetTime) > tolerance) {
      try { element.currentTime = targetTime } catch {}
    }
    this.desired.set(key, playing)
    const wasPlaying = this.playing.get(key) ?? false
    if (playing && !wasPlaying && !this.pending.has(key)) this.play(key, element)
    else if (!playing && (wasPlaying || this.pending.has(key))) {
      try { element.pause() } catch {}
      this.playing.set(key, false)
    }
  }

  private play(key: string, element: HTMLVideoElement) {
    try {
      const promise = element.play()
      if (!promise || typeof promise.then !== 'function') {
        this.playing.set(key, true)
        return
      }
      this.pending.set(key, element)
      promise.then(() => {
        if (this.pending.get(key) === element) this.pending.delete(key)
        if (this.voices.get(key)?.element === element && this.desired.get(key)) this.playing.set(key, true)
        else { try { element.pause() } catch {} }
      }).catch(() => {
        if (this.pending.get(key) === element) this.pending.delete(key)
        if (this.voices.get(key)?.element === element) this.playing.set(key, false)
      })
    } catch {
      this.pending.delete(key)
      this.playing.set(key, false)
    }
  }

  setGain(key: string, element: HTMLVideoElement, isAudio: boolean, muted: boolean, gain: number) {
    if (isAudio) this.ensureGraph(key, element)
    const node = this.nodes.get(key)
    if (this.ready && isAudio && node) {
      element.muted = false
      element.volume = 1
      this.ramp(node.gain.gain, muted ? 0 : gain, CHANNEL_FADE_SECONDS)
    } else {
      element.muted = muted
      if (isAudio) element.volume = muted ? 0 : Math.max(0, Math.min(1, gain))
    }
  }

  stopInactive(active: ReadonlySet<string>) {
    for (const [key, { element, isAudio }] of this.voices) {
      if (active.has(key)) continue
      this.desired.set(key, false)
      if (this.playing.get(key) || this.pending.has(key)) {
        const node = this.nodes.get(key)
        if (this.ready && isAudio && node) this.ramp(node.gain.gain, 0, EXIT_FADE_SECONDS)
        try { element.pause() } catch {}
        this.playing.set(key, false)
      }
      element.muted = !isAudio
    }
  }

  updateVolume() {
    const { muted, volume } = this.settings()
    if (this.masterGain) this.ramp(this.masterGain.gain, muted ? 0 : volume / 100, MASTER_FADE_SECONDS)
    if (!this.ready) {
      for (const { element, isAudio } of this.voices.values()) {
        element.volume = isAudio ? volume / 100 : 1
        element.muted = isAudio ? muted : true
      }
    }
  }

  dispose() {
    for (const [key, voice] of this.voices) this.release(key, voice.element)
    if (this.context) {
      try { void this.context.close().catch(() => {}) } catch {}
    }
    this.context = null
    this.masterGain = null
    this.ready = false
  }
}
