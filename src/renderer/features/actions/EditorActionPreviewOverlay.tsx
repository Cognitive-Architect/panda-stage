import { useEffect, useMemo, useState } from 'react';
import type { Project, Shot } from '../../../domain';
import type { StageAssetUrlMap } from '../../../shared/stage/render-model';
import { listProductPreviewAssetIds } from '../../shell/productPreviewModel';
import { CanvasStage } from '../../stage/CanvasStage';
import {
  editorActionPreviewStore,
} from './editorActionPreviewStore';
import {
  evaluatePreviewFrame,
  isPreviewIdentityMatch,
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
  /** Project folder used to read thumbnail data URLs for preview rendering. */
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
      ? evaluatePreviewFrame(project, shot, preview.timeMs)
      : null;

  // Inactive or missing context: render nothing -> editor base render restored.
  if (
    !preview.active ||
    !preview.session ||
    !project ||
    !shot ||
    !evaluatedShot
  ) {
    return null;
  }

  return (
    <div
      className="editor-action-preview"
      data-preview-active="true"
      data-preview-time={preview.timeMs}
      data-testid="editor-action-preview"
      style={{
        bottom: 0,
        left: 0,
        pointerEvents: 'none',
        position: 'absolute',
        right: 0,
        top: 0,
        zIndex: 20,
      }}
    >
      <CanvasStage
        assetUrls={assetUrls}
        caption={null}
        evaluatedShot={evaluatedShot}
        project={project}
      />
    </div>
  );
}

/**
 * Loads one data URL per image asset the shot can show, for the formal
 * `StageRenderer`. Read-only: it calls the existing thumbnail read IPC and keeps
 * the result in overlay-local state. Missing assets simply stay absent. The
 * overlay unmounts on stop, which cleans this effect up. Reuses the same asset
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
    if (!project || assetIds.length === 0) {
      setUrls({});
      return;
    }
    let active = true;
    const requests = assetIds.map(async (assetId) => {
      const asset = project.assets.find(
        (candidate) => candidate.id === assetId,
      );
      if (!asset || asset.kind !== 'image' || !asset.sha256) {
        return [assetId, undefined] as const;
      }
      try {
        const response = await window.pandaStage.assets.readThumbnail({
          projectRoot,
          assetId,
          sha256: asset.sha256,
        });
        if (!response.ok || response.status !== 'ready') {
          return [assetId, undefined] as const;
        }
        return [assetId, response.dataUrl] as const;
      } catch {
        return [assetId, undefined] as const;
      }
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
    };
  }, [key, project, projectRoot]);

  return urls;
}
