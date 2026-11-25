/**
 * Minimal PixiJS v8 multi-pack animation consumer helper for Panda Stage
 * sprite-sheet exports.
 *
 * Why this helper exists:
 * In PixiJS v8 (verified against pixi.js v8.0.5 `Spritesheet._processAnimations`
 * and `spritesheetAsset.ts`), `sheet.parse()` builds `sheet.animations` strictly
 * from `this.textures` BEFORE the asset loader attaches `sheet.linkedSheets`
 * from `meta.related_multi_packs`. Consequently, placing cross-page frame names
 * in page 0's `animations` field produces `undefined` textures.
 *
 * Single-page PixiJS exports keep native `sheet.animations[name]`.
 * Multi-page PixiJS exports omit cross-page `animations` on individual page
 * JSONs, link pages via `meta.related_multi_packs`, and record the complete
 * ordered frame sequence in Panda's master manifest (`sprite-sheet.json`).
 * Consumers assemble the ordered `Texture[]` across `[rootSheet, ...linkedSheets]`
 * via `assemblePixiMultiPackTextures` or `resolvePixiMultiPackAnimation`.
 */

export const TESTED_PIXI_JS_VERSION = '8.0.5';

export interface PixiLikeSpritesheet<TTexture = unknown> {
  readonly textures: Record<string, TTexture | undefined>;
  readonly animations?: Record<string, readonly TTexture[] | undefined>;
  readonly linkedSheets?: readonly PixiLikeSpritesheet<TTexture>[];
}

export interface PandaSpriteSheetMasterFrame {
  readonly index: number;
  readonly name: string;
  readonly timeMs: number;
  readonly durationMs: number;
  readonly page: number;
  readonly empty: boolean;
}

export interface PandaSpriteSheetMasterManifest {
  readonly format: 'panda-sprite-sheet-master';
  readonly pixiEntry: string;
  readonly pixiSheets: readonly string[];
  readonly animationName: string;
  readonly animations: Record<string, readonly string[]>;
  readonly frames: readonly PandaSpriteSheetMasterFrame[];
}

/**
 * Collects a flat frameName -> Texture map across a PixiJS v8 root Spritesheet
 * and all linked multi-pack sheets (recursively guarding against cycles).
 */
export function collectPixiMultiPackTextureMap<TTexture>(
  rootSheet: PixiLikeSpritesheet<TTexture>,
): Map<string, TTexture> {
  const byName = new Map<string, TTexture>();
  const visited = new Set<PixiLikeSpritesheet<TTexture>>();
  const stack: PixiLikeSpritesheet<TTexture>[] = [rootSheet];

  while (stack.length > 0) {
    const sheet = stack.pop()!;
    if (visited.has(sheet)) continue;
    visited.add(sheet);

    for (const [frameName, texture] of Object.entries(sheet.textures)) {
      if (texture !== undefined && !byName.has(frameName)) {
        byName.set(frameName, texture);
      }
    }

    if (sheet.linkedSheets) {
      for (let i = sheet.linkedSheets.length - 1; i >= 0; i -= 1) {
        const linked = sheet.linkedSheets[i];
        if (linked && !visited.has(linked)) {
          stack.push(linked);
        }
      }
    }
  }

  return byName;
}

/**
 * Assembles an ordered `Texture[]` across a PixiJS v8 root sheet and its
 * `linkedSheets` using stable frame names. Throws if any frame is missing so
 * callers never feed `undefined` into `AnimatedSprite`.
 */
export function assemblePixiMultiPackTextures<TTexture>(
  rootSheet: PixiLikeSpritesheet<TTexture>,
  orderedFrameNames: readonly string[],
): TTexture[] {
  const textureMap = collectPixiMultiPackTextureMap(rootSheet);
  const textures: TTexture[] = [];
  const missing: string[] = [];

  for (const frameName of orderedFrameNames) {
    const texture = textureMap.get(frameName);
    if (texture === undefined) {
      missing.push(frameName);
    } else {
      textures.push(texture);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `PixiJS multi-pack spritesheet is missing ${missing.length} frame texture(s): ${missing.slice(0, 5).join(', ')}`,
    );
  }

  return textures;
}

/**
 * Resolves a named animation (or the master manifest's default animation /
 * ordered `frames` list) into an ordered `Texture[]` across all linked PixiJS
 * v8 sheets.
 */
export function resolvePixiMultiPackAnimation<TTexture>(
  rootSheet: PixiLikeSpritesheet<TTexture>,
  masterManifest: Pick<PandaSpriteSheetMasterManifest, 'animations' | 'frames'> & {
    readonly animationName?: string;
  },
  animationName?: string,
): {
  readonly animationName: string;
  readonly frameNames: string[];
  readonly textures: TTexture[];
} {
  const resolvedName =
    animationName ??
    masterManifest.animationName ??
    Object.keys(masterManifest.animations)[0] ??
    'clip';
  const manifestFrames = masterManifest.animations[resolvedName];
  const frameNames = manifestFrames
    ? [...manifestFrames]
    : masterManifest.frames.map((frame) => frame.name);
  const textures = assemblePixiMultiPackTextures(rootSheet, frameNames);

  return {
    animationName: resolvedName,
    frameNames,
    textures,
  };
}
