import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  PROJECT_HEIGHT,
  PROJECT_WIDTH,
  ProjectSchema,
  type Project,
  type ImageAsset,
} from '../../src/domain';
import {
  CharacterEditor,
  isDefaultTransformPending,
} from '../../src/renderer/features/characters/CharacterEditor';
import { placeCharacterInCurrentShot } from '../../src/renderer/features/characters/CharacterManager';
import { bindTimelineRulerScroll } from '../../src/renderer/features/timeline/TimelineDock';
import { characterAssemblySessionStore } from '../../src/renderer/stores/characterAssemblySessionStore';
import { characterStore } from '../../src/renderer/stores/characterStore';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { layerStore } from '../../src/renderer/stores/layerStore';
import { positionAuthoringSessionStore } from '../../src/renderer/stores/positionAuthoringSessionStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';
import { buildProject, IDS } from './domain/testProject';

function open(project: Project = buildProject()): void {
  editorProjectStore.open('D:/r07-placement.pandastage', project);
  shotStore.select(IDS.shot);
  selectionStore.select(IDS.layerAsset);
  timelineUiStore.seek(0, project.shots[0]!.durationMs);
  timelineUiStore.setScrollPx(0);
  timelineUiStore.setZoom(1);
}

function place(overrides: Partial<Parameters<typeof placeCharacterInCurrentShot>[0]> = {}) {
  const statuses: string[] = [];
  placeCharacterInCurrentShot({
    characterId: IDS.character,
    getCurrentCharacterId: () => IDS.character,
    defaultTransformPending: false,
    leaveAssembly: () => true,
    reportStatus: (message) => statuses.push(message),
    ...overrides,
  });
  return statuses;
}

function compositeProject(): Project {
  const project = buildProject();
  return ProjectSchema.parse({
    ...project,
    characters: [{
      ...project.characters[0]!,
      mode: 'composite',
      bodyAssetId: IDS.assetBg,
      facePlacement: { offsetX: 8, offsetY: -4, scale: 1 },
    }],
  });
}

beforeEach(() => open());

describe('Issue #639 Character detail placement bridge', () => {
  it('shows a primary touch action in detail and disables it without a Shot/default Expression', () => {
    const project = buildProject();
    const imageAssets = project.assets.filter(
      (asset): asset is ImageAsset => asset.kind === 'image',
    );
    const render = (hasCurrentShot: boolean, assets = imageAssets) =>
      renderToStaticMarkup(createElement(CharacterEditor, {
        character: project.characters[0]!,
        imageAssets: assets,
        thumbnails: {},
        warnings: [],
        onRenameCharacter: () => undefined,
        onDeleteCharacter: () => undefined,
        onAddExpression: () => undefined,
        onRenameExpression: () => undefined,
        onSetExpressionAsset: () => undefined,
        onRemoveExpression: () => undefined,
        onSetDefaultExpression: () => undefined,
        onSetMouthOpenAsset: () => undefined,
        onSetDefaultTransform: () => undefined,
        onThumbnailError: () => undefined,
        hasCurrentShot,
        onPlaceInCurrentShot: () => undefined,
        view: 'detail',
        presentation: 'landscape',
      }));

    expect(render(true)).toContain('data-testid="character-detail-place-current-shot"');
    expect(render(true)).toContain('data-ui-variant="primary"');
    expect(render(true)).toContain('加入当前镜头');
    expect(render(false)).toContain('title="请先选择镜头"');
    expect(render(false)).toContain('disabled=""');
    expect(render(true, [])).toContain('title="默认表情素材不可用"');
    const editorSource = readFileSync('src/renderer/features/characters/CharacterEditor.tsx', 'utf8');
    const managerSource = readFileSync('src/renderer/features/characters/CharacterManager.tsx', 'utf8');
    expect(isDefaultTransformPending(project.characters[0]!, 2, false)).toBe(true);
    expect(editorSource).toContain('placementBlockedByTransform');
    expect(editorSource).toContain('disabled={placementUnavailableReason !== null}');
    expect(editorSource).toContain('先应用角色大小设置');
    expect(managerSource).toContain('onPlaceInCurrentShot={(defaultTransformPending) =>');
    expect(readOrderedStylesheetSource()).toContain('min-height: var(--ui-touch-icon);');
  });

  it('uses the formal default Expression even when it is not the first row', () => {
    const project = buildProject();
    open(ProjectSchema.parse({
      ...project,
      characters: [{
        ...project.characters[0]!,
        defaultExpressionId: IDS.expressionAngry,
        baseAssetId: IDS.assetChar2,
      }],
    }));
    place();
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.layers.at(-1)!.source).toEqual({
      kind: 'character', characterId: IDS.character, expressionId: IDS.expressionAngry,
    });
  });

  it('returns a 0:00 scroll-only viewport before creating one Layer', () => {
    timelineUiStore.setZoom(4);
    timelineUiStore.setScrollPx(180);
    const before = editorProjectStore.getSnapshot()!;
    const history = editorProjectStore.history.getSnapshot();
    place();
    expect(timelineUiStore.getSnapshot()).toMatchObject({ currentTimeMs: 0, scrollPx: 0, zoom: 4 });
    expect(editorProjectStore.getSnapshot()!.revision).toBe(before.revision + 1);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(history.undoCount + 1);
  });

  it('uses the mounted Timeline ruler binding during Character placement', () => {
    timelineUiStore.seek(1_000, 3_000);
    timelineUiStore.setScrollPx(180);
    const rulerScroll = { scrollLeft: 180 };
    const unbind = bindTimelineRulerScroll(rulerScroll);
    const beforeLayers = editorProjectStore.getSnapshot()!.project.shots[0]!.layers.length;

    place();
    unbind();

    expect(timelineUiStore.getSnapshot()).toMatchObject({ currentTimeMs: 0, scrollPx: 0 });
    expect(rulerScroll.scrollLeft).toBe(0);
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.layers)
      .toHaveLength(beforeLayers + 1);
  });

  it('creates exactly one formal Character Layer at Base and restores it with Undo/Redo', () => {
    characterStore.setDefaultTransform(IDS.character, 1.7, true);
    const before = editorProjectStore.getSnapshot()!;
    const beforeUndoCount = editorProjectStore.history.getSnapshot().undoCount;
    const beforeLayers = before.project.shots[0]!.layers.length;
    timelineUiStore.setZoom(4);
    timelineUiStore.seek(1_000, before.project.shots[0]!.durationMs);
    timelineUiStore.setScrollPx(240);
    const authoring = positionAuthoringSessionStore.begin();
    expect(authoring.ok).toBe(true);

    const statuses = place();
    const after = editorProjectStore.getSnapshot()!;
    const created = after.project.shots[0]!.layers.at(-1)!;
    expect(statuses.at(-1)).toContain('角色已加入当前镜头');
    expect(after.project.shots[0]!.layers).toHaveLength(beforeLayers + 1);
    expect(created).toMatchObject({
      source: {
        kind: 'character',
        characterId: IDS.character,
        expressionId: IDS.expressionNormal,
      },
      x: PROJECT_WIDTH / 2,
      y: PROJECT_HEIGHT / 2,
      scaleX: 1.7,
      scaleY: 1.7,
      flipX: true,
    });
    expect(selectionStore.getSelectedLayerId()).toBe(created.id);
    expect(timelineUiStore.getSnapshot()).toMatchObject({ currentTimeMs: 0, scrollPx: 0, zoom: 4 });
    if (authoring.ok) expect(authoring.session.commit({ x: 800, y: 800 }).status).toBe('stale');
    expect(after.revision).toBe(before.revision + 1);
    expect(editorProjectStore.history.getSnapshot().undoCount).toBe(
      beforeUndoCount + 1,
    );

    expect(editorProjectStore.undo()).toBe(true);
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.layers).toHaveLength(beforeLayers);
    expect(editorProjectStore.redo()).toBe(true);
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.layers.at(-1)!.id).toBe(created.id);
    expect(selectionStore.getSelectedLayerId()).toBe(created.id);
  });

  it('keeps a dirty Assembly draft and Timeline untouched when the user stays', () => {
    open(compositeProject());
    const begin = characterAssemblySessionStore.begin(IDS.character);
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    expect(begin.session.updateDraft({ bodyAssetId: IDS.assetChar2 }).ok).toBe(true);
    timelineUiStore.seek(1_000, 3_000);
    timelineUiStore.setScrollPx(240);
    const before = editorProjectStore.getSnapshot();
    const history = editorProjectStore.history.getSnapshot();
    const statuses = place({ leaveAssembly: () => false });

    expect(statuses).toEqual([]);
    expect(characterAssemblySessionStore.getSnapshot()?.draft.bodyAssetId).toBe(IDS.assetChar2);
    expect(begin.session.getSnapshot()).not.toBeNull();
    expect(timelineUiStore.getSnapshot()).toMatchObject({ currentTimeMs: 1_000, scrollPx: 240 });
    expect(editorProjectStore.getSnapshot()).toBe(before);
    expect(editorProjectStore.history.getSnapshot()).toBe(history);
    begin.session.cancel();
  });

  it('discards an Assembly session only through the supplied exit gate before placement', () => {
    open(compositeProject());
    const begin = characterAssemblySessionStore.begin(IDS.character);
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    expect(begin.session.updateDraft({ bodyAssetId: IDS.assetChar2 }).ok).toBe(true);
    let exits = 0;
    place({ leaveAssembly: () => {
      exits += 1;
      begin.session.cancel();
      return true;
    } });
    expect(exits).toBe(1);
    expect(begin.session.getSnapshot()).toBeNull();
    expect(begin.session.updateDraft({ bodyAssetId: IDS.assetChar }).ok).toBe(false);
    expect(editorProjectStore.getSnapshot()!.project.characters[0]).toMatchObject({
      mode: 'composite', bodyAssetId: IDS.assetBg,
    });
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.layers.at(-1)!.source).toMatchObject({
      kind: 'character', characterId: IDS.character,
    });
  });

  it('exits a clean Assembly session without a confirmation before placement', () => {
    open(compositeProject());
    const begin = characterAssemblySessionStore.begin(IDS.character);
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    const managerSource = readFileSync('src/renderer/features/characters/CharacterManager.tsx', 'utf8');
    expect(managerSource).toContain('if (!assemblyPending) return true;');
    let exits = 0;
    place({ leaveAssembly: () => {
      exits += 1;
      begin.session.cancel();
      return true;
    } });
    expect(exits).toBe(1);
    expect(begin.session.getSnapshot()).toBeNull();
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.layers).toHaveLength(4);
  });

  it('blocks pending default transform without navigation or a Project write, then uses applied truth', () => {
    timelineUiStore.seek(1_000, 3_000);
    timelineUiStore.setScrollPx(100);
    const before = editorProjectStore.getSnapshot();
    const history = editorProjectStore.history.getSnapshot();
    let exits = 0;
    const statuses = place({
      defaultTransformPending: true,
      leaveAssembly: () => { exits += 1; return true; },
    });
    expect(statuses.at(-1)).toContain('先应用角色大小设置');
    expect(exits).toBe(0);
    expect(timelineUiStore.getSnapshot()).toMatchObject({ currentTimeMs: 1_000, scrollPx: 100 });
    expect(editorProjectStore.getSnapshot()).toBe(before);
    expect(editorProjectStore.history.getSnapshot()).toBe(history);

    characterStore.setDefaultTransform(IDS.character, 2, true);
    place();
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.layers.at(-1)).toMatchObject({
      scaleX: 2, scaleY: 2, flipX: true,
    });
  });

  it('rejects stale Project, Shot, or selected Character before commit', () => {
    const valid = buildProject();
    const invalid = {
      ...valid,
      characters: [{ ...valid.characters[0]!, defaultExpressionId: IDS.unknownExpression }],
    };
    expect(ProjectSchema.safeParse(invalid).success).toBe(false);

    for (const change of ['project', 'shot', 'character'] as const) {
      open();
      const secondShotId = change === 'shot'
        ? (shotStore.create({ name: 'Second shot', durationMs: 3_000 }).shots.at(-1)!.id)
        : null;
      if (secondShotId) shotStore.select(IDS.shot);
      const original = editorProjectStore.getSnapshot()!;
      timelineUiStore.seek(1_000, 3_000);
      const selectedId = { current: IDS.character as string | null };
      const statuses = place({
        getCurrentCharacterId: () => selectedId.current,
        leaveAssembly: () => {
          if (change === 'project') editorProjectStore.open('D:/another-project.pandastage', buildProject());
          if (secondShotId) shotStore.select(secondShotId);
          if (change === 'character') selectedId.current = null;
          return true;
        },
      });
      expect(statuses.at(-1)).toContain('已变化');
      expect(editorProjectStore.getSnapshot()!.project.shots[0]!.layers).toHaveLength(3);
      if (change === 'character') expect(editorProjectStore.getSnapshot()).toBe(original);
    }
  });

  it('does not navigate or write when the selected Character is missing', () => {
    timelineUiStore.seek(1_000, 3_000);
    const before = editorProjectStore.getSnapshot();
    const history = editorProjectStore.history.getSnapshot();
    expect(place({ characterId: null }).at(-1)).toContain('请先打开项目、选择镜头和角色');
    expect(timelineUiStore.getSnapshot().currentTimeMs).toBe(1_000);
    expect(editorProjectStore.getSnapshot()).toBe(before);
    expect(editorProjectStore.history.getSnapshot()).toBe(history);
  });

  it('does not place after the Character is deleted during the Assembly exit boundary', () => {
    const project = buildProject();
    open(ProjectSchema.parse({
      ...project,
      shots: [{
        ...project.shots[0]!,
        layers: project.shots[0]!.layers.filter((layer) => layer.id !== IDS.layerChar),
      }],
    }));
    const beforeCount = editorProjectStore.getSnapshot()!.project.shots[0]!.layers.length;
    const statuses = place({ leaveAssembly: () => {
      characterStore.deleteCharacter(IDS.character);
      return true;
    } });
    expect(statuses.at(-1)).toContain('已变化');
    expect(editorProjectStore.getSnapshot()!.project.characters).toHaveLength(0);
    expect(editorProjectStore.getSnapshot()!.project.shots[0]!.layers).toHaveLength(beforeCount);
  });

  it('keeps raw Body and Mouth image placement as ordinary asset-image Layers', () => {
    const project = compositeProject();
    open(ProjectSchema.parse({
      ...project,
      characters: [{ ...project.characters[0]!, mouthOpenAssetId: IDS.assetBg }],
    }));
    const character = editorProjectStore.getSnapshot()!.project.characters[0]!;
    if (character.mode !== 'composite') throw new Error('Expected composite Character');
    for (const assetId of [character.bodyAssetId, character.mouthOpenAssetId!]) {
      const layer = layerStore.createFromAsset({
        version: 2, type: 'asset-image', assetId,
        position: { x: PROJECT_WIDTH / 2, y: PROJECT_HEIGHT / 2 },
      });
      expect(layer.source).toEqual({ kind: 'asset', assetId });
    }
  });
});
