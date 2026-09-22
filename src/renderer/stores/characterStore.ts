import {
  CharacterService,
  type CharacterExpressionAssetUpdate,
  type CharacterExpressionDraft,
  type CompositeCharacterDefinition,
  type CompositeCharacterUpdate,
  type CreateCharacterInput,
  type CreateCompositeCharacterInput,
  type FacePlacement,
  type Project,
} from '../../domain';
import {
  EditorProjectStore,
  editorProjectStore,
  type EditorProjectSnapshot,
} from './EditorProjectStore';

export class CharacterStoreStaleError extends Error {
  constructor(message = 'Character command target became stale before commit.') {
    super(message);
    this.name = 'CharacterStoreStaleError';
  }
}

export class CharacterStore {
  constructor(
    private readonly editorStore: EditorProjectStore,
    private readonly service: CharacterService,
  ) {}

  create(input: CreateCharacterInput): Project {
    return this.apply(
      (project) => this.service.create(project, input),
      'Create character',
    );
  }

  createComposite(input: CreateCompositeCharacterInput): Project {
    return this.apply(
      (project) => this.service.createComposite(project, input),
      'Create composite character',
    );
  }

  getCompositeDefinition(
    characterId: string,
  ): CompositeCharacterDefinition {
    const snapshot = this.requireSnapshot();
    return this.service.getCompositeDefinition(
      snapshot.project,
      characterId,
    );
  }

  applyCompositeDefinition(
    characterId: string,
    definition: CompositeCharacterDefinition,
    expectedSnapshot?: EditorProjectSnapshot,
  ): Project {
    return this.apply(
      (project) =>
        this.service.applyCompositeDefinition(
          project,
          characterId,
          definition,
        ),
      'Apply composite character',
      expectedSnapshot,
    );
  }

  applyCompositeUpdate(
    characterId: string,
    update: CompositeCharacterUpdate,
    expectedSnapshot?: EditorProjectSnapshot,
  ): Project {
    return this.apply(
      (project) =>
        this.service.applyCompositeUpdate(project, characterId, update),
      'Apply composite character',
      expectedSnapshot,
    );
  }

  replaceBodyAsset(
    characterId: string,
    bodyAssetId: string,
    expectedSnapshot?: EditorProjectSnapshot,
  ): Project {
    return this.apply(
      (project) =>
        this.service.replaceBodyAsset(project, characterId, bodyAssetId),
      'Replace character Body',
      expectedSnapshot,
    );
  }

  setFacePlacement(
    characterId: string,
    facePlacement: FacePlacement,
    expectedSnapshot?: EditorProjectSnapshot,
  ): Project {
    return this.apply(
      (project) =>
        this.service.setFacePlacement(project, characterId, facePlacement),
      'Set character Face Placement',
      expectedSnapshot,
    );
  }

  setCompositeExpressionAssets(
    characterId: string,
    expressionAssets: readonly CharacterExpressionAssetUpdate[],
    expectedSnapshot?: EditorProjectSnapshot,
  ): Project {
    return this.apply(
      (project) =>
        this.service.setCompositeExpressionAssets(
          project,
          characterId,
          expressionAssets,
        ),
      'Update character Expressions',
      expectedSnapshot,
    );
  }

  setCompositeMouthOpenAsset(
    characterId: string,
    mouthOpenAssetId: string | null,
    expectedSnapshot?: EditorProjectSnapshot,
  ): Project {
    return this.apply(
      (project) =>
        this.service.setCompositeMouthOpenAsset(
          project,
          characterId,
          mouthOpenAssetId,
        ),
      'Update character Mouth image',
      expectedSnapshot,
    );
  }

  renameCharacter(characterId: string, name: string): Project {
    return this.apply(
      (project) =>
        this.service.renameCharacter(project, characterId, name),
      'Rename character',
    );
  }

  deleteCharacter(characterId: string): Project {
    return this.apply(
      (project) => this.service.deleteCharacter(project, characterId),
      'Delete character',
    );
  }

  addExpression(
    characterId: string,
    draft: CharacterExpressionDraft,
  ): Project {
    return this.apply(
      (project) => this.service.addExpression(project, characterId, draft),
      'Add expression',
    );
  }

  renameExpression(
    characterId: string,
    expressionId: string,
    name: string,
  ): Project {
    return this.apply(
      (project) =>
        this.service.renameExpression(
          project,
          characterId,
          expressionId,
          name,
        ),
      'Rename expression',
    );
  }

  setExpressionAsset(
    characterId: string,
    expressionId: string,
    assetId: string,
  ): Project {
    return this.apply(
      (project) =>
        this.service.setExpressionAsset(
          project,
          characterId,
          expressionId,
          assetId,
        ),
      'Change expression image',
    );
  }

  removeExpression(
    characterId: string,
    expressionId: string,
  ): Project {
    return this.apply(
      (project) =>
        this.service.removeExpression(project, characterId, expressionId),
      'Delete expression',
    );
  }

  setDefaultExpression(
    characterId: string,
    expressionId: string,
  ): Project {
    return this.apply(
      (project) =>
        this.service.setDefaultExpression(
          project,
          characterId,
          expressionId,
        ),
      'Set default expression',
    );
  }

  setMouthOpenAsset(
    characterId: string,
    assetId: string | null,
  ): Project {
    return this.apply(
      (project) =>
        this.service.setMouthOpenAsset(project, characterId, assetId),
      'Change mouth-open image',
    );
  }

  setDefaultTransform(
    characterId: string,
    scale: number,
    flipX: boolean,
  ): Project {
    return this.apply(
      (project) =>
        this.service.setDefaultTransform(
          project,
          characterId,
          scale,
          flipX,
        ),
      'Change character transform',
    );
  }

  dimensionWarnings(characterId: string) {
    const snapshot = this.editorStore.getSnapshot();
    if (!snapshot) return [];
    return this.service.dimensionWarnings(snapshot.project, characterId);
  }

  private apply(
    mutation: (project: Project) => Project,
    label: string,
    expectedSnapshot?: EditorProjectSnapshot,
  ): Project {
    const snapshot = this.editorStore.getSnapshot();
    if (!snapshot) throw new Error('请先打开项目。');
    if (expectedSnapshot && snapshot !== expectedSnapshot) {
      throw new CharacterStoreStaleError();
    }

    const project = mutation(snapshot.project);
    const current = this.editorStore.getSnapshot();
    if (
      !current ||
      current !== snapshot ||
      current.projectRoot !== snapshot.projectRoot ||
      current.project.id !== snapshot.project.id ||
      current.revision !== snapshot.revision ||
      JSON.stringify(current.project) !== JSON.stringify(snapshot.project)
    ) {
      throw new CharacterStoreStaleError();
    }
    if (
      project === snapshot.project ||
      JSON.stringify(project) === JSON.stringify(snapshot.project)
    ) {
      return snapshot.project;
    }
    this.editorStore.updateProject(project, label);
    return project;
  }

  private requireSnapshot(): EditorProjectSnapshot {
    const snapshot = this.editorStore.getSnapshot();
    if (!snapshot) throw new Error('请先打开项目。');
    return snapshot;
  }
}

export const characterStore = new CharacterStore(
  editorProjectStore,
  new CharacterService(),
);
