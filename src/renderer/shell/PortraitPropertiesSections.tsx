import { useEffect, useRef } from 'react';
import type { Layer, Project, Shot } from '../../domain';
import {
  LayerBackgroundControl,
  type LayerBackgroundControlProps,
} from '../features/properties/LayerBackgroundControl';
import { LayerOrderControls } from '../features/properties/LayerOrderControls';
import { AnimationPlaybackControls } from '../features/properties/AnimationPlaybackControls';
import {
  LayerTransformPanel,
  PositionAuthoringControls,
  useLayerTransformController,
} from '../features/properties/LayerTransformPanel';
import { PartPoseEditorPanel } from '../features/properties/PartPoseEditorPanel';
import {
  resolvePartPoseEditorParts,
  type PartPoseEditorUi,
} from '../features/part-pose/partPoseEditorTypes';

export interface PortraitPropertiesSectionsProps {
  backgroundLayerSelected: boolean;
  presentation?: LayerBackgroundControlProps['presentation'];
  project: Project;
  shot: Shot;
  layer: Layer;
  partPoseEditor: PartPoseEditorUi;
}

/**
 * The portrait Properties sections share one transform draft controller so
 * Appearance can present opacity without creating a second commit owner.
 */
export function PortraitPropertiesSections({
  backgroundLayerSelected,
  presentation = 'portrait',
  project,
  shot,
  layer,
  partPoseEditor,
}: PortraitPropertiesSectionsProps): React.JSX.Element {
  const sectionsRef = useRef<HTMLDivElement | null>(null);
  const actionSectionRef = useRef<HTMLDetailsElement | null>(null);
  const transformController = useLayerTransformController({
    backgroundLayerSelected,
    compact: true,
    commitBoundaryRef: sectionsRef,
  });
  const characterId =
    layer.source.kind === 'character' ? layer.source.characterId : null;
  const character = characterId
    ? project.characters.find((candidate) => candidate.id === characterId)
    : undefined;
  const partPoseParts =
    presentation === 'landscape' && character?.mode === 'adaptive-parts'
      ? resolvePartPoseEditorParts(character, layer)
      : [];
  const partPoseAvailable = partPoseParts.length > 0;
  const selectedPartRef = useRef<{
    scope: string;
    partId: string | null;
  }>({ scope: '', partId: null });
  const partPoseScope = `${project.id}:${shot.id}:${layer.id}`;
  if (selectedPartRef.current.scope !== partPoseScope) {
    selectedPartRef.current = { scope: partPoseScope, partId: null };
  }
  const selectedPartIdFromEditor = partPoseParts.find(
    (part) => part.partId === partPoseEditor.selectedPartId,
  )?.partId;
  const selectedPartId =
    selectedPartIdFromEditor ??
    partPoseParts.find(
      (part) => part.partId === selectedPartRef.current.partId,
    )?.partId ??
    partPoseParts.find((part) => part.visible !== false)?.partId ??
    partPoseParts[0]?.partId ??
    null;
  selectedPartRef.current.partId = selectedPartId;
  const actionAvailable =
    Boolean(transformController.positionAuthoringSupported) ||
    partPoseAvailable;
  useEffect(() => {
    partPoseEditor.onActionSectionOpenChange(
      actionAvailable &&
        presentation === 'landscape' &&
        Boolean(actionSectionRef.current?.open),
    );
  }, [actionAvailable, partPoseEditor.onActionSectionOpenChange, presentation]);
  useEffect(
    () => () => partPoseEditor.onActionSectionOpenChange(false),
    [partPoseEditor.onActionSectionOpenChange],
  );
  const actionEditor: PartPoseEditorUi = {
    ...partPoseEditor,
    onStart: (layerId, partId) => {
      transformController.exitPositionAuthoring?.();
      partPoseEditor.onStart(layerId, partId);
    },
    onStartPivot: (layerId, partId) => {
      transformController.exitPositionAuthoring?.();
      partPoseEditor.onStartPivot(layerId, partId);
    },
  };
  const handleActionToggle = (
    event: React.SyntheticEvent<HTMLDetailsElement>,
  ): void => {
    if (event.target !== event.currentTarget) return;
    partPoseEditor.onActionSectionOpenChange(
      event.currentTarget.open && presentation === 'landscape',
    );
    if (event.currentTarget.open) return;
    transformController.exitPositionAuthoring?.();
    if (partPoseEditor.activeLayerId === layer.id) {
      partPoseEditor.onExit();
    }
  };
  const startPositionAuthoring = (): void => {
    if (partPoseEditor.activeLayerId === layer.id) {
      partPoseEditor.onExit();
    }
    transformController.startPositionAuthoring?.();
  };
  const createPositionHold = (): void => {
    if (partPoseEditor.activeLayerId === layer.id) {
      partPoseEditor.onExit();
    }
    transformController.createPositionHold?.();
  };
  const finishPositionAuthoring = (): void => {
    transformController.exitPositionAuthoring?.();
  };

  return (
    <div
      className="right-inspector-compact-sections"
      data-testid="right-inspector-compact-sections"
      ref={sectionsRef}
    >
      <details
        className="right-inspector-section right-inspector-transform-section"
        data-testid="right-inspector-transform-section"
        open
      >
        <summary>变换</summary>
        <LayerTransformPanel
          compact
          controller={transformController}
          showLockControl={false}
          showResetTransform
        />
        <AnimationPlaybackControls />
      </details>
      <details
        className="right-inspector-section right-inspector-appearance-section"
        data-testid="right-inspector-appearance-section"
      >
        <summary>外观</summary>
        <LayerBackgroundControl
          presentation={presentation}
          compact
          transformController={transformController}
        />
      </details>
      <details
        className="right-inspector-section right-inspector-layer-section"
        data-testid="right-inspector-layer-section"
      >
        <summary>图层</summary>
        <LayerOrderControls
          backgroundLayerSelected={backgroundLayerSelected}
          compact
          showLockControl
          presentation={presentation}
        />
      </details>
      {actionAvailable ? (
        <details
          className="right-inspector-section right-inspector-action-section"
          data-testid="right-inspector-action-section"
          onToggle={handleActionToggle}
          ref={actionSectionRef}
        >
          <summary>动作</summary>
          <div className="right-inspector-action-content">
            {transformController.positionAuthoringSupported ? (
              <section
                aria-label="位置"
                className="right-inspector-action-position"
                data-testid="right-inspector-action-position"
              >
                <div className="right-inspector-action-position-heading">
                  <strong>位置</strong>
                  <PositionAuthoringControls
                    controller={transformController}
                    onFinish={finishPositionAuthoring}
                    onHold={createPositionHold}
                    onStart={startPositionAuthoring}
                  />
                </div>
              </section>
            ) : null}
            {partPoseAvailable ? (
              <PartPoseEditorPanel
                editor={actionEditor}
                layer={layer}
                project={project}
                shot={shot}
              />
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}
