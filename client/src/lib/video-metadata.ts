export interface VideoMetadata {
  duration: number
  width: number
  height: number
}

export interface AudioMetadata {
  duration: number
}

export interface ImageMetadata {
  width: number
  height: number
}

export async function readVideoMetadata(input: Blob): Promise<VideoMetadata> {
  const video = document.createElement('video')
  const objectUrl = URL.createObjectURL(input)

  try {
    return await new Promise<VideoMetadata>((resolve, reject) => {
      video.preload = 'metadata'
      video.onloadedmetadata = () => {
        const duration = Number.isFinite(video.duration) ? video.duration : 0
        if (video.videoWidth <= 0 || video.videoHeight <= 0) {
          reject(new Error('cannot determine video dimensions'))
          return
        }
        resolve({ duration, width: video.videoWidth, height: video.videoHeight })
      }
      video.onerror = () => reject(new Error('cannot read video metadata'))
      video.src = objectUrl
    })
  } finally {
    video.removeAttribute('src')
    video.load()
    video.remove()
    URL.revokeObjectURL(objectUrl)
  }
}

export async function readAudioMetadata(input: Blob): Promise<AudioMetadata> {
  const audio = document.createElement('audio')
  const objectUrl = URL.createObjectURL(input)

  try {
    return await new Promise<AudioMetadata>((resolve, reject) => {
      audio.preload = 'metadata'
      audio.onloadedmetadata = () => {
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0
        if (duration <= 0) {
          reject(new Error('cannot determine audio duration'))
          return
        }
        resolve({ duration })
      }
      audio.onerror = () => reject(new Error('cannot read audio metadata'))
      audio.src = objectUrl
    })
  } finally {
    audio.removeAttribute('src')
    audio.load()
    audio.remove()
    URL.revokeObjectURL(objectUrl)
  }
}

export async function readImageMetadata(input: Blob): Promise<ImageMetadata> {
  const image = new Image()
  const objectUrl = URL.createObjectURL(input)

  try {
    return await new Promise<ImageMetadata>((resolve, reject) => {
      image.onload = () => {
        if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
          reject(new Error('cannot determine image dimensions'))
          return
        }
        resolve({ width: image.naturalWidth, height: image.naturalHeight })
      }
      image.onerror = () => reject(new Error('cannot read image metadata'))
      image.src = objectUrl
    })
  } finally {
    image.src = ''
    URL.revokeObjectURL(objectUrl)
  }
}
