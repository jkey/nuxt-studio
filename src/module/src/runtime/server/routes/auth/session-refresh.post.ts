import { useRuntimeConfig } from '#imports'
import type { H3Event } from 'h3'
import { createError, eventHandler } from 'h3'
import { getStudioOAuthTokens, getStudioSessionUser, setStudioOAuthTokens, updateStudioUserAccessToken } from '../../utils/oauth-session'
import { computeExpiresAt, getForgejoInstanceUrl, requestForgejoToken } from '../../utils/forgejo'

export default eventHandler(async (event: H3Event) => {
  const user = await getStudioSessionUser(event)

  if (!user) {
    throw createError({
      statusCode: 401,
      message: 'Not authenticated',
    })
  }

  const oauth = await getStudioOAuthTokens(event)

  if (user.provider !== 'forgejo' || !oauth?.refreshToken) {
    throw createError({
      statusCode: 400,
      message: 'Token refresh not supported',
    })
  }

  const studioConfig = useRuntimeConfig(event).studio
  const forgejoConfig = studioConfig?.auth?.forgejo ?? {}
  const instanceUrl = getForgejoInstanceUrl(forgejoConfig.instanceUrl, studioConfig?.repository?.instanceUrl)

  if (!forgejoConfig.clientId || !forgejoConfig.clientSecret) {
    // No `data` here: `forgejoConfig` carries `clientSecret`, which must never reach the client.
    throw createError({
      statusCode: 500,
      message: 'Missing Forgejo client ID or secret',
    })
  }

  const token = await requestForgejoToken(instanceUrl, {
    grant_type: 'refresh_token',
    refresh_token: oauth.refreshToken,
    client_id: forgejoConfig.clientId,
    client_secret: forgejoConfig.clientSecret,
  })

  if (token.error || !token.access_token) {
    // Only forward the non-secret error fields: `token` may carry `access_token`/
    // `refresh_token`, which must never reach the client via the error `data`.
    throw createError({
      statusCode: 401,
      message: 'Failed to refresh access token',
      data: { error: token.error, error_description: token.error_description },
    })
  }

  await updateStudioUserAccessToken(event, token.access_token)

  await setStudioOAuthTokens(event, {
    refreshToken: token.refresh_token || oauth.refreshToken,
    expiresAt: computeExpiresAt(token.expires_in),
  })

  return { accessToken: token.access_token }
})
