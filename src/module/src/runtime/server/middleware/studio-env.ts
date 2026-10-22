import { defineEventHandler } from 'h3'
import { useRuntimeConfig } from '#imports'
import { createHash } from 'node:crypto'
import { defu } from 'defu'
import { detectRepositoryFromCI } from '../utils/repository'
import { resolveForgejoRepositoryInstanceUrl } from '../utils/forgejo'

const ciRepository = detectRepositoryFromCI()

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  if (!config.studio) return

  if (config.studio.ai) {
    config.studio.ai.apiKey = config.studio.ai.apiKey || process.env.AI_GATEWAY_API_KEY || ''
  }

  const github = config.studio.auth.github
  if (github) {
    github.clientId = github.clientId || process.env.STUDIO_GITHUB_CLIENT_ID || ''
    github.clientSecret = github.clientSecret || process.env.STUDIO_GITHUB_CLIENT_SECRET || ''
    github.instanceUrl = github.instanceUrl || process.env.STUDIO_GITHUB_INSTANCE_URL || 'https://github.com'
    github.moderators = github.moderators || process.env.STUDIO_GITHUB_MODERATORS || ''
    github.redirectURL = github.redirectURL || process.env.STUDIO_GITHUB_REDIRECT_URL || ''
  }

  const gitlab = config.studio.auth.gitlab
  if (gitlab) {
    gitlab.applicationId = gitlab.applicationId || process.env.STUDIO_GITLAB_APPLICATION_ID || ''
    gitlab.applicationSecret = gitlab.applicationSecret || process.env.STUDIO_GITLAB_APPLICATION_SECRET || ''
    gitlab.instanceUrl = gitlab.instanceUrl || process.env.STUDIO_GITLAB_INSTANCE_URL || 'https://gitlab.com'
    gitlab.moderators = gitlab.moderators || process.env.STUDIO_GITLAB_MODERATORS || ''
    gitlab.redirectURL = gitlab.redirectURL || process.env.STUDIO_GITLAB_REDIRECT_URL || ''
  }

  const forgejo = config.studio.auth.forgejo
  if (forgejo) {
    forgejo.clientId = forgejo.clientId || process.env.STUDIO_FORGEJO_CLIENT_ID || ''
    forgejo.clientSecret = forgejo.clientSecret || process.env.STUDIO_FORGEJO_CLIENT_SECRET || ''
    // No instance default here (unlike github/gitlab): an empty default lets the auth route fall
    // back to `repository.instanceUrl`, then 'https://codeberg.org', without this value overriding it.
    forgejo.instanceUrl = forgejo.instanceUrl || process.env.STUDIO_FORGEJO_INSTANCE_URL || ''
    forgejo.moderators = forgejo.moderators || process.env.STUDIO_FORGEJO_MODERATORS || ''
    forgejo.redirectURL = forgejo.redirectURL || process.env.STUDIO_FORGEJO_REDIRECT_URL || ''
  }

  const google = config.studio.auth.google
  if (google) {
    google.clientId = google.clientId || process.env.STUDIO_GOOGLE_CLIENT_ID || ''
    google.clientSecret = google.clientSecret || process.env.STUDIO_GOOGLE_CLIENT_SECRET || ''
    google.moderators = google.moderators || process.env.STUDIO_GOOGLE_MODERATORS || ''
    google.redirectURL = google.redirectURL || process.env.STUDIO_GOOGLE_REDIRECT_URL || ''
  }

  const sso = config.studio.auth.sso
  if (sso) {
    sso.serverUrl = sso.serverUrl || process.env.STUDIO_SSO_URL || ''
    sso.clientId = sso.clientId || process.env.STUDIO_SSO_CLIENT_ID || ''
    sso.clientSecret = sso.clientSecret || process.env.STUDIO_SSO_CLIENT_SECRET || ''
    sso.redirectURL = sso.redirectURL || process.env.STUDIO_SSO_REDIRECT_URL || ''
  }

  if (config.studio.git) {
    config.studio.git.githubToken = config.studio.git.githubToken || process.env.STUDIO_GITHUB_TOKEN || ''
    config.studio.git.gitlabToken = config.studio.git.gitlabToken || process.env.STUDIO_GITLAB_TOKEN || ''
    config.studio.git.forgejoToken = config.studio.git.forgejoToken || process.env.STUDIO_FORGEJO_TOKEN || ''
  }

  if (config.studio.media && !config.studio.media.publicUrl) {
    config.studio.media.publicUrl = process.env.S3_PUBLIC_URL || ''
  }

  if (config.public?.studio?.ai) {
    config.public.studio.ai.enabled = Boolean(config.studio.ai?.apiKey)
  }

  if (ciRepository && config.public?.studio?.repository !== undefined) {
    const { provider: detectedProvider, ...detectedWithoutProvider } = ciRepository
    config.public.studio.repository = defu(detectedWithoutProvider, config.public.studio.repository)
    config.studio.repository = defu(detectedWithoutProvider, config.studio.repository)
    if (!config.public.studio.repository.provider && detectedProvider) {
      config.public.studio.repository.provider = detectedProvider
    }
    if (!config.studio.repository.provider && detectedProvider) {
      config.studio.repository.provider = detectedProvider
    }
  }

  // The browser-side Git provider only reads the public `repository.instanceUrl` (it has no
  // access to `auth.forgejo.instanceUrl`, which is server-only). If someone only configured the
  // auth instance URL (e.g. via NUXT_STUDIO_AUTH_FORGEJO_INSTANCE_URL), copy it into the public
  // and private repository config so OAuth and Git API calls target the same instance.
  if (config.public?.studio?.repository?.provider === 'forgejo') {
    const forgejoInstanceUrl = resolveForgejoRepositoryInstanceUrl(
      config.studio.auth.forgejo?.instanceUrl,
      config.public.studio.repository.instanceUrl,
    )
    if (forgejoInstanceUrl) {
      config.public.studio.repository.instanceUrl = forgejoInstanceUrl
      config.studio.repository.instanceUrl = forgejoInstanceUrl
    }
  }

  if (!config.studio.auth.sessionSecret) {
    const credValues = [
      config.studio.auth.github?.clientId,
      config.studio.auth.github?.clientSecret,
      config.studio.auth.gitlab?.applicationId,
      config.studio.auth.gitlab?.applicationSecret,
      config.studio.auth.forgejo?.clientId,
      config.studio.auth.forgejo?.clientSecret,
      config.studio.auth.google?.clientId,
      config.studio.auth.google?.clientSecret,
      config.studio.auth.sso?.serverUrl,
      config.studio.auth.sso?.clientId,
      config.studio.auth.sso?.clientSecret,
      config.studio.git?.githubToken,
      config.studio.git?.gitlabToken,
      config.studio.git?.forgejoToken,
    ]
    if (credValues.some(Boolean)) {
      config.studio.auth.sessionSecret = createHash('md5').update(credValues.join('')).digest('hex')
    }
  }
})
