import type { DragEvent, ReactNode } from 'react';
import type { Shot } from '../../../domain';
import { formatShotDuration, formatCompactShotDuration } from './ShotEditor';
import { ShotThumbnailPlaceholder } from './ShotThumbnailPlaceholder';
import { GripVertical } from 'lucide-react';

const SHOT_DRAG_TYPE = 'application/x-panda-stage-shot';

export interface ShotListItemProps {
  disabled?: boolean;
  index: number;
  selected: boolean;
  shot: Shot;
  onDropShot: (shotId: string, targetIndex: number) => void;
  onSelect: (shotId: string) => void;
  selectedActions?: ReactNode;
  compactDuration?: boolean;
}

export function ShotListItem({
  disabled = false,
  index,
  selected,
  shot,
  onDropShot,
  onSelect,
  selectedActions,
  compactDuration = false,
}: ShotListItemProps): React.JSX.Element {
  const startDrag = (event: DragEvent<HTMLLIElement>): void => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(SHOT_DRAG_TYPE, shot.id);
  };
  const drop = (event: DragEvent<HTMLLIElement>): void => {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData(SHOT_DRAG_TYPE);
    if (sourceId) onDropShot(sourceId, index);
  };

  return (
    <li
      className={selected ? 'shot-list-item shot-list-item-selected' : 'shot-list-item'}
      data-shot-id={shot.id}
      draggable={!disabled}
      onDragOver={(event) => event.preventDefault()}
      onDragStart={startDrag}
      onDrop={drop}
    >
      <button
        aria-current={selected ? 'true' : undefined}
        disabled={disabled}
        onClick={() => onSelect(shot.id)}
        type="button"
      >
        <ShotThumbnailPlaceholder index={index} name={shot.name} />
        <span>
          <strong>{shot.name}</strong>
          <small>
            {compactDuration
              ? formatCompactShotDuration(shot.durationMs)
              : formatShotDuration(shot.durationMs)}
          </small>
        </span>
        <span className="shot-drag-handle" aria-label="拖拽排序">
          <GripVertical aria-hidden="true" className="ui-icon" focusable="false" size={18} />
        </span>
      </button>
      {selected && selectedActions ? (
        <div className="shot-list-item-actions" data-testid="shot-selected-actions">
          {selectedActions}
        </div>
      ) : null}
    </li>
  );
}
