import Konva from 'konva';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Circle,
  Group,
  Image as KonvaImage,
  Line,
  Rect,
} from 'react-konva';
import {
  CHARACTER_PART_MAX_SCALE,
  CHARACTER_PART_MIN_SCALE,
  clampLayerPosition,
  type Layer,
  type LayerTransformInput,
  type PartPoseKeyframe,
  visualPartRenderTransform,
  visualHeadGroupRenderTransform,
  type LayerVisualParts,
} from '../../../domain';
import type { StageLayerRenderInstruction } from '../../../shared/stage/layer-render-contract';
import type {
  PositionAuthoringCommitResult,
  PositionAuthoringSessionHandle,
} from '../../stores/positionAuthoringSessionStore';
import { canvasImageResourceKey } from './canvasImageResources';

interface Point {
  readonly x: number;
  readonly y: number;
}

export interface SelectableLayerProps {
  /** Compatibility primary image for ordinary/legacy callers. */
  image?: HTMLImageElement;
  /** The complete visual resolved by the domain visual-parts contract. */
  visual?: LayerVisualParts;
  /** Decoded images keyed by the runtime visual-part asset id. */
  images?: ReadonlyMap<string, HTMLImageElement>;
  /** Decoded images keyed by asset id plus source version. */
  imagesByResourceKey?: ReadonlyMap<string, HTMLImageElement>;
  /** Source versions captured by a retained complete visual. */
  visualSourceKeys?: ReadonlyMap<string, string>;
  layer: Layer;
  nodeRef: React.RefObject<Konva.Group | null>;
  render: StageLayerRenderInstruction;
  selected: boolean;
  directEditingEnabled?: boolean;
  onSelect: (layerId: string) => void;
  onCommitPosition: (
    layerId: string,
    position: { x: number; y: number },
  ) => void;
  onCommitTransform: (
    layerId: string,
    transform: LayerTransformInput,
  ) => void;
  /** A scoped Position-only capability; never writes Project data directly. */
  positionAuthoringSession?: PositionAuthoringSessionHandle | null;
  /** The visual-only Shake offset that must not be baked into Position. */
  positionAuthoringShakeOffset?: Point | null;
  onPositionAuthoringCommit?: (result: PositionAuthoringCommitResult) => void;
  onError: (message: string) => void;
  poseEditing?: boolean;
  poseSelectedPartId?: string | null;
  poseCurrentKeyframe?: PartPoseKeyframe | null;
  poseCanTransform?: boolean;
  posePivotLayerPoint?: Point | null;
  poseGestureContextKey?: string;
  onSelectPart?: (partId: string) => void;
  onCommitPartPose?: (
    partId: string,
    keyframe: PartPoseKeyframe,
    gestureContextKey: string,
  ) => void;
}

type PoseGestureKind = 'move' | 'rotate' | 'scale';

interface PoseGesture {
  kind: PoseGestureKind;
  contextKey: string;
  keyframe: PartPoseKeyframe;
  node: Konva.Node;
  startPosition: Point;
  pivot: Point;
  startPointerAngle: number;
  lastPointerAngle: number;
  accumulatedAngle: number;
  startRadius: number;
}

function stopAndSelect(
  event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  layerId: string,
  onSelect: (layerId: string) => void,
): void {
  event.cancelBubble = true;
  onSelect(layerId);
}

interface PoseGestureController {
  poseDraft: PartPoseKeyframe | null;
  beginPoseGesture: (
    kind: PoseGestureKind,
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ) => void;
  updatePoseGesture: (
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ) => void;
  finishPoseGesture: (
    partId: string,
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ) => void;
}

const NO_POSE_GESTURE_CONTROLLER: PoseGestureController = {
  poseDraft: null,
  beginPoseGesture: () => undefined,
  updatePoseGesture: () => undefined,
  finishPoseGesture: () => undefined,
};

export function SelectableLayer(props: SelectableLayerProps): React.JSX.Element {
  if (props.poseEditing) {
    return <PoseEditableSelectableLayer {...props} />;
  }
  return renderSelectableLayer(props, NO_POSE_GESTURE_CONTROLLER);
}

function PoseEditableSelectableLayer(
  props: SelectableLayerProps,
): React.JSX.Element {
  const controller = usePoseGestureController(props);
  return renderSelectableLayer(props, controller);
}

function usePoseGestureController({
  nodeRef,
  poseCanTransform = false,
  poseCurrentKeyframe = null,
  poseEditing = false,
  poseGestureContextKey = '',
  posePivotLayerPoint = null,
  poseSelectedPartId = null,
  onCommitPartPose = () => undefined,
  onError,
}: SelectableLayerProps): PoseGestureController {
  const poseGestureRef = useRef<PoseGesture | null>(null);
  const poseDraftRef = useRef<PartPoseKeyframe | null>(null);
  const [poseDraft, setPoseDraft] = useState<PartPoseKeyframe | null>(null);
  const cancelPoseGesture = useCallback((): void => {
    const gesture = poseGestureRef.current;
    if (gesture) {
      gesture.node.stopDrag();
      gesture.node.position(gesture.startPosition);
    }
    poseGestureRef.current = null;
    poseDraftRef.current = null;
    setPoseDraft(null);
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !poseGestureRef.current) return;
      event.preventDefault();
      cancelPoseGesture();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancelPoseGesture]);
  useEffect(() => {
    const gesture = poseGestureRef.current;
    if (
      gesture &&
      (gesture.contextKey !== poseGestureContextKey ||
        !poseEditing ||
        !poseCanTransform)
    ) {
      cancelPoseGesture();
    }
  }, [
    cancelPoseGesture,
    poseCanTransform,
    poseEditing,
    poseGestureContextKey,
  ]);

  const beginPoseGesture = (
    kind: PoseGestureKind,
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ): void => {
    if (
      !poseEditing ||
      !poseCanTransform ||
      !poseCurrentKeyframe ||
      !poseSelectedPartId ||
      !posePivotLayerPoint
    ) {
      event.target.stopDrag();
      return;
    }
    const pointer = nodeRef.current?.getRelativePointerPosition();
    if (!pointer) {
      event.target.stopDrag();
      return;
    }
    const pointerAngle = Math.atan2(
      pointer.y - posePivotLayerPoint.y,
      pointer.x - posePivotLayerPoint.x,
    );
    const startRadius = Math.max(
      1,
      Math.hypot(
        pointer.x - posePivotLayerPoint.x,
        pointer.y - posePivotLayerPoint.y,
      ),
    );
    poseGestureRef.current = {
      kind,
      contextKey: poseGestureContextKey,
      keyframe: poseCurrentKeyframe,
      node: event.target,
      startPosition: { x: event.target.x(), y: event.target.y() },
      pivot: { ...posePivotLayerPoint },
      startPointerAngle: pointerAngle,
      lastPointerAngle: pointerAngle,
      accumulatedAngle: 0,
      startRadius,
    };
    poseDraftRef.current = poseCurrentKeyframe;
  };

  const updatePoseGesture = (
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ): void => {
    const gesture = poseGestureRef.current;
    if (!gesture) return;
    let next: PartPoseKeyframe;
    if (gesture.kind === 'move') {
      next = {
        ...gesture.keyframe,
        offsetX:
          gesture.keyframe.offsetX + event.target.x() - gesture.startPosition.x,
        offsetY:
          gesture.keyframe.offsetY + event.target.y() - gesture.startPosition.y,
      };
    } else {
      const pointer = nodeRef.current?.getRelativePointerPosition();
      if (!pointer) return;
      if (gesture.kind === 'rotate') {
        const pointerAngle = Math.atan2(
          pointer.y - gesture.pivot.y,
          pointer.x - gesture.pivot.x,
        );
        let delta = pointerAngle - gesture.lastPointerAngle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        gesture.accumulatedAngle += delta;
        gesture.lastPointerAngle = pointerAngle;
        next = {
          ...gesture.keyframe,
          rotationDeg:
            gesture.keyframe.rotationDeg +
            (gesture.accumulatedAngle * 180) / Math.PI,
        };
      } else {
        const radius = Math.hypot(
          pointer.x - gesture.pivot.x,
          pointer.y - gesture.pivot.y,
        );
        next = {
          ...gesture.keyframe,
          scale: Math.max(
            CHARACTER_PART_MIN_SCALE,
            Math.min(
              CHARACTER_PART_MAX_SCALE,
              gesture.keyframe.scale * (radius / gesture.startRadius),
            ),
          ),
        };
      }
    }
    poseDraftRef.current = next;
    setPoseDraft(next);
  };

  const finishPoseGesture = (
    partId: string,
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ): void => {
    const gesture = poseGestureRef.current;
    if (!gesture) return;
    if (
      gesture.contextKey !== poseGestureContextKey ||
      !poseEditing ||
      !poseCanTransform
    ) {
      cancelPoseGesture();
      onError('工程、镜头或时间已变化，拖动已取消。');
      return;
    }
    updatePoseGesture(event);
    const next = poseDraftRef.current;
    gesture.node.stopDrag();
    gesture.node.position(gesture.startPosition);
    poseGestureRef.current = null;
    poseDraftRef.current = null;
    setPoseDraft(null);
    if (next) onCommitPartPose(partId, next, gesture.contextKey);
  };

  return {
    poseDraft,
    beginPoseGesture,
    updatePoseGesture,
    finishPoseGesture,
  };
}

function renderSelectableLayer({
  image,
  images,
  imagesByResourceKey,
  layer,
  nodeRef,
  render,
  selected,
  visual,
  visualSourceKeys,
  directEditingEnabled = true,
  onSelect,
  onCommitPosition,
  onCommitTransform,
  positionAuthoringSession = null,
  positionAuthoringShakeOffset = null,
  onPositionAuthoringCommit = () => undefined,
  onError,
  poseEditing = false,
  poseSelectedPartId = null,
  poseCurrentKeyframe = null,
  poseCanTransform = false,
  posePivotLayerPoint = null,
  onSelectPart = () => undefined,
}: SelectableLayerProps,
  gestureController: PoseGestureController,
): React.JSX.Element {
  const {
    poseDraft,
    beginPoseGesture,
    updatePoseGesture,
    finishPoseGesture,
  } = gestureController;
  const canSelect = true;
  const positionAuthoringEnabled = positionAuthoringSession !== null;
  const canMove =
    (directEditingEnabled || positionAuthoringEnabled) &&
    !layer.locked &&
    !poseEditing;
  const canTransform = canMove;

  const legacyBounds = {
    x: -render.offsetX,
    y: -render.offsetY,
    width: render.width,
    height: render.height,
  };
  const visualParts = visual?.parts ?? [
    {
      partId: `${layer.id}:single`,
      ownerLayerId: layer.id,
      slot: 'single' as const,
      source: { kind: 'asset' as const, assetId: render.assetId },
      assetId: render.assetId,
      localRect: legacyBounds,
      rotationDeg: 0,
      flipX: false,
      drawOrder: 0,
      ownerZIndex: render.zIndex,
    },
  ];
  const visualBounds = visual?.combinedLocalBounds ?? legacyBounds;
  const firstPart = visualParts[0];
  const imageForPart = (
    part: (typeof visualParts)[number],
  ): HTMLImageElement | undefined =>
    (visualSourceKeys
      ? imagesByResourceKey?.get(
          visualSourceKeys.get(part.assetId)
            ? canvasImageResourceKey(
                part.assetId,
                visualSourceKeys.get(part.assetId)!,
              )
            : '',
        )
      : undefined) ??
    images?.get(part.assetId) ??
    (part === firstPart && part.assetId === render.assetId ? image : undefined);
  const resolvedPartImages = visualParts.map((part) => ({
    part,
    image: imageForPart(part),
  }));
  const completeVisualReady = resolvedPartImages.every(
    ({ image: partImage }) => Boolean(partImage),
  );
  const compositeVisual =
    visual?.kind === 'composite-character' ||
    visual?.kind === 'adaptive-parts-character';
  const animationVisual = visual?.parts.some(
    (part) => part.source.kind === 'animation-frame',
  ) ?? false;
  const headGroup = visual?.headGroup ?? null;
  const headPartIds = new Set(headGroup?.partIds ?? []);
  const cacheCompositeVisual = (visualNode: Konva.Group | null): void => {
    if (!visualNode) return;
    visualNode.clearCache();
    if (
      !compositeVisual ||
      poseEditing ||
      !completeVisualReady ||
      visualBounds.width <= 0 ||
      visualBounds.height <= 0
    ) return;
    // Konva applies a Group opacity while drawing each child. Cache the
    // complete Body+Head+Face group first so the logical Character opacity is
    // applied once to the flattened overlap, while the outer root remains
    // the only transform/interaction owner.
    visualNode.cache({
      height: visualBounds.height,
      width: visualBounds.width,
      x: visualBounds.x,
      y: visualBounds.y,
    });
    visualNode.getLayer()?.batchDraw();
  };
  const selectVisualPart = (
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
    part: (typeof visualParts)[number],
  ): void => {
    event.cancelBubble = true;
    onSelect(layer.id);
    if (poseEditing && part.source.kind === 'adaptive-part') {
      onSelectPart(part.source.characterPartId);
    }
  };
  const selectedPosePart = resolvedPartImages.find(
    ({ part }) =>
      poseEditing &&
      part.source.kind === 'adaptive-part' &&
      part.source.characterPartId === poseSelectedPartId,
  )?.part;
  const partPosePreview =
    poseDraft && poseCurrentKeyframe && posePivotLayerPoint
      ? {
          x:
            posePivotLayerPoint.x +
            poseDraft.offsetX - poseCurrentKeyframe.offsetX,
          y:
            posePivotLayerPoint.y +
            poseDraft.offsetY - poseCurrentKeyframe.offsetY,
          offsetX: posePivotLayerPoint.x,
          offsetY: posePivotLayerPoint.y,
          rotation: poseDraft.rotationDeg - poseCurrentKeyframe.rotationDeg,
          scaleX: poseDraft.scale / poseCurrentKeyframe.scale,
          scaleY: poseDraft.scale / poseCurrentKeyframe.scale,
        }
      : posePivotLayerPoint
        ? {
            x: posePivotLayerPoint.x,
            y: posePivotLayerPoint.y,
            offsetX: posePivotLayerPoint.x,
            offsetY: posePivotLayerPoint.y,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
          }
        : null;
  const partCenter = selectedPosePart?.imageTransform
    ? {
        x:
          selectedPosePart.imageTransform.a *
            (selectedPosePart.localRect.x + selectedPosePart.localRect.width / 2) +
          selectedPosePart.imageTransform.c *
            (selectedPosePart.localRect.y + selectedPosePart.localRect.height / 2) +
          selectedPosePart.imageTransform.tx,
        y:
          selectedPosePart.imageTransform.b *
            (selectedPosePart.localRect.x + selectedPosePart.localRect.width / 2) +
          selectedPosePart.imageTransform.d *
            (selectedPosePart.localRect.y + selectedPosePart.localRect.height / 2) +
          selectedPosePart.imageTransform.ty,
      }
    : null;
  const handleDistance = selectedPosePart
    ? Math.max(
        54,
        Math.min(
          110,
          Math.max(
            selectedPosePart.localRect.width,
            selectedPosePart.localRect.height,
          ) * 0.35,
        ),
      )
    : 64;
  const renderPart = ({
    part,
    image: partImage,
  }: (typeof resolvedPartImages)[number]): React.JSX.Element => {
    const partId =
      part.source.kind === 'adaptive-part'
        ? part.source.characterPartId
        : null;
    const editingThisPart =
      poseEditing && partId !== null && partId === poseSelectedPartId;
    const imageNode = (
      <KonvaImage
        height={part.localRect.height}
        image={partImage}
        key={part.partId}
        listening={canSelect}
        onClick={(event) => selectVisualPart(event, part)}
        onTap={(event) => selectVisualPart(event, part)}
        {...visualPartRenderTransform(part)}
        width={part.localRect.width}
      />
    );
    if (!editingThisPart || !partPosePreview || !partId) {
      return imageNode;
    }
    return (
      <Group
        draggable={poseCanTransform}
        key={part.partId}
        name="part-pose-transform-draft"
        onDragEnd={(event) => finishPoseGesture(partId, event)}
        onDragMove={updatePoseGesture}
        onDragStart={(event) => beginPoseGesture('move', event)}
        {...partPosePreview}
      >
        {imageNode}
      </Group>
    );
  };
  const renderHitArea = ({
    part,
  }: (typeof resolvedPartImages)[number]): React.JSX.Element => (
    <Rect
      fill="#000000"
      height={part.localRect.height}
      key={`${part.partId}:hit`}
      listening={
        canSelect &&
        !(
          poseEditing &&
          poseCanTransform &&
          part.source.kind === 'adaptive-part' &&
          part.source.characterPartId === poseSelectedPartId
        )
      }
      name="composite-visual-hit-area"
      opacity={0}
      onClick={(event) => selectVisualPart(event, part)}
      onTap={(event) => selectVisualPart(event, part)}
      {...visualPartRenderTransform(part)}
      width={part.localRect.width}
    />
  );
  const orderedPartImages = resolvedPartImages.sort(
    (left, right) => left.part.drawOrder - right.part.drawOrder,
  );
  const visiblePartImages = orderedPartImages.filter(
    ({ part }) => part.visible !== false,
  );
  const renderedParts = completeVisualReady
    ? headGroup
      ? (
          <>
            {visiblePartImages
              .filter(({ part }) => !headPartIds.has(part.partId))
              .map(renderPart)}
            <Group
              key={headGroup.id}
              listening={canSelect}
              name="selectable-canvas-head-group"
              {...visualHeadGroupRenderTransform(headGroup)}
            >
              {visiblePartImages
                .filter(({ part }) => headPartIds.has(part.partId))
                .map(renderPart)}
            </Group>
          </>
        )
      : visiblePartImages.length === 1
        ? renderPart(visiblePartImages[0]!)
        : visiblePartImages.map(renderPart)
    : null;
  const renderedHitAreas =
    compositeVisual && completeVisualReady
      ? headGroup
        ? (
            <>
            {visiblePartImages
                .filter(({ part }) => !headPartIds.has(part.partId))
                .map(renderHitArea)}
              <Group
                listening={canSelect}
                name="selectable-canvas-head-hit-group"
                {...visualHeadGroupRenderTransform(headGroup)}
              >
                {visiblePartImages
                  .filter(({ part }) => headPartIds.has(part.partId))
                  .map(renderHitArea)}
              </Group>
            </>
          )
        : visiblePartImages.map(renderHitArea)
      : null;

  const clampNode = (node: Konva.Node): void => {
    const position = clampLayerPosition({
      x: node.x(),
      y: node.y(),
    });
    node.position(position);
  };

  const mainPositionFromVisual = (node: Konva.Node): Point => ({
    x: node.x() - (positionAuthoringShakeOffset?.x ?? 0),
    y: node.y() - (positionAuthoringShakeOffset?.y ?? 0),
  });

  const clampPositionAuthoringNode = (node: Konva.Node): void => {
    const mainPosition = clampLayerPosition(mainPositionFromVisual(node));
    node.position({
      x: mainPosition.x + (positionAuthoringShakeOffset?.x ?? 0),
      y: mainPosition.y + (positionAuthoringShakeOffset?.y ?? 0),
    });
  };

  const resetNode = (node: Konva.Node): void => {
    node.position({ x: render.x, y: render.y });
    node.scale({ x: render.scaleX, y: render.scaleY });
    node.rotation(render.rotationDeg);
  };

  return (
    <Group
      draggable={canTransform}
      id={`canvas-layer-${layer.id}`}
      listening={canSelect}
      name="selectable-canvas-layer"
      onDragStart={(event) => {
        if (layer.source.kind !== 'animation') return;
        event.cancelBubble = true;
        onSelect(layer.id);
      }}
      onClick={(event) =>
        stopAndSelect(event, layer.id, onSelect)
      }
      onDragEnd={(event) => {
        if (positionAuthoringSession) {
          clampPositionAuthoringNode(event.target);
          const result = positionAuthoringSession.commit(
            mainPositionFromVisual(event.target),
          );
          if (result.status === 'rejected' || result.status === 'stale') {
            resetNode(event.target);
            onError(result.error.message);
          } else {
            onPositionAuthoringCommit(result);
          }
          return;
        }
        if (!directEditingEnabled) {
          resetNode(event.target);
          return;
        }
        clampNode(event.target);
        try {
          onCommitPosition(layer.id, {
            x: event.target.x(),
            y: event.target.y(),
          });
        } catch (error) {
          event.target.position({ x: render.x, y: render.y });
          onError(
            error instanceof Error
              ? error.message
              : '图层位置提交失败。',
          );
        }
      }}
      onDragMove={(event) => {
        if (positionAuthoringSession) {
          clampPositionAuthoringNode(event.target);
        } else {
          clampNode(event.target);
        }
        if (!positionAuthoringSession) return;
        const result = positionAuthoringSession.setDraft({
          ...mainPositionFromVisual(event.target),
        });
        if (!result.ok) {
          resetNode(event.target);
          onError(result.error.message);
        }
      }}
      onTap={(event) =>
        stopAndSelect(event, layer.id, onSelect)
      }
      opacity={render.opacity}
      onTransformEnd={(event) => {
        const node = event.target as Konva.Group;
        if (positionAuthoringSession || !directEditingEnabled) {
          resetNode(node);
          return;
        }
        const scale = Math.abs(node.scaleX());
        node.scaleX(layer.flipX ? -scale : scale);
        node.scaleY(scale);
        try {
          onCommitTransform(layer.id, {
            x: node.x(),
            y: node.y(),
            scale,
            rotationDeg: node.rotation(),
            opacity: layer.opacity,
            flipX: layer.flipX,
          });
        } catch (error) {
          resetNode(node);
          onError(
            error instanceof Error
              ? error.message
              : '图层变换提交失败。',
          );
        }
      }}
      ref={nodeRef}
      rotation={render.rotationDeg}
      scaleX={render.scaleX}
      scaleY={render.scaleY}
      visible={render.visible}
      x={render.x}
      y={render.y}
      >
        {compositeVisual ? (
          <Group
            listening={canSelect}
            name="selectable-canvas-visual"
            ref={cacheCompositeVisual}
          >
            {renderedParts}
          </Group>
        ) : (
          renderedParts
        )}
        {renderedHitAreas}
        {poseEditing &&
        selectedPosePart &&
        posePivotLayerPoint &&
        partPosePreview ? (
          <>
            <Group
              listening={false}
              name="part-pose-selection-outline"
              {...partPosePreview}
            >
              <Rect
                dash={[8, 5]}
                fill="rgba(131, 211, 154, 0.06)"
                height={selectedPosePart.localRect.height}
                listening={false}
                stroke="#83d39a"
                strokeWidth={4}
                {...visualPartRenderTransform(selectedPosePart)}
                width={selectedPosePart.localRect.width}
              />
            </Group>
            <Circle
              fill="#f4d35e"
              listening={false}
              name="part-pose-fixed-pivot"
              radius={6}
              stroke="#3b2e12"
              strokeWidth={2}
              x={posePivotLayerPoint.x}
              y={posePivotLayerPoint.y}
            />
            {poseCanTransform && partCenter && poseSelectedPartId ? (
              <>
                <Line
                  listening={false}
                  points={[
                    posePivotLayerPoint.x,
                    posePivotLayerPoint.y,
                    posePivotLayerPoint.x,
                    posePivotLayerPoint.y - handleDistance,
                  ]}
                  stroke="#7bb9ff"
                  strokeWidth={3}
                />
                <Line
                  listening={false}
                  points={[
                    posePivotLayerPoint.x,
                    posePivotLayerPoint.y,
                    posePivotLayerPoint.x + handleDistance,
                    posePivotLayerPoint.y,
                  ]}
                  stroke="#f3a712"
                  strokeWidth={3}
                />
                <Circle
                  draggable
                  fill="#83d39a"
                  name="part-pose-move-handle"
                  onDragEnd={(event) =>
                    finishPoseGesture(poseSelectedPartId, event)
                  }
                  onDragMove={updatePoseGesture}
                  onDragStart={(event) => beginPoseGesture('move', event)}
                  radius={11}
                  stroke="#173d26"
                  strokeWidth={3}
                  x={partCenter.x}
                  y={partCenter.y}
                />
                <Circle
                  draggable
                  fill="#dcecff"
                  name="part-pose-rotate-handle"
                  onDragEnd={(event) =>
                    finishPoseGesture(poseSelectedPartId, event)
                  }
                  onDragMove={updatePoseGesture}
                  onDragStart={(event) => beginPoseGesture('rotate', event)}
                  radius={10}
                  stroke="#2564a5"
                  strokeWidth={3}
                  x={posePivotLayerPoint.x}
                  y={posePivotLayerPoint.y - handleDistance}
                />
                <Circle
                  draggable
                  fill="#fff0cc"
                  name="part-pose-scale-handle"
                  onDragEnd={(event) =>
                    finishPoseGesture(poseSelectedPartId, event)
                  }
                  onDragMove={updatePoseGesture}
                  onDragStart={(event) => beginPoseGesture('scale', event)}
                  radius={10}
                  stroke="#a36300"
                  strokeWidth={3}
                  x={posePivotLayerPoint.x + handleDistance}
                  y={posePivotLayerPoint.y}
                />
              </>
            ) : null}
          </>
        ) : null}
        {animationVisual ? (
          <Rect
            fill="#000000"
            height={visualBounds.height}
            listening={canSelect}
            name="selectable-animation-canvas-hit-area"
            opacity={0}
            onClick={(event) => stopAndSelect(event, layer.id, onSelect)}
            onTap={(event) => stopAndSelect(event, layer.id, onSelect)}
            width={visualBounds.width}
            x={visualBounds.x}
            y={visualBounds.y}
          />
        ) : null}
        {selected && !poseEditing && completeVisualReady ? (
          <Rect
          dash={layer.locked ? [18, 12] : undefined}
          height={visualBounds.height}
          listening={false}
          stroke={layer.locked ? '#ffd166' : '#83d39a'}
          strokeWidth={4}
          width={visualBounds.width}
          x={visualBounds.x}
          y={visualBounds.y}
          />
        ) : null}
    </Group>
  );
}
