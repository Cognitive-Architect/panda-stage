/**
 * Minimal runnable PixiJS v8 (tested against pixi.js@8.0.5) consumer helper
 * for loading Panda Stage single-page or multi-page sprite-sheet exports.
 *
 * Usage in a browser/PixiJS v8 app:
 *   import { Assets, AnimatedSprite } from 'pixi.js';
 *   import { loadPandaPixiAnimation } from './pixi-multipack-consumer.mjs';
 *
 *   const { textures, fps } = await loadPandaPixiAnimation(Assets, '/exports/walk/sprite-sheet.json');
 *   const sprite = new AnimatedSprite(textures);
 *   sprite.animationSpeed = fps / 60;
 *   sprite.play();
 */

export function collectPixiMultiPackTextures(rootSheet) {
  const byName = new Map();
  const visited = new Set();
  const stack = [rootSheet];
  while (stack.length > 0) {
    const sheet = stack.pop();
    if (!sheet || visited.has(sheet)) continue;
    visited.add(sheet);
    for (const [name, texture] of Object.entries(sheet.textures ?? {})) {
      if (texture !== undefined && !byName.has(name)) {
        byName.set(name, texture);
      }
    }
    if (Array.isArray(sheet.linkedSheets)) {
      for (let i = sheet.linkedSheets.length - 1; i >= 0; i -= 1) {
        stack.push(sheet.linkedSheets[i]);
      }
    }
  }
  return byName;
}

export function assemblePixiAnimationTextures(rootSheet, orderedFrameNames) {
  const textureMap = collectPixiMultiPackTextures(rootSheet);
  const textures = [];
  for (const frameName of orderedFrameNames) {
    const texture = textureMap.get(frameName);
    if (!texture) {
      throw new Error(`Missing frame texture "${frameName}" across linked PixiJS sheets.`);
    }
    textures.push(texture);
  }
  return textures;
}

/**
 * Loads either a single-page PixiJS `sprite-sheet.json` or a multi-page
 * Panda master manifest (`format === 'panda-sprite-sheet-master'`) via PixiJS v8 `Assets`.
 */
export async function loadPandaPixiAnimation(Assets, manifestUrl, animationName) {
  const response = await globalThis.fetch(manifestUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch manifest ${manifestUrl}: ${response.status}`);
  }
  const manifest = await response.json();

  if (manifest.format === 'panda-sprite-sheet-master') {
    const baseHref = globalThis.location?.href ?? 'http://localhost/';
    const entryUrl = new globalThis.URL(
      manifest.pixiEntry,
      new globalThis.URL(manifestUrl, baseHref),
    ).href;
    // PixiJS v8 automatically resolves `meta.related_multi_packs` into `rootSheet.linkedSheets`.
    const rootSheet = await Assets.load(entryUrl);
    const resolvedName = animationName ?? manifest.animationName ?? Object.keys(manifest.animations ?? {})[0] ?? 'clip';
    const frameNames = manifest.animations?.[resolvedName] ?? manifest.frames.map((frame) => frame.name);
    const textures = assemblePixiAnimationTextures(rootSheet, frameNames);
    return {
      animationName: resolvedName,
      frameNames,
      textures,
      fps: manifest.meta?.fps ?? 24,
      rootSheet,
    };
  }

  // Single-page PixiJS sheet: native `sheet.animations[name]` contains only local textures.
  const sheet = await Assets.load(manifestUrl);
  const resolvedName = animationName ?? Object.keys(sheet.animations ?? {})[0] ?? 'clip';
  const textures = sheet.animations?.[resolvedName] ?? Object.values(sheet.textures ?? {});
  return {
    animationName: resolvedName,
    frameNames: Object.keys(sheet.textures ?? {}),
    textures,
    fps: 24,
    rootSheet: sheet,
  };
}
