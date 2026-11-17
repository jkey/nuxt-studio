import type { DraftStatus } from './draft'
import type { StudioFeature } from '../types'

export type GitProviderType = 'github' | 'gitlab' | 'forgejo'

export interface Repository {
  provider: GitProviderType | null
  owner: string
  repo: string
  branch: string
  rootDir: string
  /**
   * Can be used to specify the instance URL for self-hosted GitLab instances.
   * @default 'https://gitlab.com'
   */
  instanceUrl?: string
}

export interface GitBaseOptions {
  owner: string
  repo: string
  branch: string
  authorName: string
  authorEmail: string
}

export interface GitOptions extends GitBaseOptions {
  provider: GitProviderType | null
  rootDir: string
  token: string
  instanceUrl?: string
  /**
   * Returns a fresh access token (used by providers to retry a request after a 401).
   * Called once when a request fails with a 401, to obtain a new access token for a single
   * retry. Returns `null` when the token cannot be refreshed (e.g. no refresh token stored,
   * or the refresh itself failed), in which case the original 401 is surfaced as-is.
   */
  refreshToken?: () => Promise<string | null>
}

export interface CommitFilesOptions extends GitBaseOptions {
  files: RawFile[]
  message: string
}

export interface RawFile {
  path: string
  content: string | null
  status: DraftStatus
  encoding?: 'utf-8' | 'base64'
}

export interface GitProviderAPI {
  fetchFile(path: string, options?: { cached?: boolean }): Promise<GitFile | null>
  commitFiles(files: RawFile[], message: string): Promise<CommitResult | null>
  getRepositoryUrl(): string
  getBranchUrl(): string
  getCommitUrl(sha: string): string
  getFileUrl(feature: StudioFeature, fsPath: string): string
  getRepositoryInfo(): { owner: string, repo: string, branch: string, provider: GitProviderType | null }
}

export interface CommitResult {
  success: boolean
  commitSha: string
  url: string
}

export interface GitFile {
  provider: GitProviderType
  name: string
  path: string
  sha: string
  size: number
  url: string
  content?: string
  encoding?: 'utf-8' | 'base64'
}

export interface GithubFile extends GitFile {
  html_url: string
  git_url: string
  download_url: string
  type: string
  _links: {
    self: string
    git: string
    html: string
  }
}

export interface GitLabFile extends GitFile {
  file_path: string
  ref: string
  blob_id: string
  commit_id: string
  last_commit_id: string
}

export interface ForgejoFile extends GitFile {
  html_url: string
  download_url: string
  type: string
}
