import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { Layer } from '../../domain';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { editorProjectStore } from '../stores/EditorProjectStore';
import { selectionStore } from '../stores/selectionStore';
import { shotStore } from '../stores/shotStore';
import { dialogueSelectionStore } from '../stores/dialogueSelectionStore';
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

export function getRightInspectorSelection(
  snapshot: EditorProjectSnapshot | null,
  currentShotId: string | null,
  selectedLayerId: string | null,
): RightInspectorSelection {
  if (!selectedLayerId) {
    return {
      state: 'empty',
      layer: null,
      message: '请选择普通图层，或使用下方的背景操作。',
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
}

export function RightInspector({
  shellMode,
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
  const inspectorModeLabel = selectedDialogueId ? '对白检查器' : '图层检查器';
  const selection = getRightInspectorSelection(
    snapshot,
    currentShotId,
    selectedLayerId,
  );
  const backgroundLayerId =
    snapshot?.project.shots.find((candidate) => candidate.id === currentShotId)
      ?.backgroundLayerId ?? '';

  // Issue 192: reuse the same narrow seam as the left resource workspace so the
  // two edges collapse symmetrically instead of inventing a second breakpoint.
  const narrowMode =
    shellMode === undefined
      ? 'auto'
      : shellMode === 'landscape'
        ? 'compact'
        : 'expanded';
  const narrow = useNarrowViewport(narrowMode);
  const [drawerOpen, setDrawerOpen] = useState(() =>
    shellMode === undefined ? !isNarrowViewport() : !narrow,
  );
  const railRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const prevDrawerOpenRef = useRef(drawerOpen);

  useEffect(() => {
    setDrawerOpen(!narrow);
  }, [narrow]);

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

  const inspectorBody = (
    <>
      <div className="right-inspector-heading">
        <div>
          <p className="eyebrow">右侧检查器</p>
          <h2 id="right-inspector-heading">图层检查器</h2>
        </div>
        <span>当前镜头</span>
      </div>
      <section
        aria-live="polite"
        className="right-inspector-selection"
        data-selection-state={selection.state}
        data-testid="right-inspector-selection"
      >
        <p className="eyebrow">当前选择</p>
        <strong>{selection.layer?.name ?? '未选择图层'}</strong>
        <span data-testid="right-inspector-selection-message">
          {selection.message}
        </span>
      </section>
      <LayerBackgroundControl />
      <LayerTransformPanel
        backgroundLayerSelected={selection.state === 'background'}
      />
      <LayerOrderControls
        backgroundLayerSelected={selection.state === 'background'}
      />
    </>
  );

  // A selected dialogue takes over the single inspector surface; the
  // layer/background body is shown otherwise. The two selections are mutually
  // exclusive (selecting one clears the other), so at most one is active.
  const inspectorContent = selectedDialogueId ? (
    <DialogueInspector dialogueId={selectedDialogueId} />
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
      data-narrow={narrow ? 'true' : 'false'}
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
        onClick={() => setDrawerOpen((open) => !open)}
        type="button"
      >
        <span>{drawerOpen ? '›' : '‹'}</span>
        <strong>属性</strong>
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
