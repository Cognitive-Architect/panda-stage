import type { Project } from '../models';

/**
 * One script label is confirmed once for the whole script. The same binding
 * feeds the AUTO-04 cast, the AUTO-05 Dialogue.characterId and the numbered
 * audio role-name check, so the three can never disagree about a speaker.
 */
export type SpeakerBindings = Readonly<Record<string, string>>;

export interface SpeakerBindingReport {
  readonly labels: readonly string[];
  /** Only resolved labels are present; unresolved ones stay out on purpose. */
  readonly bindings: SpeakerBindings;
  readonly unresolved: readonly string[];
  readonly ready: boolean;
}

function sameName(left: string, right: string): boolean {
  return left.normalize('NFC') === right.normalize('NFC');
}

export function canonicalCharacterName(
  project: Project,
  characterId: string,
): string | null {
  return (
    project.characters.find((character) => character.id === characterId)?.name ??
    null
  );
}

/**
 * exact-name + one candidate binds automatically. Unknown, ambiguous or stale
 * manual picks stay unresolved and block the whole batch; no alias dictionary,
 * no fuzzy matching, no silent character creation.
 */
export function resolveSpeakerBindings(
  project: Project,
  labels: readonly string[],
  overrides: SpeakerBindings = {},
): SpeakerBindingReport {
  const bindings: Record<string, string> = {};
  const unresolved: string[] = [];

  for (const label of labels) {
    const explicit = overrides[label];
    if (explicit !== undefined) {
      if (project.characters.some((character) => character.id === explicit)) {
        bindings[label] = explicit;
      } else {
        unresolved.push(label);
      }
      continue;
    }
    const exact = project.characters.filter((character) =>
      sameName(character.name, label),
    );
    if (exact.length === 1) {
      bindings[label] = exact[0]!.id;
    } else {
      unresolved.push(label);
    }
  }

  return {
    labels,
    bindings,
    unresolved,
    ready: labels.length > 0 && unresolved.length === 0,
  };
}
