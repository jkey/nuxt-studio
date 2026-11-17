import { describe, expect, it } from 'vitest'
import { stripDataUrlPrefix, encodeBase64Utf8 } from '../../../../src/utils/providers/base64'

describe('stripDataUrlPrefix', () => {
  it('returns raw base64 from data URL', () =>
    expect(stripDataUrlPrefix('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe('PHN2Zz48L3N2Zz4='))

  it('returns input unchanged when not a data URL', () =>
    expect(stripDataUrlPrefix('PHN2Zz48L3N2Zz4=')).toBe('PHN2Zz48L3N2Zz4='))

  it('returns input unchanged when data URL is not base64', () =>
    expect(stripDataUrlPrefix('data:text/plain,hello')).toBe('data:text/plain,hello'))
})

describe('encodeBase64Utf8', () => {
  it('encodes ASCII', () => expect(encodeBase64Utf8('hello')).toBe('aGVsbG8='))

  it('round-trips umlauts and emoji', () => {
    const text = '# Über uns 🚀\n\nGrüße'
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(encodeBase64Utf8(text)), c => c.charCodeAt(0)))
    expect(decoded).toBe(text)
  })

  it('handles 200 KB without throwing', () => expect(() => encodeBase64Utf8('ä'.repeat(100_000))).not.toThrow())
})
