const MD5_SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
const MD5_CONSTANTS = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 4294967296))

function digest16(input: Uint8Array): Uint8Array {
  const block = new Uint32Array(16)
  const bytes = new Uint8Array(block.buffer)
  bytes.set(input)
  bytes[16] = 128
  block[14] = 128
  const initial = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]
  let [a, b, c, d] = initial
  for (let index = 0; index < 64; index++) {
    const group = index >> 4
    const mixed = group === 0 ? (b & c) | (~b & d) : group === 1 ? (d & b) | (~d & c) : group === 2 ? b ^ c ^ d : c ^ (b | ~d)
    const word = group === 0 ? index : group === 1 ? (5 * index + 1) % 16 : group === 2 ? (3 * index + 5) % 16 : 7 * index % 16
    const sum = (a + mixed + MD5_CONSTANTS[index] + block[word]) | 0
    const shift = MD5_SHIFTS[group * 4 + index % 4]
    const rotated = (sum << shift) | (sum >>> (32 - shift))
    a = d; d = c; c = b; b = (b + rotated) | 0
  }
  return new Uint8Array(new Uint32Array([a + initial[0], b + initial[1], c + initial[2], d + initial[3]]).buffer)
}

function multiplyPolynomial(left: Uint32Array, right: Uint32Array): Uint32Array {
  const product = new Uint32Array(109)
  for (let x = 0; x < 55; x++) {
    for (let y = 0; y < 55; y++) product[x + y] = (product[x + y] + Math.imul(left[x], right[y])) >>> 0
  }
  for (let power = 108; power >= 55; power--) {
    product[power - 55] = (product[power - 55] + product[power]) >>> 0
    product[power - 24] = (product[power - 24] + product[power]) >>> 0
  }
  return product.slice(0, 55)
}

function shiftPolynomial(value: Uint32Array): void {
  const last = value[54]
  value.copyWithin(1, 0, 54)
  value[0] = last
  value[31] = (value[31] + last) >>> 0
}

export class NativeRandom {
  private state = new Uint32Array(64)
  private index = 0

  constructor(seed: number) {
    let digest: Uint8Array = new Uint8Array(16)
    for (let index = 8; index < 64; index += 4) {
      new DataView(digest.buffer).setUint32(0, seed >>> 0, true)
      digest[4] = index
      digest = digest16(digest)
      this.state.set(new Uint32Array(digest.buffer), index)
    }
  }

  next(): number {
    const result = (this.state[(this.index - 24) & 63] + this.state[(this.index - 55) & 63]) >>> 0
    this.state[this.index++ & 63] = result
    return result
  }

  clone(): NativeRandom {
    const copy = Object.create(NativeRandom.prototype) as NativeRandom
    copy.state = this.state.slice()
    copy.index = this.index
    return copy
  }

  skip(count: number): void {
    if (count < 128) {
      for (let index = 0; index < count; index++) this.next()
      return
    }
    const history = Uint32Array.from({ length: 55 }, (_, index) => this.state[(this.index - 55 + index) & 63])
    let polynomial: Uint32Array = new Uint32Array(55)
    polynomial[0] = 1
    let power: Uint32Array = new Uint32Array(55)
    power[1] = 1
    for (let remaining = count; remaining > 0; remaining = Math.floor(remaining / 2)) {
      if (remaining % 2 === 1) polynomial = multiplyPolynomial(polynomial, power)
      power = multiplyPolynomial(power, power)
    }
    this.index += count
    for (let index = 0; index < 55; index++) {
      let value = 0
      for (let term = 0; term < 55; term++) value = (value + Math.imul(polynomial[term], history[term])) >>> 0
      this.state[(this.index - 55 + index) & 63] = value
      shiftPolynomial(polynomial)
    }
  }
}
