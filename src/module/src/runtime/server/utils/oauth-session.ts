import type { H3Event } from 'h3'
import { getRequestProtocol, useSession } from 'h3'
import type { StudioUser } from 'nuxt-studio/app'
import { useRuntimeConfig } from '#imports'

/**
 * OAuth tokens of the logged-in user that must stay on the server (e.g. a Forgejo refresh token).
 * They live in the encrypted session cookie under `oauth` and are stripped from `GET /auth/session`.
 */
export interface StudioOAuthTokens {
  refreshToken: string
  /**
   * Informational only: tokens are refreshed reactively after a 401 from the Git provider.
   */
  expiresAt?: number
}

function useStudioSession(event: H3Event) {
  return useSession(event, {
    name: 'studio-session',
    password: useRuntimeConfig(event).studio?.auth?.sessionSecret,
    cookie: {
      // Use secure cookies over HTTPS, required for locally testing purposes
      secure: getRequestProtocol(event) === 'https',
      path: '/',
    },
  })
}

/**
 * Get the user of the current Studio session, if any.
 * @param event The H3 event.
 * @returns The session user, or `undefined` when not logged in.
 */
export async function getStudioSessionUser(event: H3Event): Promise<StudioUser | undefined> {
  const session = await useStudioSession(event)
  return session.data.user as StudioUser | undefined
}

/**
 * Store OAuth tokens in the session, replacing any previous ones.
 * `session.update` assigns top-level keys only, so `oauth` is replaced rather than merged
 * (a merge would keep a stale `expiresAt` when a token response omits `expires_in`).
 * @param event The H3 event.
 * @param tokens The OAuth tokens to store.
 */
export async function setStudioOAuthTokens(event: H3Event, tokens: StudioOAuthTokens): Promise<void> {
  const session = await useStudioSession(event)
  await session.update({ oauth: { ...tokens } })
}

/**
 * Read the OAuth tokens stored in the session.
 * @param event The H3 event.
 * @returns The stored OAuth tokens, or `null` if none are stored.
 */
export async function getStudioOAuthTokens(event: H3Event): Promise<StudioOAuthTokens | null> {
  const session = await useStudioSession(event)
  return (session.data.oauth as StudioOAuthTokens | undefined) || null
}

/**
 * Replace the access token of the logged-in user after a token refresh.
 * Unlike a login, this does not fire the `studio:auth:login` hook and keeps `oauth` untouched.
 * @param event The H3 event.
 * @param accessToken The freshly obtained access token.
 */
export async function updateStudioUserAccessToken(event: H3Event, accessToken: string): Promise<void> {
  const session = await useStudioSession(event)
  const user = session.data.user as StudioUser | undefined
  if (!user) {
    return
  }

  await session.update({ user: { ...user, accessToken } })
}
