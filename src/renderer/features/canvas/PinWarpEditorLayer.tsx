import { useMemo, useState } from 'react';
import type Konva from 'konva';
import { Group, Rect } from 'react-konva';
import { evaluatePinWarpMesh, type PinWarpPoint } from '../../../domain';
import { PinWarpImage } from '../../stage/PinWarpImage';
import { PinWarpPins } from './PinWarpPins';
import type {
  SelectableLayerPinWarp,
  SelectableLayerPinWarpEditing,
} from './SelectableLayer';

export interface PinWarpEditorLayerProps {
  image: HTMLImageElement;
  pinWarp: SelectableLayerPinWarp;
  editing: SelectableLayerPinWarpEditing | null;
  canSelect: boolean;
  bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  onSelect: (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
}

function pinStateKey(pinWarp: SelectableLayerPinWarp): string {
  return `${pinWarp.rect.x},${pinWarp.rect.y},${pinWarp.rect.width},${pinWarp.rect.height}|${pinWarp.restPins
    .map((pin) => `${pin.x},${pin.y}`)
    .join(';')}|${pinWarp.pins.map((pin) => `${pin.x},${pin.y}`).join(';')}`;
}

/**
 * Editor-only rendering of one pin-warped bitmap Layer (#1460): the shared
 * warped bitmap plus the dragged pin handles.
 *
 * A drag preview keeps local `draft` pins and recomputes the same pure
 * `evaluatePinWarpMesh` so the bitmap bends live; nothing is written until
 * pointer-up, where the owning Layer's `onCommitPin` performs the single
 * project write. The committed mesh remains owned by the formal evaluation;
 * a stale draft (time/Layer/pin change) is ignored instead of shown.
 */
export function PinWarpEditorLayer({
  image,
  pinWarp,
  editing,
  canSelect,
  bounds,
  onSelect,
}: PinWarpEditorLayerProps): React.JSX.Element {
  const key = pinStateKey(pinWarp);
  const [draft, setDraft] = useState<{
    key: string;
    pins: readonly PinWarpPoint[];
  } | null>(null);
  const activePins =
    draft && draft.key === key ? draft.pins : pinWarp.pins;
  const previewMesh = useMemo(() => {
    const result = evaluatePinWarpMesh({
      restPins: pinWarp.restPins,
      pins: activePins,
      mesh: pinWarp.mesh,
      rect: pinWarp.rect,
    });
    return result.status === 'valid' ? result.mesh : null;
  }, [activePins, pinWarp]);
  const mesh = previewMesh ?? pinWarp.committed;
  const previewPin = (pinIndex: number, point: PinWarpPoint): void => {
    setDraft((current) => {
      const base = current && current.key === key ? current.pins : pinWarp.pins;
      return {
        key,
        pins: base.map((pin, index) =>
          index === pinIndex ? { x: point.x, y: point.y } : pin,
        ),
      };
    });
  };
  const commitPin = (pinIndex: number, point: PinWarpPoint): void => {
    setDraft(null);
    editing?.onCommitPin(pinIndex, point);
  };
  return (
    <Group listening={canSelect} onClick={onSelect} onTap={onSelect}>
      <PinWarpImage image={image} mesh={mesh} />
      <Rect
        fill="transparent"
        height={bounds.height}
        listening={canSelect}
        width={bounds.width}
        x={bounds.x}
        y={bounds.y}
      />
      {editing ? (
        <PinWarpPins
          draggable={editing.enabled}
          onCommit={commitPin}
          onPreview={previewPin}
          pins={activePins}
          radius={editing.pinRadius}
        />
      ) : null}
    </Group>
  );
}
