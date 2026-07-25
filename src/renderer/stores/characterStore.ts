import {
  CharacterService,
  type CharacterExpressionDraft,
  type CreateCharacterInput,
  type Project,
} from '../../domain';
import {
  EditorProjectStore,
  editorProjectStore,
} from './EditorProjectStore';

export class CharacterStore {
  constructor(
    private readonly editorStore: EditorProjectStore,
    private readonly service: CharacterService,
  ) {}

  create(input: CreateCharacterInput): Project {
    return this.apply((project) => this.service.create(project, input));
  }

  renameCharacter(characterId: string, name: string): Project {
    return this.apply((project) =>
      this.service.renameCharacter(project, characterId, name),
    );
  }

  deleteCharacter(characterId: string): Project {
    return this.apply((project) =>
      this.service.deleteCharacter(project, characterId),
    );
  }

  addExpression(
    characterId: string,
    draft: CharacterExpressionDraft,
  ): Project {
    return this.apply((project) =>
      this.service.addExpression(project, characterId, draft),
    );
  }

  renameExpression(
    characterId: string,
    expressionId: string,
    name: string,
  ): Project {
    return this.apply((project) =>
      this.service.renameExpression(
        project,
        characterId,
        expressionId,
        name,
      ),
    );
  }

  setExpressionAsset(
    characterId: string,
    expressionId: string,
    assetId: string,
  ): Project {
    return this.apply((project) =>
      this.service.setExpressionAsset(
        project,
        characterId,
        expressionId,
        assetId,
      ),
    );
  }

  removeExpression(
    characterId: string,
    expressionId: string,
  ): Project {
    return this.apply((project) =>
      this.service.removeExpression(project, characterId, expressionId),
    );
  }

  setDefaultExpression(
    characterId: string,
    expressionId: string,
  ): Project {
    return this.apply((project) =>
      this.service.setDefaultExpression(
        project,
        characterId,
        expressionId,
      ),
    );
  }

  setMouthOpenAsset(
    characterId: string,
    assetId: string | null,
  ): Project {
    return this.apply((project) =>
      this.service.setMouthOpenAsset(project, characterId, assetId),
    );
  }

  setDefaultTransform(
    characterId: string,
    scale: number,
    flipX: boolean,
  ): Project {
    return this.apply((project) =>
      this.service.setDefaultTransform(
        project,
        characterId,
        scale,
        flipX,
      ),
    );
  }

  dimensionWarnings(characterId: string) {
    const snapshot = this.editorStore.getSnapshot();
    if (!snapshot) return [];
    return this.service.dimensionWarnings(snapshot.project, characterId);
  }

  private apply(mutation: (project: Project) => Project): Project {
    const snapshot = this.editorStore.getSnapshot();
    if (!snapshot) throw new Error('请先打开项目。');
    const project = mutation(snapshot.project);
    this.editorStore.updateProject(project);
    return project;
  }
}

export const characterStore = new CharacterStore(
  editorProjectStore,
  new CharacterService(),
);
