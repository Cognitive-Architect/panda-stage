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
  return updateImageAssetsAuthorMetadata(rawProject, new Map([[assetId, rawMetadata]]), now);
}

export function updateImageAssetsAuthorMetadata(
  rawProject: Project,
  updates: ReadonlyMap<string, ImageAssetAuthorMetadata>,
  now: () => Date = () => new Date(),
): Project {
  if (!updates.size) return rawProject;
  const project = ProjectSchema.parse(rawProject);
  const assetsById = new Map(project.assets.map((asset) => [asset.id, asset]));
  const changed = new Map<string, z.output<typeof ImageAssetSchema>>();
  for (const [assetId, input] of updates) {
    const asset = assetsById.get(assetId);
    if (!asset) throw new Error('The selected image is no longer in this project.');
    if (asset.kind !== 'image') throw new Error('Only image assets have an author-defined usage.');
    const metadata = ImageAssetAuthorMetadataSchema.parse({ ...input, keywords: normalizeKeywords(input.keywords) });
    if (asset.name === metadata.name && asset.usage === metadata.usage &&
      asset.keywords.length === metadata.keywords.length &&
      asset.keywords.every((keyword, index) => keyword === metadata.keywords[index])) continue;
    changed.set(assetId, ImageAssetSchema.parse({ ...asset, ...metadata }));
  }
  if (!changed.size) return rawProject;
  return ProjectSchema.parse({
    ...project,
    assets: project.assets.map((asset) => changed.get(asset.id) ?? asset),
    updatedAt: now().toISOString(),
  });
}
