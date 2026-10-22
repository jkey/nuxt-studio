import { useRuntimeConfig } from '#imports'
import type { H3Event } from 'h3'
import { createError, deleteCookie, eventHandler, getCookie, getQuery, getRequestURL, sendRedirect } from 'h3'
import { withQuery } from 'ufo'
import { generateOAuthState, validateOAuthState } from '../../utils/auth'
import { setInternalStudioUserSession } from '../../utils/session'
import { setStudioOAuthTokens } from '../../utils/oauth-session'
import { mergeConfig } from '../../utils/object'
import { computeExpiresAt, fetchForgejoUser, getForgejoInstanceUrl, requestForgejoToken } from '../../utils/forgejo'

export interface OAuthForgejoConfig {
  /**
   * Forgejo OAuth Client ID
   * @default NUXT_STUDIO_AUTH_FORGEJO_CLIENT_ID
   */
  clientId?: string
  /**
   * Forgejo OAuth Client Secret
   * @default NUXT_STUDIO_AUTH_FORGEJO_CLIENT_SECRET
   */
  clientSecret?: string
  /**
   * Comma-separated list of allowed email addresses.
   * @default NUXT_STUDIO_AUTH_FORGEJO_MODERATORS
   */
  moderators?: string
  /**
   * Forgejo OAuth Scope
   * @default ['write:repository', 'read:user']
   * @see https://forgejo.org/docs/latest/user/oauth2-provider/
   */
  scope?: string[]
  /**
   * Require email from user
   * @default true
   */
  emailRequired?: boolean

  /**
   * Forgejo instance URL (for self-hosted instances, or Gitea instances)
   * @default 'https://codeberg.org'
   */
  instanceUrl?: string

  /**
   * Forgejo OAuth Authorization URL
   * @default '{instanceUrl}/login/oauth/authorize'
   */
  authorizationURL?: string

  /**
   * Extra authorization parameters to provide to the authorization URL
   */
  authorizationParams?: Record<string, string>

  /**
   * Redirect URL to allow overriding for situations like prod failing to determine public hostname
   * Set via NUXT_STUDIO_AUTH_FORGEJO_REDIRECT_URL environment variable.
   * @default is ${hostname}/__nuxt_studio/auth/forgejo
   */
  redirectURL?: string
}

export default eventHandler(async (event: H3Event) => {
  /**
   * OAuth provider validation
   */
  const studioConfig = useRuntimeConfig(event).studio
  const instanceUrl = getForgejoInstanceUrl(studioConfig?.auth?.forgejo?.instanceUrl, studioConfig?.repository?.instanceUrl)

  const config = mergeConfig<OAuthForgejoConfig>(studioConfig?.auth?.forgejo, {
    instanceUrl,
    authorizationURL: `${instanceUrl}/login/oauth/authorize`,
    authorizationParams: {},
    emailRequired: true,
  })

  const query = getQuery<{ code?: string, error?: string, state?: string }>(event)

  if (query.error) {
    throw createError({
      statusCode: 401,
      message: `Forgejo login failed: ${query.error || 'Unknown error'}`,
      data: query,
    })
  }

  if (!config.clientId || !config.clientSecret) {
    // No `data` here: `config` carries `clientSecret`, which must never reach the client.
    throw createError({
      statusCode: 500,
      message: 'Missing Forgejo client ID or secret',
    })
  }

  const requestURL = getRequestURL(event)

  config.redirectURL = config.redirectURL || `${requestURL.protocol}//${requestURL.host}${requestURL.pathname}`

  if (!query.code) {
    // Initial authorization request (generate and store state)
    const state = await generateOAuthState(event)

    config.scope = config.scope || ['write:repository', 'read:user']

    return sendRedirect(
      event,
      withQuery(config.authorizationURL as string, {
        client_id: config.clientId,
        redirect_uri: config.redirectURL,
        response_type: 'code',
        scope: config.scope.join(' '),
        state,
        ...config.authorizationParams,
      }),
    )
  }

  // validate OAuth state and delete the cookie or throw an error
  validateOAuthState(event, query.state as string)

  // TODO: Use a generic STUDIO_GIT_TOKEN for all Git providers
  if (studioConfig.repository.provider !== 'forgejo') {
    throw createError({
      statusCode: 500,
      message: 'Forgejo OAuth provider only supports Forgejo repository provider',
    })
  }

  /**
   * Git provider token validation
   */
  const token = await requestForgejoToken(instanceUrl, {
    grant_type: 'authorization_code',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectURL,
    code: query.code,
  })

  if (token.error || !token.access_token) {
    // Only forward the non-secret error fields: `token` may carry `access_token`/
    // `refresh_token`, which must never reach the client via the error `data`.
    throw createError({
      statusCode: 500,
      message: 'Failed to get access token',
      data: { error: token.error, error_description: token.error_description },
    })
  }

  const accessToken = token.access_token as string

  const user = await fetchForgejoUser(instanceUrl, accessToken)

  if (!user.email && config.emailRequired) {
    // Same as above: never forward `token` (access/refresh token) to the client.
    throw createError({
      statusCode: 500,
      message: 'Could not get Forgejo user email',
    })
  }

  const moderators = studioConfig?.auth?.forgejo?.moderators?.split(',').filter(Boolean) || []
  if (moderators.length > 0 && !moderators.includes(String(user.email))) {
    throw createError({
      statusCode: 403,
      message: 'You are not authorized to access the studio',
    })
  }

  await setInternalStudioUserSession(event, {
    providerId: String(user.id),
    accessToken,
    name: user.full_name || user.login,
    avatar: user.avatar_url,
    email: user.email,
    provider: 'forgejo',
  })

  if (token.refresh_token) {
    await setStudioOAuthTokens(event, {
      refreshToken: token.refresh_token,
      expiresAt: computeExpiresAt(token.expires_in),
    })
  }

  const redirect = decodeURIComponent(getCookie(event, 'studio-redirect') || '/')
  deleteCookie(event, 'studio-redirect')

  // make sure the redirect is a valid relative path (avoid also // which is not a valid URL)
  if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) {
    return sendRedirect(event, redirect)
  }

  return sendRedirect(event, '/')
})
