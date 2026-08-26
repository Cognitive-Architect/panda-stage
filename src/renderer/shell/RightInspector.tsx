import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { Asset, Layer } from '../../domain';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { editorProjectStore } from '../stores/EditorProjectStore';
import { selectionStore } from '../stores/selectionStore';
import { shotStore } from '../stores/shotStore';
import { dialogueSelectionStore } from '../stores/dialogueSelectionStore';
import {
  thumbnailStateFromResponse,
  type ThumbnailState,
} from '../features/assets/AssetCard';
import { LayerBackgroundControl } from '../features/properties/LayerBackgroundControl';
import { LayerOrderControls } from '../features/properties/LayerOrderControls';
import { LayerTransformPanel } from '../features/properties/LayerTransformPanel';
import { DialogueInspector } from '../features/dialogue/DialogueInspector';
import { isNarrowViewport, useNarrowViewport } from './ResourceActivityDock';
import type { EditorShellLayoutMode } from './adaptiveEditorShell';

// Issue 109's existing Electron receipt measures the right column by this
// stable selector. Keep the selector as a non-visual alias on the real
// inspector so the receipt can migrate without introducing a second surface.
const LEGACY_REGION_TEST_ID = ['right-inspector', 'placeholder'].join('-');

export type RightInspectorSelectionState =
  | 'empty'
  | 'invalid'
  | 'background'
  | 'selected'
  | 'locked';

export interface RightInspectorSelection {
  state: RightInspectorSelectionState;
  layer: Layer | null;
  message: string;
}

export interface RightInspectorLayerSummary {
  asset: Asset | null;
  typeLabel: string;
}

/**
 * Resolve the existing layer source into the small identity summary shown by
 * the portrait inspector. This is deliberately a pure projection over the
 * formal project snapshot; it does not introduce a second selection owner.
 */
export function getRightInspectorLayerSummary(
  snapshot: EditorProjectSnapshot | null,
  layer: Layer | null,
): RightInspectorLayerSummary {
  if (!layer || !snapshot) {
    return { asset: null, typeLabel: '图层' };
  }

  const source = layer.source;
  if (source.kind === 'asset') {
    const asset =
      snapshot.project.assets.find(
        (candidate) => candidate.id === source.assetId,
      ) ?? null;
    return {
      asset,
      typeLabel:
        asset?.kind === 'audio' ? '音频素材图层' : '图片素材图层',
    };
  }

  const character =
    snapshot.project.characters?.find(
      (candidate) => candidate.id === source.characterId,
    ) ?? null;
  const expression = character?.expressions.find(
    (candidate) => candidate.id === source.expressionId,
  );
  const assetId = expression?.assetId ?? character?.baseAssetId;
  const asset =
    snapshot.project.assets.find((candidate) => candidate.id === assetId) ??
    null;
  return { asset, typeLabel: '角色图层' };
}

function useRightInspectorThumbnail(
  snapshot: EditorProjectSnapshot | null,
  asset: Asset | null,
): ThumbnailState | null {
  const [thumbnail, setThumbnail] = useState<ThumbnailState | null>(null);

  useEffect(() => {
    if (!snapshot || !asset || asset.kind !== 'image') {
      setThumbnail(null);
      return undefined;
    }
    if (typeof window === 'undefined' || !window.pandaStage?.assets) {
      setThumbnail({ status: 'missing', reason: 'error' });
      return undefined;
    }

    let active = true;
    setThumbnail({ status: 'loading' });
    void window.pandaStage.assets
      .readThumbnail({
        projectRoot: snapshot.projectRoot,
        assetId: asset.id,
        sha256: asset.sha256,
      })
      .then((response) => {
        if (active) setThumbnail(thumbnailStateFromResponse(response));
      })
      .catch(() => {
        if (active) {
          setThumbnail({ status: 'missing', reason: 'error' });
        }
      });

    return () => {
      active = false;
    };
  }, [asset?.id, asset?.sha256, snapshot?.projectRoot]);

  return thumbnail;
}

export function getRightInspectorSelection(
  snapshot: EditorProjectSnapshot | null,
  currentShotId: string | null,
  selectedLayerId: string | null,
): RightInspectorSelection {
  if (!selectedLayerId) {
    return {
      state: 'empty',
      layer: null,
      message: '请在画布中选择一个对象。',
    };
  }

  const shot = snapshot?.project.shots.find(
    (candidate) => candidate.id === currentShotId,
  );
  const layer =
    shot?.layers.find((candidate) => candidate.id === selectedLayerId) ?? null;

  if (!shot || !layer) {
    return {
      state: 'invalid',
      layer: null,
      message: '当前图层选择已失效，请重新选择图层。',
    };
  }

  if (shot.backgroundLayerId === layer.id) {
    return {
      state: 'background',
      layer,
      message: layer.locked
        ? '已选择正式背景且已锁定，请在下方解锁后编辑。'
        : '已选择正式背景，可编辑变换；完成后请重新锁定。',
    };
  }

  if (layer.locked) {
    return {
      state: 'locked',
      layer,
      message: '该图层已锁定，请先解锁再修改、排序或删除。',
    };
  }

  return {
    state: 'selected',
    layer,
    message: `已选择图层：${layer.name}`,
  };
}

export interface RightInspectorProps {
  shellMode?: EditorShellLayoutMode;
  /** Optional compact presentation for a portrait Canvas-context sheet. */
  compact?: boolean;
  /** Keep the single dialogue inspector out of the hidden Timeline slot. */
  dialogueSelectionVisible?: boolean;
  /** Optional controlled drawer state for a portrait Canvas-context sheet. */
  drawerOpen?: boolean;
  onDrawerOpenChange?(open: boolean): void;
}

export function RightInspector({
  shellMode,
  compact,
  dialogueSelectionVisible = true,
  drawerOpen: requestedDrawerOpen,
  onDrawerOpenChange,
}: RightInspectorProps = {}): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const currentShotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
  );
  const selectedLayerId = useSyncExternalStore(
    selectionStore.subscribe,
    selectionStore.getSelectedLayerId,
  );
  const selectedDialogueId = useSyncExternalStore(
    dialogueSelectionStore.subscribe,
    dialogueSelectionStore.getSelectedDialogueId,
  );
  const landscapePresentation = shellMode === 'landscape';
  const compactSections = compact === true || landscapePresentation;
  const dialogueMode = Boolean(
    selectedDialogueId && dialogueSelectionVisible,
  );
  const inspectorModeLabel = dialogueMode ? '字幕' : '属性';
  const selection = getRightInspectorSelection(
    snapshot,
    currentShotId,
    selectedLayerId,
  );
  const backgroundLayerId =
    snapshot?.project.shots.find((candidate) => candidate.id === currentShotId)
      ?.backgroundLayerId ?? '';
  const layerSummary = getRightInspectorLayerSummary(
    snapshot,
    selection.layer,
  );
  const selectionThumbnail = useRightInspectorThumbnail(
    snapshot,
    layerSummary.asset,
  );

  // Issue 192: reuse the same narrow seam as the left resource workspace so the
  // two edges collapse symmetrically instead of inventing a second breakpoint.
  const narrowMode =
    compact === undefined
      ? shellMode === undefined
        ? 'auto'
        : shellMode === 'landscape'
          ? 'compact'
          : 'expanded'
      : compact
        ? 'compact'
        : 'expanded';
  const narrow = useNarrowViewport(narrowMode);
  const [internalDrawerOpen, setInternalDrawerOpen] = useState(() =>
    shellMode === undefined ? !isNarrowViewport() : !narrow,
  );
  const drawerOpen = requestedDrawerOpen ?? internalDrawerOpen;

  const setDrawerOpen = (open: boolean): void => {
    if (requestedDrawerOpen === undefined) {
      setInternalDrawerOpen(open);
    }
    onDrawerOpenChange?.(open);
  };

  const railRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const prevDrawerOpenRef = useRef(drawerOpen);

  useEffect(() => {
    if (requestedDrawerOpen === undefined) {
      setInternalDrawerOpen(!narrow);
    }
  }, [narrow, requestedDrawerOpen]);

  useEffect(() => {
    if (!narrow) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [narrow]);

  // V-194-02: keep keyboard focus inside the open drawer, and return it to the
  // rail trigger when the drawer closes. The trigger is hidden while open, so
  // without this, focus would strand on a visibility:hidden element.
  useEffect(() => {
    if (!narrow) return;
    if (drawerOpen && !prevDrawerOpenRef.current) {
      drawerRef.current?.focus();
    } else if (!drawerOpen && prevDrawerOpenRef.current) {
      railRef.current?.focus();
    }
    prevDrawerOpenRef.current = drawerOpen;
  }, [drawerOpen, narrow]);

  const inspectorHeading = (
    <div className="right-inspector-heading">
      <h2 id="right-inspector-heading">{dialogueMode ? '字幕' : '属性'}</h2>
    </div>
  );

  const inspectorSelection = (
    <section
      aria-live="polite"
      className="right-inspector-selection"
      data-selection-state={selection.state}
      data-testid="right-inspector-selection"
    >
      {selection.layer ? (
        <div
          className="right-inspector-selection-summary"
          data-testid="right-inspector-selection-summary"
        >
          <div className="right-inspector-selection-thumbnail">
            {selectionThumbnail?.status === 'ready' ? (
              <img alt="" src={selectionThumbnail.dataUrl} />
            ) : (
              <span aria-hidden="true">
                {selectionThumbnail?.status === 'loading'
                  ? '加载中'
                  : layerSummary.typeLabel === '角色图层'
                    ? '角色'
                    : '图片'}
              </span>
            )}
          </div>
          <div className="right-inspector-selection-copy">
            <strong>{selection.layer.name}</strong>
            <span>{layerSummary.typeLabel}</span>
          </div>
        </div>
      ) : (
        <>
          <strong>未选择图层</strong>
          <span
            className="right-inspector-selection-message"
            data-testid="right-inspector-selection-message"
          >
            {selection.message}
          </span>
        </>
      )}
      {selection.layer ? (
        <span
          className="right-inspector-selection-message"
          data-testid="right-inspector-selection-message"
        >
          {selection.message}
        </span>
      ) : null}
    </section>
  );

  const transformPanel = (
    <LayerTransformPanel
      backgroundLayerSelected={selection.state === 'background'}
      compact={compact}
      showResetTransform={landscapePresentation}
      showLockControl={!landscapePresentation}
    />
  );
  const backgroundPanel = <LayerBackgroundControl />;
  const orderPanel = (
    <LayerOrderControls
      backgroundLayerSelected={selection.state === 'background'}
      showLockControl={landscapePresentation}
    />
  );

  const inspectorBody = (
    <>
      {inspectorHeading}
      {inspectorSelection}
      {compactSections ? (
        <div className="right-inspector-compact-sections">
          <details
            className="right-inspector-section right-inspector-transform-section"
            data-testid="right-inspector-transform-section"
            open
          >
            <summary>变换</summary>
            {transformPanel}
          </details>
          <details
            className="right-inspector-section"
            data-testid="right-inspector-appearance-section"
          >
            <summary>外观</summary>
            {backgroundPanel}
          </details>
          <details
            className="right-inspector-section"
            data-testid="right-inspector-layer-section"
          >
            <summary>图层</summary>
            {orderPanel}
          </details>
        </div>
      ) : (
        <>
          {backgroundPanel}
          {transformPanel}
          {orderPanel}
        </>
      )}
    </>
  );

  // A selected dialogue takes over the single inspector surface; the
  // layer/background body is shown otherwise. The two selections are mutually
  // exclusive (selecting one clears the other), so at most one is active.
  const inspectorContent = dialogueMode ? (
    <>
      {landscapePresentation ? inspectorHeading : null}
      <DialogueInspector
        dialogueId={selectedDialogueId!}
        presentation={landscapePresentation ? 'landscape' : 'inspector'}
      />
    </>
  ) : (
    inspectorBody
  );

  return (
    <aside
      aria-labelledby="right-inspector-heading"
      className={`right-inspector${narrow ? ' right-inspector-compact' : ''}${
        drawerOpen ? ' right-inspector-drawer-open' : ''
      }`}
      data-background-layer-id={backgroundLayerId}
      data-drawer-open={drawerOpen}
      data-inspector-mode={dialogueMode ? 'subtitle' : 'properties'}
      data-narrow={narrow ? 'true' : 'false'}
      data-presentation={
        landscapePresentation
          ? 'landscape'
          : compact
            ? 'compact'
            : 'default'
      }
      data-selected-layer-id={selectedLayerId ?? ''}
      data-selection-state={selection.state}
      data-testid="right-inspector"
    >
      <span
        aria-hidden="true"
        className="right-inspector-measurement-hook"
        data-testid={LEGACY_REGION_TEST_ID}
      />
      {narrow ? (
        <>
      <button
        ref={railRef}
        aria-controls="right-inspector-drawer"
        aria-expanded={drawerOpen}
        aria-label={drawerOpen ? `收起${inspectorModeLabel}` : `打开${inspectorModeLabel}`}
        className="inspector-rail-handle"
        data-testid="inspector-rail-handle"
        onClick={() => setDrawerOpen(!drawerOpen)}
        type="button"
      >
        <span>{drawerOpen ? '›' : '‹'}</span>
        <strong>{dialogueMode ? '字幕' : '属性'}</strong>
      </button>
      <div
        ref={drawerRef}
        tabIndex={-1}
        className="right-inspector-drawer"
        data-testid="right-inspector-drawer"
        id="right-inspector-drawer"
      >
        <button
          aria-label={`关闭${inspectorModeLabel}`}
          className="inspector-drawer-close"
          data-testid="inspector-drawer-close"
          onClick={() => setDrawerOpen(false)}
          type="button"
        >
          关闭
        </button>
        {inspectorContent}
      </div>
        </>
      ) : (
        inspectorContent
      )}
    </aside>
  );
}
