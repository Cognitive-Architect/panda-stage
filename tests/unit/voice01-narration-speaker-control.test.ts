// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Character } from '../../src/domain';
import { DialogueSpeakerControl } from '../../src/renderer/features/dialogue/DialogueSpeakerControl';
import { buildProject } from './domain/testProject';

type SpeakerCommit =
  | { type: 'narrator' }
  | { type: 'character'; characterId: string };

const project = buildProject();
const panda = project.characters[0]!;
const lisi: Character = {
  ...panda,
  id: '10000000-0000-4000-8000-000000000031',
  name: '李四',
  defaultVoiceProfileId: '10000000-0000-4000-8000-000000000032',
};
const characters: readonly Character[] = [panda, lisi];

let commits: SpeakerCommit[] = [];
let container: HTMLDivElement;
let root: Root;

/**
 * Mirrors the inspector wiring: the committed speaker lives outside the control
 * and is projected back in as `narrator` / `selectedCharacterId`.
 */
function Harness({ initialNarrator }: { initialNarrator: boolean }) {
  const [narrator, setNarrator] = useState(initialNarrator);
  const [characterId, setCharacterId] = useState<string | null>(null);
  return createElement(DialogueSpeakerControl, {
    characters,
    defaultOpen: true,
    narrator,
    onSelectCharacter: (nextCharacterId: string) => {
      commits.push({ type: 'character', characterId: nextCharacterId });
      setNarrator(false);
      setCharacterId(nextCharacterId);
    },
    onSelectNarrator: () => {
      commits.push({ type: 'narrator' });
      setNarrator(true);
      setCharacterId(null);
    },
    selectedCharacterId: characterId,
    testId: 'speaker',
    thumbnails: {},
  });
}

function query(selector: string): Element | null {
  return container.querySelector(selector);
}

async function click(selector: string): Promise<void> {
  const element = query(selector);
  if (!element) throw new Error(`Missing click target: ${selector}.`);
  await act(async () => {
    (element as HTMLElement).click();
  });
}

async function renderHarness(initialNarrator: boolean): Promise<void> {
  await act(async () =>
    root.render(createElement(Harness, { initialNarrator })),
  );
}

beforeEach(() => {
  commits = [];
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('VOICE-01 narration speaker control interaction', () => {
  it('returns to the narration row after 旁白 → 改选角色 → 旁白', async () => {
    await renderHarness(true);

    expect(query('[data-testid="speaker-narrator"]')).not.toBeNull();
    expect(query('[data-testid="speaker"]')).toBeNull();

    await click('.dialogue-speaker-narrator-switch');

    // "改选角色" only reveals the picker; the committed speaker stays narration.
    expect(query('[data-testid="speaker-narrator"]')).toBeNull();
    expect(query('[data-testid="speaker"]')).not.toBeNull();
    expect(query('[data-testid="speaker-narrator-option"]')).not.toBeNull();
    expect(
      query('[data-testid="speaker-narrator-option"]')?.getAttribute(
        'aria-pressed',
      ),
    ).toBe('true');
    expect(commits).toEqual([]);

    await click('[data-testid="speaker-narrator-option"]');

    // Re-picking 旁白 must also leave the "改选角色" reveal.
    expect(query('[data-testid="speaker-narrator"]')).not.toBeNull();
    expect(query('[data-testid="speaker-narrator"]')?.textContent).toContain(
      '改选角色',
    );
    expect(query('[data-testid="speaker"]')).toBeNull();
    expect(query('[data-testid="speaker-narrator-option"]')).toBeNull();
    expect(commits).toEqual([{ type: 'narrator' }]);
  });

  it('still commits a real character chosen through 改选角色', async () => {
    await renderHarness(true);
    await click('.dialogue-speaker-narrator-switch');

    const option = `[role="radio"][data-character-id="${lisi.id}"]`;
    await click(option);

    expect(commits).toEqual([{ type: 'character', characterId: lisi.id }]);
    expect(query('[data-testid="speaker-narrator"]')).toBeNull();
    expect(query('[data-testid="speaker"]')).not.toBeNull();
    expect(query(option)?.getAttribute('aria-checked')).toBe('true');
    expect(query('[data-testid="speaker-narrator-option"]')).not.toBeNull();
  });

  it('keeps the character speaker field unchanged for character dialogues', async () => {
    await renderHarness(false);

    expect(query('[data-testid="speaker"]')).not.toBeNull();
    expect(query('[data-testid="speaker-narrator"]')).toBeNull();

    await click('[data-testid="speaker-narrator-option"]');

    expect(commits).toEqual([{ type: 'narrator' }]);
    expect(query('[data-testid="speaker-narrator"]')).not.toBeNull();
    expect(query('[data-testid="speaker"]')).toBeNull();
  });
});
