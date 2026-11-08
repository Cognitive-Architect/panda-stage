import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DialogueAuthoringDraft,
  validateSingleDialogueDraft,
} from '../../src/renderer/features/dialogue/dialogueAuthoringDraft';
import { DialogueSpeakerControl } from '../../src/renderer/features/dialogue/DialogueSpeakerControl';
import { dialogueSpeakerName } from '../../src/renderer/features/dialogue/dialogueSpeaker';
import { buildProject } from './domain/testProject';

const project = buildProject();
const character = project.characters[0]!;

describe('VOICE-01 narration authoring draft', () => {
  it('requires no character once the speaker is 旁白', () => {
    expect(
      validateSingleDialogueDraft(
        { singleSpeakerType: 'narrator', singleCharacterId: '', singleText: '旁白文本' },
        [character.id],
      ),
    ).toEqual({ speaker: null, text: null });
  });

  it('keeps the character speaker requirement unchanged', () => {
    expect(
      validateSingleDialogueDraft(
        { singleCharacterId: '', singleText: '文本' },
        [character.id],
      ).speaker,
    ).toBe('请选择角色。');
  });

  it('clears the stale character when switching to 旁白 and back', () => {
    const draft = new DialogueAuthoringDraft();
    draft.setSingleCharacterId(character.id);
    draft.setSingleSpeakerType('narrator');
    expect(draft.getSnapshot().singleCharacterId).toBe('');
    expect(draft.getSnapshot().singleSpeakerType).toBe('narrator');

    draft.setSingleSpeakerType('character');
    expect(draft.getSnapshot().singleSpeakerType).toBe('character');
  });
});

describe('VOICE-01 narration speaker presentation', () => {
  it('offers 旁白 as a fixed option next to the character list', () => {
    const markup = renderToStaticMarkup(
      createElement(DialogueSpeakerControl, {
        characters: [character],
        narrator: false,
        onSelectCharacter: () => undefined,
        onSelectNarrator: () => undefined,
        selectedCharacterId: character.id,
        thumbnails: {},
        testId: 'speaker',
      }),
    );

    expect(markup).toContain('data-testid="speaker-narrator-option"');
    expect(markup).toContain('旁白');
  });

  it('shows the narration speaker without any character selection', () => {
    const markup = renderToStaticMarkup(
      createElement(DialogueSpeakerControl, {
        characters: [character],
        narrator: true,
        onSelectCharacter: () => undefined,
        onSelectNarrator: () => undefined,
        selectedCharacterId: null,
        thumbnails: {},
        testId: 'speaker',
      }),
    );

    expect(markup).toContain('data-testid="speaker-narrator"');
    expect(markup).toContain('改选角色');
    expect(markup).not.toContain('character-identity-picker');
  });

  it('names narration and character speakers without leaking ids', () => {
    expect(
      dialogueSpeakerName(
        { speakerType: 'narrator', characterId: undefined },
        [character],
      ),
    ).toBe('旁白');
    expect(
      dialogueSpeakerName({ characterId: character.id }, [character]),
    ).toBe(character.name);
  });
});
