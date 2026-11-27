import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  isLegacyCharacterImageLayer,
  resolveCharacterPartVisualSource,
  type Asset,
  type CharacterFaceGraphicSource,
  type Layer,
} from '../../domain';
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
import { ShotLayerListPanel } from '../features/properties/ShotLayerListPanel';
import { layerStore } from '../stores/layerStore';
import { LayerDepthControl } from '../features/properties/LayerDepthControl';
import { LayerParentControl } from '../features/properties/LayerParentControl';
import { LayerTransformPanel } from '../features/properties/LayerTransformPanel';
import { CharacterPartTransformPanel } from '../features/properties/CharacterPartTransformPanel';
import { CharacterMotionInspectorSection } from '../features/properties/CharacterMotionInspectorSection';
import {
  adaptivePartIdForNodeId,
  isCharacterNodeMotionEditable,
  resolveCharacterView,
  type CharacterNodeId,
} from '../features/characters/characterView';
import { VisibleBoundsThumbnail } from '../features/characters/VisibleBoundsThumbnail';
import { useTimelineUi } from '../features/timeline/timelineUiStore';
import { FlaGraphicInspectorPreview } from '../features/properties/FlaGraphicInspectorPreview';
import { GraphicFrameAtTimeControl } from '../features/properties/GraphicFrameAtTimeControl';
import { FlaGraphicStructureTree } from '../features/properties/FlaGraphicStructureTree';
import { useStructuredGraphicSelection } from '../features/properties/useStructuredGraphicSelection';
import { AnimationPlaybackControls } from '../features/properties/AnimationPlaybackControls';
import { ExpressionAtTimeControl } from '../features/properties/ExpressionAtTimeControl';
import { CharacterActionAtTimeControl } from '../features/properties/CharacterActionAtTimeControl';
import { BatchLayerControls } from '../features/properties/BatchLayerControls';
import { LayerEffectsPreviewControl } from '../features/properties/LayerEffectsPreviewControl';
import { CharacterMotionTemplateControl } from '../features/properties/CharacterMotionTemplateControl';
import { CharacterBodyPoseControl } from '../features/properties/CharacterBodyPoseControl';
import { CharacterArmChainControl } from '../features/properties/CharacterArmChainControl';
import { CharacterMotionMappingControl } from '../features/properties/CharacterMotionMappingControl';
import { GraphicFacePreview } from '../features/characters/GraphicFacePicker';
import { DialogueInspector } from '../features/dialogue/DialogueInspector';
import { DecorativeIcon } from '../ui';
import { isNarrowViewport, useNarrowViewport } from './ResourceActivityDock';
import { PortraitPropertiesSections } from './PortraitPropertiesSections';
import type { EditorShellLayoutMode } from './adaptiveEditorShell';
import {
  Layers3,
  Move,
  Palette,
  SlidersHorizontal,
  SquareDashedMousePointer,
  X,
} from 'lucide-react';

// Issue 109's existing Electron receipt measures the right column by this
// stable selector. Keep the selector as a non-visual alias on the real
// inspector so the receipt can migrate without introducing a second surface.
const LEGACY_REGION_TEST_ID = ['right-inspector', 'placeholder'].join('-');
const INSPECTOR_DRAWER_FOCUS_FALLBACK_DELAY_MS = 150;

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
  graphicSource?: CharacterFaceGraphicSource;
  partVisualKind?: 'image' | 'fla-graphic';
}

function getPortraitLayerTypeLabel(typeLabel: string): string {
  switch (typeLabel) {
    case '角色图层':
      return '角色';
    case '图片素材图层':
      return '图片';
    case '音频素材图层':
      return '音频';
    default:
      return typeLabel;
  }
}

/**
 * Resolve the existing layer source into the small identity summary shown by
 * the portrait inspector. This is deliberately a pure projection over the
 * formal project snapshot; it does not introduce a second selection owner.
 */
export function getRightInspectorLayerSummary(
  snapshot: EditorProjectSnapshot | null,
  layer: Layer | null,
  partId?: string | null,
  nodeId?: CharacterNodeId | null,
): RightInspectorLayerSummary {
  if (!layer || !snapshot) {
    return { asset: null, typeLabel: '图层' };
  }

  const source = layer.source;
  if (source.kind === 'control') return { asset: null, typeLabel: '控制层' };
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

  if (source.kind === 'animation') {
    const animation = snapshot.project.animations.find(
      (candidate) => candidate.id === source.animationId,
    );
    const firstFrameAssetId = animation?.frames[0]?.assetId;
    const asset =
      snapshot.project.assets.find(
        (candidate) => candidate.id === firstFrameAssetId,
      ) ?? null;
    return { asset, typeLabel: animation && 'kind' in animation && animation.kind === 'fla-graphic' && animation.structure ? '元件' : '正式动画图层' };
  }

  if (source.kind === 'video') {
    const asset =
      snapshot.project.assets.find(
        (candidate) => candidate.id === source.assetId,
      ) ?? null;
    return { asset, typeLabel: '内嵌视频图层' };
  }

  const character =
    snapshot.project.characters?.find(
      (candidate) => candidate.id === source.characterId,
    ) ?? null;
  const expressionCharacter =
    character && character.mode !== 'adaptive-parts' ? character : null;
  if (character?.mode === 'adaptive-parts' && partId) {
    const part = character.parts.find(candidate => candidate.partId === partId);
    const clip = layer.animationClip?.version === 1 ? layer.animationClip : undefined;
    const visualSource = clip?.targetBases.find(basis => basis.target.partId === partId)?.visualSource
      ?? (part ? resolveCharacterPartVisualSource(part) : undefined);
    const assetId = visualSource?.kind === 'image' ? visualSource.assetId
      : visualSource?.kind === 'fla-graphic' ? snapshot.project.animations.find(animation => animation.id === visualSource.animationId)?.frames[0]?.assetId
        : undefined;
    return {
      asset: snapshot.project.assets.find(candidate => candidate.id === assetId) ?? null,
      typeLabel: '角色图层',
      partVisualKind: visualSource?.kind,
    };
  }
  const expression = expressionCharacter?.expressions.find(
    (candidate) => candidate.id === source.expressionId,
  );
  const assetId = expression?.assetId ?? expressionCharacter?.baseAssetId;
  const asset =
    snapshot.project.assets.find((candidate) => candidate.id === assetId) ??
    null;
  if (expression?.visualSource) {
    return {
      asset,
      typeLabel: '角色图层',
      graphicSource: expression.visualSource,
    };
  }
  if (character?.mode === 'composite' && nodeId === 'face') {
    return {
      asset,
      typeLabel: '角色图层',
      partVisualKind: 'image' as const,
    };
  }
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

export type RightInspectorEmptyStatePresentation = 'portrait' | 'landscape';

export interface RightInspectorEmptyStateProps {
  /** Reuse the same authoritative empty-selection projection per shell. */
  presentation?: RightInspectorEmptyStatePresentation;
}

/**
 * Presentation-only guide for an empty Properties selection. Selection
 * remains owned by selectionStore; this component deliberately has no state
 * or event handlers of its own.
 */
export function RightInspectorEmptyState({
  presentation = 'portrait',
}: RightInspectorEmptyStateProps = {}): React.JSX.Element {
  const landscape = presentation === 'landscape';

  return (
    <section
      aria-describedby="right-inspector-empty-state-description"
      aria-labelledby="right-inspector-empty-state-title"
      aria-live="polite"
      className={`right-inspector-selection right-inspector-selection-empty${
        landscape ? ' right-inspector-selection-empty-landscape' : ''
      }`}
      data-selection-state="empty"
      data-empty-state-presentation={presentation}
      data-testid="right-inspector-selection"
    >
      <div
        className="right-inspector-empty-state-content"
        data-testid="right-inspector-empty-state"
      >
        <div
          aria-hidden="true"
          className="right-inspector-empty-state-icon"
        >
          <DecorativeIcon
            icon={SquareDashedMousePointer}
            size={32}
            strokeWidth={1.8}
          />
        </div>
        <div className="right-inspector-empty-state-copy">
          <h3 id="right-inspector-empty-state-title">
            {landscape ? '未选择对象' : '选择一个对象开始编辑'}
          </h3>
          <p id="right-inspector-empty-state-description">
            {landscape
              ? '点击画布中的角色、图片或其他可编辑对象，这里会显示位置、大小和图层设置。'
              : '点击上方画布中的角色、图片或背景，即可调整位置、缩放、外观与图层顺序。'}
          </p>
        </div>
        {landscape ? null : (
          <ul
            aria-label="可编辑属性预览"
            className="right-inspector-empty-state-capabilities"
          >
            <li>
              <DecorativeIcon icon={Move} size={18} />
              <div>
                <strong>变换</strong>
                <span>位置 / 缩放 / 旋转</span>
              </div>
            </li>
            <li>
              <DecorativeIcon icon={Palette} size={18} />
              <div>
                <strong>外观</strong>
                <span>透明度 / 背景填充</span>
              </div>
            </li>
            <li>
              <DecorativeIcon icon={Layers3} size={18} />
              <div>
                <strong>图层</strong>
                <span>顺序 / 锁定 / 删除</span>
              </div>
            </li>
          </ul>
        )}
      </div>
    </section>
  );
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
        ? '背景已锁定。'
        : '',
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
  /** Render only the existing Inspector content inside RightWorkspace. */
  embedded?: boolean;
}

export function RightInspector({
  shellMode,
  compact,
  dialogueSelectionVisible = true,
  drawerOpen: requestedDrawerOpen,
  onDrawerOpenChange,
  embedded = false,
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
  const selectedNodeId = useSyncExternalStore(selectionStore.subscribe, selectionStore.getSelectedCharacterNodeId);
  const selectedPartId = adaptivePartIdForNodeId(selectedNodeId);
  const motionUi = useTimelineUi();
  const compactPresentation = compact === true || landscapePresentation;
  const compactSections = compactPresentation;
  const dialogueMode = Boolean(
    selectedDialogueId && dialogueSelectionVisible,
  );
  const inspectorModeLabel = dialogueMode
    ? landscapePresentation
      ? '编辑字幕'
      : '字幕'
    : '属性';
  const selection = getRightInspectorSelection(
    snapshot,
    currentShotId,
    selectedLayerId,
  );
  const legacyCharacterLayerSelected =
    snapshot !== null &&
    currentShotId !== null &&
    selection.layer !== null &&
    isLegacyCharacterImageLayer(
      snapshot.project,
      currentShotId,
      selection.layer.id,
    );
  const portraitEmptyState =
    compact === true && !dialogueMode && selection.state === 'empty';
  const landscapeEmptyState =
    landscapePresentation && !dialogueMode && selection.state === 'empty';
  const backgroundLayerId =
    snapshot?.project.shots.find((candidate) => candidate.id === currentShotId)
      ?.backgroundLayerId ?? '';
  const currentShot = snapshot?.project.shots.find(
    (candidate) => candidate.id === currentShotId,
  );
  const selectedNode = snapshot
    ? resolveCharacterView(snapshot.project, selection.layer ?? undefined)?.nodes.find((node) => node.id === selectedNodeId)
    : undefined;
  const motionNode = isCharacterNodeMotionEditable(selectedNode) ? selectedNode : undefined;
  const layerSummary = getRightInspectorLayerSummary(
    snapshot,
    selection.layer,
    selectedPartId,
    selectedNodeId,
  );
  const structuredSelection = useStructuredGraphicSelection();
  const selectionTypeLabel = compact
    ? getPortraitLayerTypeLabel(layerSummary.typeLabel)
    : landscapePresentation
      ? selection.state === 'background'
        ? '背景'
        : getPortraitLayerTypeLabel(layerSummary.typeLabel)
      : layerSummary.typeLabel;
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
    if (embedded) return undefined;
    if (requestedDrawerOpen === undefined) {
      setInternalDrawerOpen(!narrow);
    }
  }, [embedded, narrow, requestedDrawerOpen]);

  useEffect(() => {
    if (embedded) return undefined;
    if (!narrow) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [embedded, narrow]);

  // V-194-02: keep keyboard focus inside the open drawer, and return it to the
  // rail trigger when the drawer closes. The trigger is hidden while open, so
  // without this, focus would strand on a visibility:hidden element.
  useEffect(() => {
    if (embedded) return;
    if (!narrow) return;
    let focusTimer: number | undefined;
    if (drawerOpen && !prevDrawerOpenRef.current) {
      drawerRef.current?.focus();
      const drawer = drawerRef.current;
      // The drawer becomes visible through a short CSS transition in the same
      // commit as this effect. If the browser still observes its pre-transition
      // hidden state, retry after the transition so focus does not fall through
      // to document.body.
      if (drawer && document.activeElement !== drawer) {
        focusTimer = window.setTimeout(() => {
          if (drawerOpen && drawerRef.current === drawer) drawer.focus();
        }, INSPECTOR_DRAWER_FOCUS_FALLBACK_DELAY_MS);
      }
    } else if (!drawerOpen && prevDrawerOpenRef.current) {
      railRef.current?.focus();
    }
    prevDrawerOpenRef.current = drawerOpen;
    return () => {
      if (focusTimer !== undefined) window.clearTimeout(focusTimer);
    };
  }, [drawerOpen, embedded, narrow]);

  const [createControlError, setCreateControlError] = useState('');
  const inspectorHeading = (
    <div className="right-inspector-heading">
      <h2 id="right-inspector-heading">
        {dialogueMode && landscapePresentation
          ? '编辑字幕'
          : dialogueMode
            ? '字幕'
            : '属性'}
      </h2>
      {currentShot && !dialogueMode ? (
        <button type="button" data-ui-button data-ui-variant="secondary"
          onClick={() => {
            try {
              layerStore.createControl();
              setCreateControlError('');
            } catch (cause) {
              setCreateControlError(cause instanceof Error ? cause.message : '无法新建控制层。');
            }
          }}>新建控制层</button>
      ) : null}
      {createControlError ? <span role="alert">{createControlError}</span> : null}
      {(compact || landscapePresentation) &&
      (!dialogueMode || landscapePresentation) ? (
        <button
          aria-label="关闭属性"
          className="right-inspector-heading-close"
          data-testid="inspector-inline-close"
          onClick={() => setDrawerOpen(false)}
          title="关闭属性"
          type="button"
        >
          <DecorativeIcon
            className="right-inspector-heading-close-icon"
            icon={X}
            size={20}
          />
        </button>
      ) : null}
    </div>
  );

  const inspectorSelection = portraitEmptyState ? (
    <RightInspectorEmptyState />
  ) : landscapeEmptyState ? (
    <RightInspectorEmptyState presentation="landscape" />
  ) : (
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
          {structuredSelection.target ? null : <div className="right-inspector-selection-thumbnail">
            {layerSummary.graphicSource ? (
              <GraphicFacePreview source={layerSummary.graphicSource} label={selection.layer.name} />
            ) : selectionThumbnail?.status === 'ready' ? (
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
          </div>}
          <div className="right-inspector-selection-copy">
            <strong>{selection.layer.name}</strong>
            <span>{selectionTypeLabel}</span>
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
      {selection.layer && !structuredSelection.target && selection.message ? (
        <span
          className="right-inspector-selection-message"
          data-testid="right-inspector-selection-message"
        >
          {selection.message}
        </span>
      ) : null}
      {legacyCharacterLayerSelected ? (
        <aside
          aria-label="角色表情提示"
          className="right-inspector-character-layer-reminder"
          data-testid="right-inspector-character-layer-reminder"
          role="note"
        >
          <strong>仍是普通图片</strong>
          <span>已用于角色表情；要按角色使用，请从角色栏重新拖入。</span>
        </aside>
      ) : null}
    </section>
  );

  const focusParentBinding = (): void => {
    const target = document.getElementById('layer-parent-control-anchor');
    if (target) {
      target.scrollIntoView({ block: 'nearest' });
      const select = target.querySelector('select');
      if (select instanceof HTMLElement) select.focus();
    }
  };
  const parentControl = snapshot && currentShot && selection.layer ? (
    <div id="layer-parent-control-anchor">
      <LayerParentControl
        key={`${currentShot.id}:${selection.layer.id}`}
        layer={selection.layer}
        shot={currentShot}
        project={snapshot.project}
      />
    </div>
  ) : null;
  const transformPanel = (
    <>
      <LayerTransformPanel
        backgroundLayerSelected={selection.state === 'background'}
        compact={compact}
        showResetTransform={Boolean(compact) || landscapePresentation}
        showLockControl={!compact && !landscapePresentation}
      />
      {parentControl}
      {snapshot && currentShot && selection.layer ? (
        <LayerDepthControl key={currentShot.id + ":" + selection.layer.id}
          layer={selection.layer} shot={currentShot} snapshot={snapshot} />
      ) : null}
      <AnimationPlaybackControls />
    </>
  );
  const backgroundPanel = <LayerBackgroundControl />;
  const orderPanel = (
    <>
      <ShotLayerListPanel onFocusParentBinding={focusParentBinding} />
      <LayerOrderControls
        backgroundLayerSelected={selection.state === 'background'}
        showLockControl={Boolean(compact) || landscapePresentation}
      />
    </>
  );

  const motionSection = snapshot && currentShot ? <CharacterMotionInspectorSection project={snapshot.project} shot={currentShot} layerId={selectedLayerId} /> : null;
  const motionPanelInput = motionNode && currentShot && selection.layer
    ? motionNode.motion === 'character-clip-v1'
      ? {
          shotId: currentShot.id,
          layerId: selection.layer.id,
          partId: motionNode.partId,
          timeMs: motionUi.currentTimeMs,
          autoKey: motionUi.characterMotionAutoKey,
        }
      : {
          shotId: currentShot.id,
          layerId: selection.layer.id,
          nodeId: motionNode.id,
          timeMs: motionUi.currentTimeMs,
          autoKey: motionUi.characterMotionAutoKey,
        }
    : null;
  const motionTargetKey = motionNode
    ? motionNode.motion === 'character-clip-v1'
      ? motionNode.partId
      : motionNode.id
    : null;
  const showMotionInspector = Boolean(
    motionNode && motionPanelInput && motionTargetKey && currentShot && selection.layer && snapshot,
  );
  const inspectorBody = (
    <>
      {inspectorHeading}
      {showMotionInspector && motionNode && selection.layer ? (
        <section className="character-part-identity" data-testid="right-inspector-part-context">
          <div className="character-part-identity-thumbnail" aria-hidden="true">
            {layerSummary.graphicSource ? (
              <GraphicFacePreview source={layerSummary.graphicSource} label={motionNode.name} />
            ) : selectionThumbnail?.status === 'ready' ? (
              layerSummary.partVisualKind === 'image' ? (
                <VisibleBoundsThumbnail key={selectionThumbnail.dataUrl} cacheKey={selectionThumbnail.dataUrl} src={selectionThumbnail.dataUrl} alt="" />
              ) : <img alt="" src={selectionThumbnail.dataUrl} />
            ) : <DecorativeIcon icon={Layers3} size={24} />}
          </div>
          <div className="character-part-identity-copy">
            <strong title={motionNode.name}>{motionNode.name}</strong>
            <span title={selection.layer.name}>{selection.layer.name}</span>
          </div>
        </section>
      ) : (
        <>
          <FlaGraphicInspectorPreview />
          {inspectorSelection}
        </>
      )}
      {motionSection}
      {currentShot && snapshot ? (
        <GraphicFrameAtTimeControl key={JSON.stringify([editorProjectStore.getProjectInstanceId(), currentShot.id])}
          project={snapshot.project} shot={currentShot} selection={selection.layer} />
      ) : null}
      {showMotionInspector && motionNode?.motion === 'character-clip-v1' ? null : (
        <FlaGraphicStructureTree />
      )}
      {snapshot &&
      currentShot &&
      selection.layer?.source.kind === 'character' &&
      motionNode?.motion !== 'character-clip-v1' ? (
        <ExpressionAtTimeControl
          key={`expression:${currentShot.id}:${selection.layer.id}`}
          project={snapshot.project}
          projectRoot={snapshot.projectRoot}
          shot={currentShot}
          layer={selection.layer}
        />
      ) : null}
      {snapshot &&
      currentShot &&
      selection.layer?.source.kind === 'character' ? (
        <>
        <CharacterActionAtTimeControl
          key={`action:${currentShot.id}:${selection.layer.id}`}
          project={snapshot.project}
          shot={currentShot}
          layer={selection.layer}
        />
        <CharacterMotionTemplateControl
          key={String(editorProjectStore.getProjectInstanceId()) + currentShot.id + selection.layer.id}
          snapshot={snapshot} shot={currentShot} layer={selection.layer} />
        <CharacterBodyPoseControl key={`body-pose:${currentShot.id}:${selection.layer.id}`}
          snapshot={snapshot} shot={currentShot} layer={selection.layer} />
        <CharacterArmChainControl key={`arm-chain:${currentShot.id}:${selection.layer.id}`}
          snapshot={snapshot} shot={currentShot} layer={selection.layer} />
        <CharacterMotionMappingControl key={`motion-mapping:${currentShot.id}:${selection.layer.id}`}
          snapshot={snapshot} shot={currentShot} layer={selection.layer} />
        </>
      ) : null}
      {snapshot && currentShot && currentShot.layers.some(({ id }) => id !== currentShot.backgroundLayerId) ?
        <BatchLayerControls key={String(editorProjectStore.getProjectInstanceId()) + currentShot.id}
          snapshot={snapshot} shotId={currentShot.id} layers={currentShot.layers
            .filter(({ id }) => id !== currentShot.backgroundLayerId).sort((left, right) => left.zIndex - right.zIndex)} /> : null}
      {snapshot && currentShot && selection.layer && selection.layer.id !== currentShot.backgroundLayerId ?
        <LayerEffectsPreviewControl key={String(editorProjectStore.getProjectInstanceId()) + currentShot.id + selection.layer.id}
          snapshot={snapshot} shotId={currentShot.id} layer={selection.layer} /> : null}
      {landscapeEmptyState ? null : (
        showMotionInspector && motionNode && motionPanelInput && motionTargetKey && currentShot && selection.layer && snapshot ? (
          <details className="right-inspector-section right-inspector-transform-section" data-testid="right-inspector-transform-section" open>
            <summary>变换</summary>
            <CharacterPartTransformPanel
              key={JSON.stringify([editorProjectStore.getProjectInstanceId(), currentShot.id, selection.layer.id, motionTargetKey, motionUi.currentTimeMs, motionUi.characterMotionAutoKey])}
              revision={snapshot.revision}
              input={motionPanelInput}
              capabilities={motionNode.capabilities}
              locked={selection.layer.locked}
            />
          </details>
        ) : (
        selectedNode?.motion === null ? null : <>
          {!portraitEmptyState && compactPresentation ? (
            <PortraitPropertiesSections
              backgroundLayerSelected={selection.state === 'background'}
              parentControl={parentControl}
              presentation={landscapePresentation ? 'landscape' : 'portrait'}
            />
          ) : (
            <>
              {!portraitEmptyState && compactSections ? (
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
              ) : !portraitEmptyState ? (
                <>
                  {backgroundPanel}
                  {transformPanel}
                  {orderPanel}
                </>
              ) : null}
            </>
          )}
        </>
        )
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
        presentation={
          landscapePresentation
            ? 'landscape'
            : compact
              ? 'properties'
              : 'inspector'
        }
      />
    </>
  ) : (
    inspectorBody
  );

  if (embedded) {
    return (
      <aside
        aria-labelledby="right-inspector-heading"
        className="right-inspector right-inspector-compact right-inspector-drawer-open right-inspector-embedded"
        data-background-layer-id={backgroundLayerId}
        data-drawer-open="true"
        data-inspector-mode={dialogueMode ? 'subtitle' : 'properties'}
        data-presentation="embedded"
        data-selected-layer-id={selectedLayerId ?? ''}
        data-selection-state={selection.state}
        data-testid="right-inspector"
      >
        <span
          aria-hidden="true"
          className="right-inspector-measurement-hook"
          data-testid={LEGACY_REGION_TEST_ID}
        />
        <div
          className="right-inspector-drawer right-inspector-drawer-embedded"
          data-testid="right-inspector-drawer"
          id="right-inspector-drawer"
        >
          {inspectorContent}
        </div>
      </aside>
    );
  }

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
            aria-label={
              drawerOpen
                ? `收起${inspectorModeLabel}`
                : `打开${inspectorModeLabel}`
            }
            className="inspector-rail-handle"
            data-testid="inspector-rail-handle"
            onClick={() => setDrawerOpen(!drawerOpen)}
            type="button"
          >
            <DecorativeIcon
              className="inspector-rail-icon"
              icon={SlidersHorizontal}
              size={18}
              strokeWidth={1.9}
            />
            <strong className="inspector-rail-label">
              {dialogueMode ? '字幕' : '属性'}
            </strong>
            <span
              aria-hidden="true"
              className="inspector-rail-chevron"
            >
              {drawerOpen ? '›' : '‹'}
            </span>
          </button>
          <div
            ref={drawerRef}
            tabIndex={-1}
            className="right-inspector-drawer"
            data-testid="right-inspector-drawer"
            id="right-inspector-drawer"
          >
            {inspectorContent}
          </div>
        </>
      ) : (
        inspectorContent
      )}
    </aside>
  );
}
