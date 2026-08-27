import { useRef } from 'react';
import { LayerBackgroundControl } from '../features/properties/LayerBackgroundControl';
import { LayerOrderControls } from '../features/properties/LayerOrderControls';
import {
  LayerTransformPanel,
  useLayerTransformController,
} from '../features/properties/LayerTransformPanel';

export interface PortraitPropertiesSectionsProps {
  backgroundLayerSelected: boolean;
}

/**
 * The portrait Properties sections share one transform draft controller so
 * Appearance can present opacity without creating a second commit owner.
 */
export function PortraitPropertiesSections({
  backgroundLayerSelected,
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
      </details>
      <details
        className="right-inspector-section right-inspector-appearance-section"
        data-testid="right-inspector-appearance-section"
      >
        <summary>外观</summary>
        <LayerBackgroundControl
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
        />
      </details>
    </div>
  );
}
