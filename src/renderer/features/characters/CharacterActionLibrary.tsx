import { useSyncExternalStore } from 'react';
import { characterAssemblySessionStore } from '../../stores/characterAssemblySessionStore';
import { characterStore } from '../../stores/characterStore';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { CharacterActionEditor } from './CharacterActionEditor';
import { isCharacterAssemblyPending } from './characterAssemblyPreview';

const pendingMessage = '请先应用或取消组装更改。';

/** Both character workspaces use the same guard and formal action commands. */
export function CharacterActionLibrary({ snapshot, characterId }: {
  snapshot: EditorProjectSnapshot;
  characterId: string;
}): React.JSX.Element {
  const session = useSyncExternalStore(
    characterAssemblySessionStore.subscribe,
    characterAssemblySessionStore.getSnapshot,
  );
  const character = snapshot.project.characters.find((entry) => entry.id === characterId) ?? null;
  const pending = session !== null && isCharacterAssemblyPending(snapshot.project, session);

  const guardMutation = (): void => {
    const current = editorProjectStore.getSnapshot();
    const liveSession = characterAssemblySessionStore.getSnapshot();
    if (!current || current.projectRoot !== snapshot.projectRoot || current.project.id !== snapshot.project.id) {
      throw new Error('请重新打开角色后再试。');
    }
    if (liveSession && isCharacterAssemblyPending(current.project, liveSession)) throw new Error(pendingMessage);
  };

  return <CharacterActionEditor
    key={characterId}
    character={character}
    project={snapshot.project}
    projectRoot={snapshot.projectRoot}
    disabled={pending}
    disabledReason={pending ? pendingMessage : undefined}
    onSave={(draft) => {
      guardMutation();
      characterStore.setAction(characterId, draft);
    }}
    onDelete={(actionId) => {
      guardMutation();
      characterStore.removeAction(characterId, actionId);
    }}
  />;
}
