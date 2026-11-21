const fixturePalettes = [
  ['#d7e9ed', '#5890a0', '#234351'],
  ['#f0d8b3', '#c77d55', '#513847'],
  ['#d6e6c9', '#7f9a73', '#354b4b'],
  ['#e8d9ef', '#9b77aa', '#424269'],
]

let videoFixture: Promise<string> | undefined

export function createSyntheticImageFixtures(count: number): Record<string, string> {
  return Object.fromEntries(
    Array.from({ length: Math.min(4, count) }, (_, index) => [`image_${index + 1}`, createSyntheticImage(index)]),
  )
}

function createSyntheticImage(index: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 400
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser could not create the local image fixtures.')

  const [sky, middle, foreground] = fixturePalettes[index % fixturePalettes.length]
  const gradient = context.createLinearGradient(0, 0, 640, 400)
  gradient.addColorStop(0, sky)
  gradient.addColorStop(0.55, '#f2e8d9')
  gradient.addColorStop(1, middle)
  context.fillStyle = gradient
  context.fillRect(0, 0, canvas.width, canvas.height)

  context.fillStyle = `${foreground}cc`
  context.beginPath()
  context.moveTo(0, 285)
  context.lineTo(142, 138 + index * 12)
  context.lineTo(282, 290)
  context.lineTo(423, 116 + index * 18)
  context.lineTo(640, 306)
  context.lineTo(640, 400)
  context.lineTo(0, 400)
  context.closePath()
  context.fill()

  context.fillStyle = '#f9e6b8'
  context.beginPath()
  context.arc(478 - index * 36, 104 + index * 10, 34, 0, Math.PI * 2)
  context.fill()

  context.fillStyle = `${foreground}45`
  for (let mark = 0; mark < 5; mark++) {
    context.fillRect(42 + mark * 31, 354 + (mark % 2) * 9, 18, 3)
  }

  return canvas.toDataURL('image/png')
}

export function createSyntheticVideoFixture(): Promise<string> {
  videoFixture ??= recordSyntheticVideo()
  return videoFixture
}

async function recordSyntheticVideo(): Promise<string> {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('This browser cannot create the local WebM fixture. Try the gallery in a Chromium-based browser.')
  }

  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find(type => MediaRecorder.isTypeSupported(type))
  if (!mimeType) throw new Error('This browser does not support local WebM fixture recording.')

  const canvas = document.createElement('canvas')
  canvas.width = 480
  canvas.height = 270
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser could not create the local video fixture.')
  if (typeof canvas.captureStream !== 'function') {
    throw new Error('This browser cannot create the local WebM fixture. Try the gallery in a Chromium-based browser.')
  }
  const stream = canvas.captureStream(18)

  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 280_000 })
  const chunks: BlobPart[] = []

  return new Promise((resolve, reject) => {
    let animationFrame = 0
    const startedAt = performance.now()
    const draw = (now: number) => {
      const elapsed = Math.min(1.5, (now - startedAt) / 1000)
      drawSyntheticVideoFrame(context, elapsed)
      if (elapsed < 1.5) animationFrame = requestAnimationFrame(draw)
      else recorder.stop()
    }

    recorder.ondataavailable = event => {
      if (event.data.size) chunks.push(event.data)
    }
    recorder.onerror = () => {
      cancelAnimationFrame(animationFrame)
      stream.getTracks().forEach(track => track.stop())
      reject(new Error('The local WebM fixture could not be recorded.'))
    }
    recorder.onstop = async () => {
      cancelAnimationFrame(animationFrame)
      stream.getTracks().forEach(track => track.stop())
      const blob = new Blob(chunks, { type: mimeType })
      if (!blob.size) {
        reject(new Error('The browser returned an empty WebM fixture.'))
        return
      }
      try {
        resolve(await blobAsDataUrl(blob))
      } catch {
        reject(new Error('The local WebM fixture could not be encoded.'))
      }
    }

    drawSyntheticVideoFrame(context, 0)
    try {
      recorder.start()
      animationFrame = requestAnimationFrame(draw)
    } catch {
      stream.getTracks().forEach(track => track.stop())
      reject(new Error('The local WebM fixture could not be recorded.'))
    }
  })
}

function drawSyntheticVideoFrame(context: CanvasRenderingContext2D, time: number): void {
  const gradient = context.createLinearGradient(0, 0, 480, 270)
  gradient.addColorStop(0, '#182f49')
  gradient.addColorStop(0.56, '#4a8a92')
  gradient.addColorStop(1, '#e1a56f')
  context.fillStyle = gradient
  context.fillRect(0, 0, 480, 270)

  const centerX = 240 + Math.sin(time * Math.PI * 1.4) * 90
  const centerY = 130 + Math.cos(time * Math.PI * 2) * 18
  context.fillStyle = '#f2dcad'
  context.beginPath()
  context.arc(centerX, centerY, 62, 0, Math.PI * 2)
  context.fill()

  context.fillStyle = '#15232f'
  context.fillRect(0, 216, 480, 54)
  context.fillStyle = '#f5f2eb'
  context.font = '600 16px sans-serif'
  context.fillText('SYNTHETIC MOTION FIXTURE', 22, 248)
}

async function blobAsDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return `data:${blob.type};base64,${btoa(binary)}`
}
