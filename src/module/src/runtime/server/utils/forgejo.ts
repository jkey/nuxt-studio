import { FetchError } from 'ofetch'
import { withoutTrailingSlash } from 'ufo'

/**
 * Shared Forgejo OAuth/API helpers.
 *
 * This file must not import from `#imports` (or anything else that requires a Nuxt
 * context) so it can be unit-tested in isolation without bootstrapping Nuxt.
 * `$fetch` is used as a global here and is stubbed via `vi.stubGlobal` in tests.
 */

export interface ForgejoTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

export interface ForgejoUser {
  id: number
  login: string
  full_name: string
  email: string
  avatar_url: string
}

/**
 * Exchange an authorization code (or refresh token) for a Forgejo access token.
 * @param instanceUrl The Forgejo instance base URL, without a trailing slash.
 * @param body The OAuth token request body (e.g. `grant_type`, `code`, `client_id`, ...).
 * @returns The token response, or an error payload instead of throwing.
 */
export async function requestForgejoToken(instanceUrl: string, body: Record<string, string>): Promise<ForgejoTokenResponse> {
  try {
    return await $fetch<ForgejoTokenResponse>(`${instanceUrl}/login/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body,
    })
  }
  catch (error) {
    if (error instanceof FetchError) {
      return error.data || { error: error.message }
    }
    return { error: 'Unknown error' }
  }
}

/**
 * Fetch the authenticated Forgejo user profile.
 * @param instanceUrl The Forgejo instance base URL, without a trailing slash.
 * @param accessToken The OAuth access token (or personal access token).
 * @returns The Forgejo user profile.
 * @see https://codeberg.org/api/swagger#/user/userGetCurrent
 */
export async function fetchForgejoUser(instanceUrl: string, accessToken: string): Promise<ForgejoUser> {
  return $fetch<ForgejoUser>(`${instanceUrl}/api/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })
}

/**
 * Compute the absolute expiration timestamp of a Forgejo access token.
 * @param expiresIn The token lifetime in seconds, as returned by the token endpoint.
 * @param now The current time in ms, defaults to `Date.now()`.
 * @returns The absolute expiration timestamp in ms, or `undefined` if `expiresIn` is not set.
 */
export function computeExpiresAt(expiresIn: number | undefined, now: number = Date.now()): number | undefined {
  return expiresIn === undefined ? undefined : now + expiresIn * 1000
}

/**
 * Resolve the Forgejo instance URL to use for OAuth and API requests.
 * @param authInstanceUrl The `studio.auth.forgejo.instanceUrl` config value.
 * @param repositoryInstanceUrl The `studio.repository.instanceUrl` config value.
 * @returns The resolved instance URL, without a trailing slash, defaulting to Codeberg.
 */
export function getForgejoInstanceUrl(authInstanceUrl?: string, repositoryInstanceUrl?: string): string {
  return withoutTrailingSlash(authInstanceUrl || repositoryInstanceUrl || 'https://codeberg.org')
}

/**
 * Resolve the Forgejo `repository.instanceUrl` to publish when only the auth `instanceUrl`
 * was configured. The repository `instanceUrl` is the primary setting (used by the browser-side
 * Git provider), while the auth `instanceUrl` falls back to it. When only the auth one is set,
 * it must be copied over so the Git API calls target the same instance as OAuth.
 * @param authInstanceUrl The `studio.auth.forgejo.instanceUrl` config value.
 * @param repositoryInstanceUrl The current `studio.repository.instanceUrl` config value.
 * @returns The instance URL to copy into `repository.instanceUrl`, or `undefined` if there is
 * nothing to copy (no auth instance URL set) or nothing to do (a repository instance URL is
 * already set).
 */
export function resolveForgejoRepositoryInstanceUrl(authInstanceUrl?: string, repositoryInstanceUrl?: string): string | undefined {
  if (repositoryInstanceUrl) {
    return undefined
  }
  return authInstanceUrl || undefined
}
