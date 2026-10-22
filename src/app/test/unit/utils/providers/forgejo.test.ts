import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DraftStatus } from '../../../../src/types/draft'
import { StudioFeature } from '../../../../src/types'
import { createForgejoProvider } from '../../../../src/utils/providers/forgejo'
import { encodeBase64Utf8 } from '../../../../src/utils/providers/base64'

type ApiOptions = Record<string, unknown>
type ApiHandler = (url: string, options?: ApiOptions) => unknown

let handlers: Record<string, ApiHandler> = {}

const mock$api = vi.fn(async (url: string, options?: ApiOptions) => {
  const handler = handlers[url]
  if (!handler) {
    throw new Error(`Unexpected request: ${url} ${(options?.method as string) ?? 'GET'}`)
  }
  return handler(url, options)
})

vi.mock('ofetch', () => ({
  ofetch: {
    create: vi.fn(() => mock$api),
  },
}))

const baseGitOptions = {
  provider: 'forgejo' as const,
  owner: 'acme',
  repo: 'site',
  branch: 'main',
  rootDir: '',
  authorName: 'Test Author',
  authorEmail: 'author@example.com',
  token: 'tok',
  instanceUrl: 'https://git.example.com/',
} as const

beforeEach(() => {
  handlers = {}
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('createForgejoProvider / fetchFile', () => {
  it('encodes each path segment and keeps slashes', async () => {
    handlers['/contents/content/1.%C3%BCber%20uns/index.md'] = () => ({
      name: 'index.md',
      path: 'content/1.über uns/index.md',
      sha: 's1',
      size: 3,
      html_url: 'h',
      content: 'YWJj',
      encoding: 'base64',
    })

    const file = await createForgejoProvider(baseGitOptions).fetchFile('content/1.über uns/index.md')

    expect(file).toMatchObject({ sha: 's1', content: 'YWJj', encoding: 'base64', provider: 'forgejo' })
    expect(mock$api.mock.calls[0][1]).toMatchObject({
      query: { ref: 'main' },
      headers: { Authorization: 'Bearer tok' },
    })
  })

  it('returns null on 404', async () => {
    handlers['/contents/content/missing.md'] = () => Promise.reject({ status: 404 })

    const file = await createForgejoProvider(baseGitOptions).fetchFile('content/missing.md')

    expect(file).toBeNull()
  })

  it('retries once with refreshed token after 401', async () => {
    handlers['/contents/content/a.md'] = (_url, options) => {
      const authorization = (options?.headers as Record<string, string> | undefined)?.Authorization
      if (authorization === 'Bearer tok') {
        return Promise.reject({ status: 401 })
      }
      return { name: 'a.md', path: 'content/a.md', sha: 's1', size: 1, html_url: 'h', content: 'YQ==', encoding: 'base64' }
    }

    const refreshToken = vi.fn().mockResolvedValue('new')
    const file = await createForgejoProvider({ ...baseGitOptions, refreshToken }).fetchFile('content/a.md')

    expect(file?.sha).toBe('s1')
    expect(refreshToken).toHaveBeenCalledTimes(1)
  })

  it('shares a single refresh across parallel 401s', async () => {
    for (const name of ['a', 'b', 'c']) {
      handlers[`/contents/content/${name}.md`] = (_url, options) => {
        const authorization = (options?.headers as Record<string, string> | undefined)?.Authorization
        if (authorization === 'Bearer tok') {
          return Promise.reject({ status: 401 })
        }
        return { name: `${name}.md`, path: `content/${name}.md`, sha: `s-${name}`, size: 1, html_url: 'h', content: 'YQ==', encoding: 'base64' }
      }
    }

    const refreshToken = vi.fn().mockResolvedValue('new')
    const provider = createForgejoProvider({ ...baseGitOptions, refreshToken })

    const files = await Promise.all([
      provider.fetchFile('content/a.md'),
      provider.fetchFile('content/b.md'),
      provider.fetchFile('content/c.md'),
    ])

    expect(files.map(file => file?.sha)).toEqual(['s-a', 's-b', 's-c'])
    expect(refreshToken).toHaveBeenCalledTimes(1)
  })

  it('does not loop when refresh fails', async () => {
    handlers['/contents/content/a.md'] = () => Promise.reject({ status: 401 })

    const refreshToken = vi.fn().mockResolvedValue(null)
    const file = await createForgejoProvider({ ...baseGitOptions, refreshToken }).fetchFile('content/a.md')

    expect(file).toBeNull()
    expect(refreshToken).toHaveBeenCalledTimes(1)
    expect(mock$api).toHaveBeenCalledTimes(1)
  })
})

describe('createForgejoProvider / commitFiles', () => {
  it('sends create/update/delete with fresh sha and utf-8 base64 content', async () => {
    handlers['/contents/content/a.md'] = () => ({ sha: 'shaA' })
    handlers['/contents/content/b.md'] = () => ({ sha: 'shaB' })

    let postBody: Record<string, unknown> | undefined
    handlers['/contents'] = (_url, options) => {
      postBody = options?.body as Record<string, unknown>
      return { commit: { sha: 'c0ffee' } }
    }

    const provider = createForgejoProvider(baseGitOptions)
    const result = await provider.commitFiles(
      [
        { path: 'content/new.md', status: DraftStatus.Created, content: 'Grüße' },
        { path: 'content/a.md', status: DraftStatus.Updated, content: 'x' },
        { path: 'content/b.md', status: DraftStatus.Deleted, content: null },
        { path: 'content/same.md', status: DraftStatus.Pristine, content: 'y' },
      ],
      'msg',
    )

    expect(result).toEqual({
      success: true,
      commitSha: 'c0ffee',
      url: 'https://git.example.com/acme/site/commit/c0ffee',
    })

    expect(postBody).toEqual({
      branch: 'main',
      message: 'msg',
      author: { name: 'Test Author', email: 'author@example.com' },
      files: [
        { operation: 'create', path: 'content/new.md', content: encodeBase64Utf8('Grüße') },
        { operation: 'update', path: 'content/a.md', content: 'eA==', sha: 'shaA' },
        { operation: 'delete', path: 'content/b.md', sha: 'shaB' },
      ],
    })
  })

  it('fetches sha fresh on every commit (no cache)', async () => {
    handlers['/contents/content/a.md'] = () => ({ sha: 'old' })

    const provider = createForgejoProvider(baseGitOptions)
    await provider.fetchFile('content/a.md', { cached: true })

    handlers['/contents/content/a.md'] = () => ({ sha: 'new' })

    let postBody: Record<string, unknown> | undefined
    handlers['/contents'] = (_url, options) => {
      postBody = options?.body as Record<string, unknown>
      return { commit: { sha: 'c0ffee' } }
    }

    await provider.commitFiles(
      [{ path: 'content/a.md', status: DraftStatus.Updated, content: 'y' }],
      'msg',
    )

    expect(postBody?.files).toEqual([
      { operation: 'update', path: 'content/a.md', content: encodeBase64Utf8('y'), sha: 'new' },
    ])
  })

  it('prefixes rootDir exactly once, including sha lookup', async () => {
    const calledUrls: string[] = []
    handlers['/contents/apps/site/content/a.md'] = (url) => {
      calledUrls.push(url)
      return { sha: 'shaA' }
    }

    let postBody: Record<string, unknown> | undefined
    handlers['/contents'] = (_url, options) => {
      postBody = options?.body as Record<string, unknown>
      return { commit: { sha: 'c0ffee' } }
    }

    const provider = createForgejoProvider({ ...baseGitOptions, rootDir: 'apps/site' })
    await provider.commitFiles(
      [{ path: 'content/a.md', status: DraftStatus.Updated, content: 'z' }],
      'msg',
    )

    expect(calledUrls).toEqual(['/contents/apps/site/content/a.md'])
    expect(postBody?.files).toEqual([
      { operation: 'update', path: 'apps/site/content/a.md', content: encodeBase64Utf8('z'), sha: 'shaA' },
    ])
  })

  it('turns update of missing remote file into create and drops delete of missing file', async () => {
    handlers['/contents/content/missing-update.md'] = () => Promise.reject({ status: 404 })
    handlers['/contents/content/missing-delete.md'] = () => Promise.reject({ status: 404 })

    let postBody: Record<string, unknown> | undefined
    handlers['/contents'] = (_url, options) => {
      postBody = options?.body as Record<string, unknown>
      return { commit: { sha: 'c0ffee' } }
    }

    const provider = createForgejoProvider(baseGitOptions)
    await provider.commitFiles(
      [
        { path: 'content/missing-update.md', status: DraftStatus.Updated, content: 'new content' },
        { path: 'content/missing-delete.md', status: DraftStatus.Deleted, content: null },
      ],
      'msg',
    )

    expect(postBody?.files).toEqual([
      { operation: 'create', path: 'content/missing-update.md', content: encodeBase64Utf8('new content') },
    ])
  })

  it('returns null without posting when no files remain after dropping missing deletes', async () => {
    handlers['/contents/content/missing-delete.md'] = () => Promise.reject({ status: 404 })

    const provider = createForgejoProvider(baseGitOptions)
    const result = await provider.commitFiles(
      [{ path: 'content/missing-delete.md', status: DraftStatus.Deleted, content: null }],
      'msg',
    )

    expect(result).toBeNull()
  })

  it('rejects and never posts when the sha lookup fails for a non-404 reason', async () => {
    handlers['/contents/content/a.md'] = () => Promise.reject({ status: 500 })

    const postHandler = vi.fn(() => ({ commit: { sha: 'c0ffee' } }))
    handlers['/contents'] = postHandler

    const provider = createForgejoProvider(baseGitOptions)

    await expect(
      provider.commitFiles(
        [{ path: 'content/a.md', status: DraftStatus.Updated, content: 'x' }],
        'msg',
      ),
    ).rejects.toMatchObject({ status: 500 })

    expect(postHandler).not.toHaveBeenCalled()
  })

  it('strips data URL for binary uploads', async () => {
    let postBody: Record<string, unknown> | undefined
    handlers['/contents'] = (_url, options) => {
      postBody = options?.body as Record<string, unknown>
      return { commit: { sha: 'c0ffee' } }
    }

    const provider = createForgejoProvider(baseGitOptions)
    const dataUrl = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='

    await provider.commitFiles(
      [{ path: 'public/icon.svg', status: DraftStatus.Created, content: dataUrl, encoding: 'base64' }],
      'add icon',
    )

    expect(postBody?.files).toEqual([
      { operation: 'create', path: 'public/icon.svg', content: 'PHN2Zz48L3N2Zz4=' },
    ])
  })

  it('does not call the API when token is missing', async () => {
    const provider = createForgejoProvider({ ...baseGitOptions, token: '' })

    const result = await provider.commitFiles(
      [{ path: 'x.md', status: DraftStatus.Created, content: 'x' }],
      'msg',
    )

    expect(result).toBeNull()
    expect(mock$api).not.toHaveBeenCalled()
  })
})

describe('createForgejoProvider / URL helpers', () => {
  it('builds repository, branch, commit and file URLs', () => {
    const provider = createForgejoProvider({ ...baseGitOptions, rootDir: 'apps/site' })

    expect(provider.getRepositoryUrl()).toBe('https://git.example.com/acme/site')
    expect(provider.getBranchUrl()).toBe('https://git.example.com/acme/site/src/branch/main')
    expect(provider.getCommitUrl('abc123')).toBe('https://git.example.com/acme/site/commit/abc123')
    expect(provider.getFileUrl(StudioFeature.Content, 'docs/a.md')).toBe(
      'https://git.example.com/acme/site/src/branch/main/apps/site/content/docs/a.md',
    )
    expect(provider.getRepositoryInfo()).toEqual({
      owner: 'acme',
      repo: 'site',
      branch: 'main',
      provider: 'forgejo',
    })
  })

  it('defaults instanceUrl to https://codeberg.org', () => {
    const { instanceUrl, ...rest } = baseGitOptions
    const provider = createForgejoProvider(rest)

    expect(provider.getRepositoryUrl()).toBe('https://codeberg.org/acme/site')
  })
})
