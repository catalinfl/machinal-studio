import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { crc32 } from 'node:zlib'
import { chromium } from '@playwright/test'

const publicDirectory = new URL('../public/', import.meta.url)
const svg = await readFile(new URL('machinal-icon.svg', publicDirectory), 'utf8')
const sourceHash = createHash('sha256').update(svg).digest('hex')

function withProvenance(png) {
  const data = Buffer.from(`impeccable:prompt\0Origin: original hand-authored machinal M monogram; source: machinal-icon.svg; sha256: ${sourceHash}; deterministic rasterization by scripts/generate-brand-icons.mjs with Chromium, not AI generation or stock artwork.`, 'utf8')
  const type = Buffer.from('tEXt')
  const chunk = Buffer.alloc(data.length + 12)
  chunk.writeUInt32BE(data.length, 0)
  type.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), data.length + 8)
  return Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)])
}

function createIco(images) {
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16
    header[entry] = size
    header[entry + 1] = size
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...images.map(image => image.png)])
}

const browser = await chromium.launch(process.env.SCENE_BROWSER ? { executablePath: process.env.SCENE_BROWSER } : {})
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  const icons = []
  for (const size of [16, 32, 48, 180]) {
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(`<html><body style="margin:0;background:${size === 180 ? '#c6adff' : 'transparent'}">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`)
    const png = withProvenance(await page.screenshot({ omitBackground: true }))
    if (size < 180) icons.push({ size, png })
    if (size === 32) await writeFile(new URL('machinal-favicon-32.png', publicDirectory), png)
    if (size === 180) await writeFile(new URL('machinal-apple-touch-icon.png', publicDirectory), png)
  }
  await writeFile(new URL('machinal-favicon.ico', publicDirectory), createIco(icons))
  console.log('Generated machinal PNG, ICO (16/32/48px) and Apple touch icon from machinal-icon.svg.')
} finally {
  await browser.close()
}
