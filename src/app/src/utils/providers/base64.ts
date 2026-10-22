/**
 * Extract raw base64 content from a data URL.
 *
 * @param content - Base64 or data-URL string
 * @returns Raw base64 string, or input unchanged if not a base64 data URL
 */
export function stripDataUrlPrefix(content: string): string {
  if (!content.startsWith('data:')) {
    return content
  }

  const base64Marker = ';base64,'
  const markerIndex = content.indexOf(base64Marker)

  if (markerIndex === -1) {
    return content
  }

  return content.slice(markerIndex + base64Marker.length)
}

/**
 * Encode UTF-8 text to base64 using chunked encoding to avoid large array spreads.
 *
 * @param text - Plain text to encode
 * @returns Base64-encoded string
 */
export function encodeBase64Utf8(text: string): string {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(text)

  // Use chunked encoding to avoid spreading large arrays
  // Process 8192 bytes at a time
  const chunkSize = 8192
  let result = ''

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    result += String.fromCharCode(...Array.from(chunk))
  }

  return btoa(result)
}
