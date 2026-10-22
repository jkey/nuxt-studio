import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FetchError } from 'ofetch'
import { computeExpiresAt, fetchForgejoUser, getForgejoInstanceUrl, requestForgejoToken, resolveForgejoRepositoryInstanceUrl } from '../../src/runtime/server/utils/forgejo'

describe('requestForgejoToken', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('$fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('posts to /login/oauth/access_token', async () => {
    mockFetch.mockResolvedValue({ access_token: 'a', refresh_token: 'r', expires_in: 3600 })

    const result = await requestForgejoToken('https://git.example.com', { grant_type: 'authorization_code', code: 'c' })

    expect(mockFetch).toHaveBeenCalledWith('https://git.example.com/login/oauth/access_token', expect.objectContaining({
      method: 'POST',
      body: { grant_type: 'authorization_code', code: 'c' },
    }))
    expect(result).toEqual({ access_token: 'a', refresh_token: 'r', expires_in: 3600 })
  })

  it('returns error payload instead of throwing', async () => {
    const error = new FetchError('Request failed')
    ;(error as unknown as { data: unknown }).data = { error: 'invalid_grant' }
    mockFetch.mockRejectedValue(error)

    const result = await requestForgejoToken('https://git.example.com', { grant_type: 'authorization_code', code: 'bad' })

    expect(result).toEqual({ error: 'invalid_grant' })
  })
})

describe('fetchForgejoUser', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('$fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('sends bearer token', async () => {
    mockFetch.mockResolvedValue({ id: 1, login: 'octo', full_name: 'Octo Cat', email: 'octo@example.com', avatar_url: 'https://git.example.com/avatar.png' })

    await fetchForgejoUser('https://git.example.com', 'a')

    expect(mockFetch).toHaveBeenCalledWith('https://git.example.com/api/v1/user', expect.objectContaining({
      headers: { Authorization: 'Bearer a' },
    }))
  })
})

describe('computeExpiresAt', () => {
  it('returns the absolute expiration timestamp in ms', () => {
    expect(computeExpiresAt(3600, 1_000)).toBe(3_601_000)
  })

  it('returns undefined when expiresIn is not set', () => {
    expect(computeExpiresAt(undefined, 1_000)).toBeUndefined()
  })
})

describe('getForgejoInstanceUrl', () => {
  it('uses the auth instance URL when set', () => {
    expect(getForgejoInstanceUrl('https://git.example.com', 'https://repo.example.com')).toBe('https://git.example.com')
  })

  it('falls back to the repository instance URL when the auth one is empty', () => {
    expect(getForgejoInstanceUrl('', 'https://repo.example.com')).toBe('https://repo.example.com')
  })

  it('falls back to Codeberg when both are empty', () => {
    expect(getForgejoInstanceUrl('', '')).toBe('https://codeberg.org')
    expect(getForgejoInstanceUrl(undefined, undefined)).toBe('https://codeberg.org')
  })

  it('strips a trailing slash', () => {
    expect(getForgejoInstanceUrl('https://git.example.com/', undefined)).toBe('https://git.example.com')
  })
})

describe('resolveForgejoRepositoryInstanceUrl', () => {
  it('returns the auth instance URL when the repository one is empty', () => {
    expect(resolveForgejoRepositoryInstanceUrl('https://git.example.com', '')).toBe('https://git.example.com')
    expect(resolveForgejoRepositoryInstanceUrl('https://git.example.com', undefined)).toBe('https://git.example.com')
  })

  it('returns undefined when the repository instance URL is already set', () => {
    expect(resolveForgejoRepositoryInstanceUrl('https://git.example.com', 'https://repo.example.com')).toBeUndefined()
  })

  it('returns undefined when there is no auth instance URL to copy', () => {
    expect(resolveForgejoRepositoryInstanceUrl(undefined, undefined)).toBeUndefined()
    expect(resolveForgejoRepositoryInstanceUrl('', '')).toBeUndefined()
  })
})
