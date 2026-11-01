import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { DecorativeIcon } from '../../ui';

export interface FlaCharacterImportPartsControlProps {
  expanded: boolean;
  partCount: number;
  disabled: boolean;
  onToggle: () => void;
}

export function FlaCharacterImportPartsControl({
  expanded,
  partCount,
  disabled,
  onToggle,
}: FlaCharacterImportPartsControlProps): React.JSX.Element {
  if (expanded) {
    return (
      <header className="fla-character-import-parts-header">
        <h2 className="fla-character-import-parts-heading">零件 {partCount}</h2>
        <button
          aria-controls="fla-character-import-parts"
          aria-expanded="true"
          aria-label="收起零件"
          className="fla-character-import-parts-collapse"
          data-testid="fla-character-import-parts-toggle"
          disabled={disabled}
          onClick={onToggle}
          type="button"
        >
          <DecorativeIcon icon={ChevronRight} size={18} />
        </button>
      </header>
    );
  }

  return (
    <button
      aria-controls="fla-character-import-parts"
      aria-expanded="false"
      aria-label={`展开零件，${partCount} 个`}
      className="fla-character-import-parts-toggle"
      data-testid="fla-character-import-parts-toggle"
      disabled={disabled}
      onClick={onToggle}
      type="button"
    >
      <DecorativeIcon icon={Layers} size={16} />
      <span>零件 {partCount}</span>
      <DecorativeIcon icon={ChevronDown} size={16} />
    </button>
  );
}
