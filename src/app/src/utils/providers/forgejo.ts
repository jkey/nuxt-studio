import { ofetch } from 'ofetch'
import { joinURL, withoutTrailingSlash } from 'ufo'
import { consola } from 'consola'
import type { GitOptions, GitProviderAPI, GitFile, RawFile, CommitResult } from '../../types'
import { DraftStatus } from '../../types/draft'
import { StudioFeature } from '../../types'
import { stripDataUrlPrefix, encodeBase64Utf8 } from './base64'

const logger = consola.withTag('Nuxt Studio')

interface ChangeFileOperation {
  operation: 'create' | 'update' | 'delete'
  path: string
  content?: string
  sha?: string
}

type ApiOptions = Record<string, unknown>

export function createForgejoProvider(options: GitOptions): GitProviderAPI {
  const { owner, repo, token, branch, rootDir, authorName, authorEmail } = options
  const gitFiles: Record<string, GitFile> = {}

  // Mutable so a 401 retry (see `request` below) can swap it between requests.
  let currentToken = token

  // Shared in-flight refresh: a burst of requests hitting an expired token must
  // trigger exactly one `refreshToken()` call, not one per request.
  let refreshing: Promise<string | null> | null = null

  const instanceUrl = withoutTrailingSlash(options.instanceUrl || 'https://codeberg.org')

  const $api = ofetch.create({
    baseURL: `${instanceUrl}/api/v1/repos/${owner}/${repo}`,
  })

  /**
   * Percent-encode each path segment individually, keeping `/` as a path separator.
   *
   * @param path - Repository-relative file path
   * @returns The path with every segment percent-encoded
   */
  function encodePath(path: string): string {
    return path.split('/').map(encodeURIComponent).join('/')
  }

  function authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${currentToken}` }
  }

  /**
   * Perform an authenticated request against the Forgejo API, transparently retrying
   * once with a freshly refreshed token when the server responds with 401.
   *
   * Concurrent 401s share a single in-flight refresh (`refreshing`): the first caller
   * to see a 401 starts the refresh, every other caller awaits that same promise
   * instead of starting its own. If the refresh fails (returns `null`), the original
   * 401 error is re-thrown rather than retrying forever.
   *
   * @param url - Request path, relative to the repo API base URL
   * @param opts - Additional ofetch options (query, method, body, ...); `Authorization` is always set from the current token
   * @returns The parsed response body
   */
  async function request(url: string, opts: ApiOptions = {}) {
    try {
      return await $api(url, { ...opts, headers: authHeaders() })
    }
    catch (error) {
      if ((error as { status?: number })?.status !== 401 || !options.refreshToken) {
        throw error
      }

      refreshing ??= options.refreshToken().finally(() => {
        refreshing = null
      })

      const refreshedToken = await refreshing

      if (!refreshedToken) {
        throw error
      }

      currentToken = refreshedToken

      return await $api(url, { ...opts, headers: authHeaders() })
    }
  }

  /**
   * Fetch the current remote `sha` for a file, bypassing the `fetchFile` cache.
   * Used by `commitFiles` right before committing so update/delete operations
   * always target the latest remote revision.
   *
   * @param fullPath - Repository-relative path, already prefixed with `rootDir`
   * @returns The remote sha, or `null` if the file does not exist remotely
   */
  async function fetchSha(fullPath: string): Promise<string | null> {
    try {
      const response = await request(`/contents/${encodePath(fullPath)}`, {
        query: { ref: branch },
      })
      return response.sha ?? null
    }
    catch (error) {
      // Only a 404 means "no remote sha" (file genuinely doesn't exist yet/anymore).
      // Any other error (5xx, rate-limit, expired token, network) must not be
      // mistaken for that — it would silently drop a delete or turn an update
      // into a create. Let commitFiles' caller see the failure instead.
      if ((error as { status?: number }).status === 404) {
        return null
      }

      throw error
    }
  }

  async function fetchFile(path: string, { cached = false }: { cached?: boolean } = {}): Promise<GitFile | null> {
    const fullPath = joinURL(rootDir, path)

    if (cached) {
      const file = gitFiles[fullPath]
      if (file) {
        return file
      }
    }

    try {
      const response = await request(`/contents/${encodePath(fullPath)}`, {
        query: { ref: branch },
      })

      const gitFile: GitFile = {
        name: response.name,
        path: response.path,
        sha: response.sha,
        size: response.size,
        url: response.html_url,
        content: response.content,
        encoding: 'base64' as const,
        provider: 'forgejo' as const,
      }

      if (cached) {
        gitFiles[fullPath] = gitFile
      }
      return gitFile
    }
    catch (error) {
      // Handle different types of errors gracefully
      if ((error as { status?: number }).status === 404) {
        logger.warn(`File not found on Forgejo: ${fullPath}`)
        return null
      }

      logger.error(`Failed to fetch file from Forgejo: ${fullPath}`, error)

      // For development, show alert. In production, you might want to use a toast notification
      if (process.env.NODE_ENV === 'development') {
        alert(`Failed to fetch file: ${fullPath}\n${(error as { message?: string }).message || error}`)
      }

      return null
    }
  }

  /**
   * Forgejo's `ChangeFileOperation.content` is always base64, regardless of operation.
   * See: https://codeberg.org/api/swagger#/repository/repoChangeFiles
   */
  function encodeFileContent(file: RawFile): string {
    const rawContent = file.content ?? ''
    return file.encoding === 'base64' ? stripDataUrlPrefix(rawContent) : encodeBase64Utf8(rawContent)
  }

  async function commitFiles(files: RawFile[], message: string): Promise<CommitResult | null> {
    if (!currentToken) {
      return null
    }

    const pendingFiles = files
      .filter(file => file.status !== DraftStatus.Pristine)
      .map(file => ({ ...file, path: joinURL(rootDir, file.path) }))

    const changeFiles: ChangeFileOperation[] = []

    for (const file of pendingFiles) {
      if (file.status === DraftStatus.Created) {
        changeFiles.push({ operation: 'create', path: file.path, content: encodeFileContent(file) })
        continue
      }

      // Forgejo requires the current sha for update/delete; always fetch it fresh (no cache)
      // since the draft may have been created from a stale `fetchFile` snapshot.
      const remoteSha = await fetchSha(file.path)

      if (file.status === DraftStatus.Deleted) {
        if (!remoteSha) {
          // Nothing to delete remotely, drop it.
          continue
        }
        changeFiles.push({ operation: 'delete', path: file.path, sha: remoteSha })
        continue
      }

      if (!remoteSha) {
        // Updated draft of a file that no longer exists remotely — recreate it.
        changeFiles.push({ operation: 'create', path: file.path, content: encodeFileContent(file) })
        continue
      }

      changeFiles.push({ operation: 'update', path: file.path, content: encodeFileContent(file), sha: remoteSha })
    }

    if (changeFiles.length === 0) {
      return null
    }

    const res = await request('/contents', {
      method: 'POST',
      body: {
        branch,
        message,
        author: { name: authorName, email: authorEmail },
        files: changeFiles,
      },
    })

    return {
      success: true,
      commitSha: res.commit.sha,
      url: getCommitUrl(res.commit.sha),
    }
  }

  function getRepositoryUrl() {
    return `${instanceUrl}/${owner}/${repo}`
  }

  function getBranchUrl() {
    return `${instanceUrl}/${owner}/${repo}/src/branch/${branch}`
  }

  function getCommitUrl(sha: string) {
    return `${instanceUrl}/${owner}/${repo}/commit/${sha}`
  }

  function getFileUrl(feature: StudioFeature, fsPath: string) {
    const featureDir = feature === StudioFeature.Content ? 'content' : 'public'
    const fullPath = joinURL(rootDir, featureDir, fsPath)
    return `${instanceUrl}/${owner}/${repo}/src/branch/${branch}/${fullPath}`
  }

  function getRepositoryInfo() {
    return {
      owner,
      repo,
      branch,
      provider: 'forgejo' as const,
    }
  }

  return {
    fetchFile,
    commitFiles,
    getRepositoryUrl,
    getBranchUrl,
    getCommitUrl,
    getFileUrl,
    getRepositoryInfo,
  }
}
