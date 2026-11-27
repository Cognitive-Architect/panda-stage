import { useRef, type ReactNode } from 'react';
import {
  LayerBackgroundControl,
  type LayerBackgroundControlProps,
} from '../features/properties/LayerBackgroundControl';
import { LayerOrderControls } from '../features/properties/LayerOrderControls';
import { ShotLayerListPanel } from '../features/properties/ShotLayerListPanel';
import { AnimationPlaybackControls } from '../features/properties/AnimationPlaybackControls';
import {
  LayerTransformPanel,
  useLayerTransformController,
} from '../features/properties/LayerTransformPanel';

export interface PortraitPropertiesSectionsProps {
  backgroundLayerSelected: boolean;
  parentControl?: ReactNode;
  layerListDocked?: boolean;
  presentation?: LayerBackgroundControlProps['presentation'];
}

/**
 * The portrait Properties sections share one transform draft controller so
 * Appearance can present opacity without creating a second commit owner.
 */
export function PortraitPropertiesSections({
  backgroundLayerSelected,
  parentControl,
  layerListDocked = false,
  presentation = 'portrait',
}: PortraitPropertiesSectionsProps): React.JSX.Element {
  const sectionsRef = useRef<HTMLDivElement | null>(null);
  const transformController = useLayerTransformController({
    backgroundLayerSelected,
    compact: true,
    commitBoundaryRef: sectionsRef,
  });

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
        {parentControl}
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
        {!layerListDocked && <ShotLayerListPanel />}
        <LayerOrderControls
          backgroundLayerSelected={backgroundLayerSelected}
          compact
          showLockControl
          presentation={presentation}
        />
      </details>
    </div>
  );
}
