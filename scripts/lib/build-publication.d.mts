import type { Plugin } from 'vite'

export interface PublicationAsset {
  source: string
  path: string
  sha256: string
  mediaType: string
  approval: string
  bytes: Buffer
}

export function loadPublicationAssets(repositoryRoot: string): PublicationAsset[]
export function publicationAssetsPlugin(): Plugin
