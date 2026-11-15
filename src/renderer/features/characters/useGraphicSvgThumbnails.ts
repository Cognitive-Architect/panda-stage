import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImageAsset, Project } from '../../../domain';
import { isGeneratedFlaSvgAsset } from '../../../domain/selectors/isGeneratedFlaSvgAsset';
import { thumbnailStateAfterDecodeError, type ThumbnailState } from '../assets/AssetCard';
import { CanvasImageResourceSession, canvasImageResourceKey, type CanvasImageState } from '../canvas/canvasImageResources';

/** A thin card adapter: Canvas Image owns SVG reads, Blob decode, deduplication and revoke. */
export function useGraphicSvgThumbnails(projectRoot: string | null, project: Project | null, assets: readonly ImageAsset[]) {
  const svgAssets = useMemo(() => project ? assets.filter(asset => isGeneratedFlaSvgAsset(project, asset)) : [], [assets, project]);
  const idKey = svgAssets.map(asset => asset.id).join('|');
  const assetIds = useMemo(() => new Set(idKey ? idKey.split('|') : []), [idKey]);
  const contextKey = projectRoot && project ? `${project.id}\u0000${projectRoot}` : null;
  const latestAssets = useRef(svgAssets);
  latestAssets.current = svgAssets;
  const active = useRef<{
    session: CanvasImageResourceSession;
    errors: Map<string, ThumbnailState>;
    readySources: Set<string>;
    notify: (state: CanvasImageState) => void;
  } | null>(null);
  const [view, setView] = useState<{
    contextKey: string | null;
    entries: Record<string, { sha256?: string; state: ThumbnailState }>;
  }>({ contextKey: null, entries: {} });

  useEffect(() => {
    if (!contextKey || !projectRoot) return;
    const errors = new Map<string, ThumbnailState>();
    const readySources = new Set<string>();
    const session = new CanvasImageResourceSession({
      readCanvasImage: async request => {
        const key = canvasImageResourceKey(request.assetId, request.sha256);
        try {
          const response = await window.pandaStage.assets.readCanvasImage(request);
          if (response.ok) readySources.add(key);
          else errors.set(key, {
            status: 'missing',
            reason: response.error.code === 'ASSET_CANVAS_IMAGE_SOURCE_MISSING' ? 'source' : 'error',
            failureLayer: 'backend', errorCode: response.error.code,
            message: response.error.message,
            relativePath: response.error.relativePath ?? latestAssets.current.find(asset => asset.id === request.assetId)?.relativePath,
          });
          return response;
        } catch (error) {
          errors.set(key, { status: 'missing', reason: 'error', message: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      },
    });
    const notify = (state: CanvasImageState): void => {
      const entries: Record<string, { sha256?: string; state: ThumbnailState }> = {};
      for (const asset of latestAssets.current) {
        const key = canvasImageResourceKey(asset.id, asset.sha256 ?? '');
        const image = state.sourceKeys.get(asset.id) === asset.sha256 ? state.images.get(asset.id) : undefined;
        const failure = state.missing.has(asset.id)
          ? readySources.has(key)
            ? thumbnailStateAfterDecodeError({ status: 'ready', dataUrl: '' }, asset.relativePath)
            : { status: 'missing' as const, reason: 'error' as const }
          : undefined;
        entries[asset.id] = { sha256: asset.sha256, state: errors.get(key) ?? failure ??
          (image ? { status: 'ready', dataUrl: image.src } : { status: 'loading' }) };
      }
      setView({ contextKey, entries });
    };
    active.current = { session, errors, readySources, notify };
    return () => { session.dispose(); active.current = null; };
  }, [contextKey, projectRoot]);

  useEffect(() => {
    const owner = active.current;
    if (!owner) return;
    const desired = new Set(svgAssets.map(asset => canvasImageResourceKey(asset.id, asset.sha256 ?? '')));
    for (const key of owner.errors.keys()) if (!desired.has(key)) owner.errors.delete(key);
    for (const key of owner.readySources) if (!desired.has(key)) owner.readySources.delete(key);
    owner.session.reconcile({ contextKey, projectRoot, assets: svgAssets }, owner.notify);
  }, [contextKey, projectRoot, svgAssets]);

  const onThumbnailError = useCallback((assetId: string): void => {
    const owner = active.current;
    const asset = latestAssets.current.find(item => item.id === assetId);
    if (!owner || !asset) return;
    const key = canvasImageResourceKey(asset.id, asset.sha256 ?? '');
    const snapshot = owner.session.getSnapshot();
    if (!snapshot.readyResourceKeys.has(key)) return;
    owner.errors.set(key, thumbnailStateAfterDecodeError({ status: 'ready', dataUrl: '' }, asset.relativePath));
    owner.notify(snapshot);
  }, []);

  const thumbnails: Record<string, ThumbnailState> = {};
  for (const asset of svgAssets) {
    const entry = view.contextKey === contextKey ? view.entries[asset.id] : undefined;
    thumbnails[asset.id] = entry && entry.sha256 === asset.sha256 ? entry.state : { status: 'loading' };
  }
  return { assetIds, thumbnails, onThumbnailError };
}
