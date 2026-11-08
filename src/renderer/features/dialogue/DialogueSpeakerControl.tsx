import { useState } from 'react';
import { Mic } from 'lucide-react';
import type { Character } from '../../../domain';
import { DecorativeIcon } from '../../ui';
import {
  CharacterIdentityPicker,
} from '../characters/CharacterIdentity';
import type { ThumbnailState } from '../assets/AssetCard';
import { NARRATOR_SPEAKER_NAME } from './dialogueSpeaker';

export interface NarratorSpeakerRowProps {
  /** User-facing way back to a real Character speaker. */
  onSelectCharacter: () => void;
  testId?: string;
  className?: string;
}

/**
 * The chosen "旁白" speaker: a fixed, formless speaker option inside the normal
 * subtitle speaker field. It is not a Character and never appears on Canvas.
 */
export function NarratorSpeakerRow({
  onSelectCharacter,
  testId,
  className,
}: NarratorSpeakerRowProps): React.JSX.Element {
  return (
    <div
      className={['dialogue-speaker-narrator', className]
        .filter(Boolean)
        .join(' ')}
      data-testid={testId}
    >
      <DecorativeIcon
        aria-hidden="true"
        className="dialogue-speaker-narrator-icon"
        icon={Mic}
        size={16}
        strokeWidth={1.8}
      />
      <span className="dialogue-speaker-narrator-copy">
        <strong>{NARRATOR_SPEAKER_NAME}</strong>
        <small>无形象</small>
      </span>
      <button
        className="dialogue-speaker-narrator-switch"
        onClick={onSelectCharacter}
        type="button"
      >
        改选角色
      </button>
    </div>
  );
}

/** The "旁白" option offered next to the existing Character list. */
export function NarratorSpeakerOption({
  onSelect,
  selected = false,
  testId,
}: {
  onSelect: () => void;
  selected?: boolean;
  testId?: string;
}): React.JSX.Element {
  return (
    <button
      aria-pressed={selected}
      className="dialogue-speaker-narrator-option"
      data-selected={String(selected)}
      data-testid={testId}
      onClick={onSelect}
      type="button"
    >
      <DecorativeIcon
        aria-hidden="true"
        className="ui-icon"
        icon={Mic}
        size={15}
        strokeWidth={1.8}
      />
      <span>{NARRATOR_SPEAKER_NAME}</span>
    </button>
  );
}

export interface DialogueSpeakerControlProps {
  characters: readonly Character[];
  thumbnails: Readonly<Record<string, ThumbnailState>>;
  onThumbnailError?: (assetId: string) => void;
  narrator: boolean;
  selectedCharacterId: string | null;
  onSelectCharacter: (characterId: string) => void;
  onSelectNarrator: () => void;
  ariaLabel?: string;
  className?: string;
  defaultOpen?: boolean;
  selectedLabel?: string;
  showDefaultExpression?: boolean;
  testId?: string;
  disabled?: boolean;
}

/**
 * Speaker field for an already committed Dialogue. Choosing 旁白 commits the
 * narration speaker; "改选角色" only reveals the existing Character picker, so
 * the committed Dialogue is never left without a valid speaker.
 */
export function DialogueSpeakerControl({
  characters,
  thumbnails,
  onThumbnailError,
  narrator,
  selectedCharacterId,
  onSelectCharacter,
  onSelectNarrator,
  ariaLabel,
  className,
  defaultOpen = false,
  selectedLabel,
  showDefaultExpression = true,
  testId,
  disabled = false,
}: DialogueSpeakerControlProps): React.JSX.Element {
  const [switchingToCharacter, setSwitchingToCharacter] = useState(false);
  if (narrator && !switchingToCharacter) {
    return (
      <NarratorSpeakerRow
        onSelectCharacter={() => setSwitchingToCharacter(true)}
        testId={testId ? `${testId}-narrator` : undefined}
      />
    );
  }
  return (
    <div className="dialogue-speaker-control">
      <CharacterIdentityPicker
        ariaLabel={ariaLabel}
        characters={characters}
        className={className}
        defaultOpen={defaultOpen}
        disabled={disabled}
        onSelect={(characterId) => {
          setSwitchingToCharacter(false);
          onSelectCharacter(characterId);
        }}
        onThumbnailError={onThumbnailError}
        selectedCharacterId={selectedCharacterId}
        selectedLabel={selectedLabel}
        showDefaultExpression={showDefaultExpression}
        testId={testId}
        thumbnails={thumbnails}
      />
      <NarratorSpeakerOption
        onSelect={() => {
          // Re-picking 旁白 must also leave the "改选角色" reveal, otherwise the
          // control stays on the Character picker while the speaker is already
          // narration.
          setSwitchingToCharacter(false);
          onSelectNarrator();
        }}
        selected={narrator}
        testId={testId ? `${testId}-narrator-option` : undefined}
      />
    </div>
  );
}
