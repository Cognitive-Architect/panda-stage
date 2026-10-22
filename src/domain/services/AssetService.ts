import { z } from 'zod';
import {
  AssetKeywordsSchema,
  ImageAssetSchema,
  ImageAssetUsageSchema,
  type ImageAssetUsage,
} from '../models/asset';
import { NameSchema } from '../models/common';
import { ProjectSchema, type Project } from '../models/project';

const ImageAssetAuthorMetadataSchema = z
  .object({
    name: NameSchema,
    usage: ImageAssetUsageSchema,
    keywords: AssetKeywordsSchema,
  })
  .strict();

export interface ImageAssetAuthorMetadata {
  readonly name: string;
  readonly usage: ImageAssetUsage;
  readonly keywords: readonly string[];
}

function normalizeKeywords(keywords: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of keywords) {
    const keyword = value.trim();
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(keyword);
  }
  return normalized;
}

/** Returns one validated project update for an explicitly selected image. */
export function updateImageAssetAuthorMetadata(
  rawProject: Project,
  assetId: string,
  rawMetadata: ImageAssetAuthorMetadata,
  now: () => Date = () => new Date(),
): Project {
  const project = ProjectSchema.parse(rawProject);
  const assetIndex = project.assets.findIndex(
    (asset) => asset.id === assetId,
  );
  if (assetIndex < 0) {
    throw new Error('The selected image is no longer in this project.');
  }
  const asset = project.assets[assetIndex]!;
  if (asset.kind !== 'image') {
    throw new Error('Only image assets have an author-defined usage.');
  }

  const metadata = ImageAssetAuthorMetadataSchema.parse({
    ...rawMetadata,
    keywords: normalizeKeywords(rawMetadata.keywords),
  });
  if (
    asset.name === metadata.name &&
    asset.usage === metadata.usage &&
    asset.keywords.length === metadata.keywords.length &&
    asset.keywords.every(
      (keyword, index) => keyword === metadata.keywords[index],
    )
  ) {
    return project;
  }
  const assets = [...project.assets];
  assets[assetIndex] = ImageAssetSchema.parse({
    ...asset,
    ...metadata,
  });
  return ProjectSchema.parse({
    ...project,
    assets,
    updatedAt: now().toISOString(),
  });
}
