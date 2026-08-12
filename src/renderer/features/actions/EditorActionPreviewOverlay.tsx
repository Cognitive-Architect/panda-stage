import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Project, Shot } from '../../../domain';
import type { StageAssetUrlMap } from '../../../shared/stage/render-model';
import { listProductPreviewAssetIds } from '../../shell/productPreviewModel';
import { CanvasStage } from '../../stage/CanvasStage';
import { resolvePreviewCanvasPixelRatio } from '../../stage/konva-pixel-ratio';
import {
  editorActionPreviewStore,
} from './editorActionPreviewStore';
import {
  evaluatePreviewFrame,
  isPreviewIdentityMatch,
  isPreviewSceneRenderable,
  type EditorActionPreviewIdentity,
} from './editorActionPreviewModel';
import { useEditorActionPreview } from './useEditorActionPreview';

interface EditorActionPreviewOverlayProps {
  /** Read-only formal project (already loaded in the editor). */
  project: Project | null;
  /** Selected shot id in the editor. */
  shotId: string | null;
  /** Currently selected (non-background) layer id, or null. */
  selectedLayerId: string | null;
  /** Project folder used to read the active preview's image sources. */
  projectRoot: string;
}

/**
 * Transient, read-only editor preview of an applied ActionPreset.
 *
 * Mirrors the ProductPreviewOverlay contract: it reuses the FORMAL evaluator
 * (`evaluatePreviewFrame` -> `evaluateShotAtTime`) and the FORMAL renderer
 * (`stage/CanvasStage` -> `StageRenderer`), owns only its own clock, and never
 * touches the project, revision, dirty flag, selection or history. The project
 * arrives as a read-only prop. It is mounted only while a preview session is
 * active and unmounts on stop, so the ordinary editor canvas (base-layer render
 * path) is restored with no residue.
 */
export function EditorActionPreviewOverlay({
  project,
  shotId,
  selectedLayerId,
  projectRoot,
}: EditorActionPreviewOverlayProps): React.JSX.Element | null {
  const preview = useEditorActionPreview();

  const shot: Shot | null =
    project?.shots.find((candidate) => candidate.id === shotId) ?? null;

  // Stop the preview if the editor context changes mid-playback. This enforces
  // C3-style identity isolation: switching layer/shot/project must never let a
  // preview silently apply to the wrong object.
  const identity: EditorActionPreviewIdentity = {
    projectId: project?.id ?? null,
    shotId,
    layerId: selectedLayerId,
  };
  useEffect(() => {
    if (!preview.active || !preview.session) return;
    if (!isPreviewIdentityMatch(preview.session, identity)) {
      editorActionPreviewStore.stop();
    }
  }, [
    preview.active,
    preview.session,
    identity.projectId,
    identity.shotId,
    identity.layerId,
  ]);

  const assetUrls = useEditorActionPreviewAssets(projectRoot, project, shot);
  const evaluatedShot =
    project && shot
      ? evaluatePreviewFrame(project, shot, preview.timeMs, preview.session ?? undefined)
      : null;
  const assetSourceKey = Object.entries(assetUrls)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([assetId, sourceUrl]) => `${assetId}\u0000${sourceUrl ?? ''}`)
    .join('\u0001');
  const previewRenderKey = [
    preview.runId,
    identity.projectId ?? '',
    identity.shotId ?? '',
    preview.session?.startMs ?? '',
    preview.session?.endMs ?? '',
    preview.session?.eventIds?.join(',') ?? '',
    preview.session?.positionBaseline
      ? `${preview.session.positionBaseline.x},${preview.session.positionBaseline.y}`
      : '',
    assetSourceKey,
  ].join('\u0000');
  const [readyRenderKey, setReadyRenderKey] = useState<string | null>(null);
  const previewStageReady = readyRenderKey === previewRenderKey;
  const previewPixelRatio = resolvePreviewCanvasPixelRatio(
    typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
  );
  const handlePreviewReady = useCallback(() => {
    // A valid first frame is the deterministic authority boundary. Keep the
    // bounded action pinned at startMs until this exact Apply/Replay run is
    // ready; stale renderer callbacks cannot start a replacement run.
    if (editorActionPreviewStore.beginPlayback(preview.runId)) {
      setReadyRenderKey(previewRenderKey);
    }
  }, [preview.runId, previewRenderKey]);
  const handlePreviewError = useCallback(() => {
    setReadyRenderKey((current) =>
      current === previewRenderKey ? null : current,
    );
  }, [previewRenderKey]);

  // Inactive or missing context: render nothing -> editor base render restored.
  //
  // Issue #168 (A): the scene must also be *renderable* before the formal
  // StageRenderer is mounted. The asset map is filled asynchronously and starts
  // empty on every start/replay, and the formal render model throws
  // MISSING_ASSET_URL for the first layer without a URL — which the renderer
  // shows as the red "舞台无法渲染" surface. Gating here means the preview never
  // transitions through that invalid state; until the scene is complete the
  // ordinary editor render path simply stays on screen.
  if (
    !preview.active ||
    !preview.session ||
    !project ||
    !shot ||
    !evaluatedShot ||
    !isPreviewSceneRenderable(evaluatedShot, assetUrls)
  ) {
    return null;
  }

  return (
    <div
      className="editor-action-preview"
      data-preview-active="true"
      data-preview-authoritative={String(previewStageReady)}
      data-preview-playing={String(preview.playing)}
      data-preview-run-id={preview.runId}
      data-preview-pixel-ratio={previewPixelRatio}
      data-preview-source="original-canvas-image-preferred"
      data-preview-time={preview.timeMs}
      data-testid="editor-action-preview"
      style={{
        bottom: 0,
        left: 0,
        pointerEvents: 'none',
        position: 'absolute',
        right: 0,
        top: 0,
        // StageRenderer mounts hidden and reports its first valid frame via
        // onReady. Until then the sharp editor canvas remains authoritative.
        visibility: previewStageReady ? 'visible' : 'hidden',
        zIndex: 20,
      }}
    >
      <CanvasStage
        assetUrls={assetUrls}
        caption={null}
        evaluatedShot={evaluatedShot}
        onError={handlePreviewError}
        onReady={handlePreviewReady}
        pixelRatio={previewPixelRatio}
        project={project}
      />
    </div>
  );
}

/**
 * Loads one source URL per image asset the shot can show, for the formal
 * `StageRenderer`. Read-only: it prefers the existing original-byte canvas
 * image IPC, with the thumbnail read as an explicit last-resort fallback. The
 * original-byte URLs are revoked when the overlay unmounts or reloads, so the
 * bounded preview does not retain a second asset cache. Reuses the same asset
 * enumeration as Product Preview.
 */
function useEditorActionPreviewAssets(
  projectRoot: string,
  project: Project | null,
  shot: Shot | null,
): StageAssetUrlMap {
  const [urls, setUrls] = useState<StageAssetUrlMap>({});
  const assetIds = useMemo(
    () => (project && shot ? listProductPreviewAssetIds(project, shot) : []),
    [project, shot],
  );
  const key = assetIds.join('|');

  useEffect(() => {
    if (!project || !projectRoot || assetIds.length === 0) {
      setUrls({});
      return;
    }
    let active = true;
    const objectUrls = new Set<string>();

    const readAssetSource = async (
      assetId: string,
      sha256: string,
    ): Promise<string | undefined> => {
      try {
        const response = await window.pandaStage.assets.readCanvasImage({
          projectRoot,
          assetId,
          sha256,
        });
        if (response.ok && response.status === 'ready') {
          const objectUrl = URL.createObjectURL(
            new Blob([response.bytes], { type: response.mimeType }),
          );
          if (!active) {
            URL.revokeObjectURL(objectUrl);
            return undefined;
          }
          objectUrls.add(objectUrl);
          return objectUrl;
        }
      } catch {
        // Fall through to the bounded thumbnail fallback below.
      }

      try {
        const response = await window.pandaStage.assets.readThumbnail({
          projectRoot,
          assetId,
          sha256,
        });
        if (response.ok && response.status === 'ready') {
          return response.dataUrl;
        }
      } catch {
        // Missing assets stay absent and keep the formal scene gated.
      }
      return undefined;
    };

    const requests = assetIds.map(async (assetId) => {
      const asset = project.assets.find(
        (candidate) => candidate.id === assetId,
      );
      if (!asset || asset.kind !== 'image' || !asset.sha256) {
        return [assetId, undefined] as const;
      }
      return [assetId, await readAssetSource(assetId, asset.sha256)] as const;
    });
    void Promise.all(requests).then((entries) => {
      if (!active) return;
      const next: Record<string, string | undefined> = {};
      for (const [assetId, dataUrl] of entries) {
        if (dataUrl) next[assetId] = dataUrl;
      }
      setUrls(next);
    });
    return () => {
      active = false;
      for (const objectUrl of objectUrls) {
        URL.revokeObjectURL(objectUrl);
      }
      objectUrls.clear();
    };
  }, [key, project, projectRoot]);

  return urls;
}
