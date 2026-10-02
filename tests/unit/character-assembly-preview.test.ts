import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { ProjectSchema, migrateProject } from '../../src/domain';
import { CharacterAssemblyWorkbench } from '../../src/renderer/features/characters/CharacterAssemblyWorkbench';
import {
  buildCharacterAssemblyPreviewVisual,
  characterLocalPointerDelta,
  findVisibleImageBounds,
  getAssemblyPreviewExpressions,
  headScaleFromPointerDistance,
  hasPendingCharacterAssemblyEdit,
  isAssemblyHeadMotionTestRunning,
  isCharacterAssemblyPending,
} from '../../src/renderer/features/characters/characterAssemblyPreview';
import type {
  CharacterAssemblySnapshot,
  CharacterCreationSnapshot,
} from '../../src/renderer/stores/characterAssemblySessionStore';
import exampleProject from '../../demo-project/project-v1.example.json';

function fixture(): {
  project: ReturnType<typeof migrateProject>;
  session: CharacterAssemblySnapshot;
} {
  const base = migrateProject(exampleProject);
  const original = base.characters[0]!;
  const imageAssets = base.assets.filter(
    (asset) => asset.kind === 'image',
  );
  const body = imageAssets[0]!;
  const face = original.expressions[0]!;
  const mouth = imageAssets.find((asset) => asset.id !== face.assetId)!;
  const placement = { offsetX: 48, offsetY: -24, scale: 0.75 };
  const project = ProjectSchema.parse({
    ...base,
    characters: [
      {
        ...original,
        mode: 'composite' as const,
        bodyAssetId: body.id,
        facePlacement: placement,
        head: {
          assetId: mouth.id,
          placement: { offsetX: 12, offsetY: -5, scale: 0.8 },
          pivot: { x: 200, y: 210 },
        },
        mouthOpenAssetId: mouth.id,
      },
    ],
  });
  const character = project.characters[0]!;
  if (character.mode !== 'composite') {
    throw new Error('Expected composite fixture.');
  }
  return {
    project,
    session: {
      status: 'active',
      sessionId: 609,
      generation: 0,
      projectId: project.id,
      projectRoot: 'D:\\PandaStage-Acceptance\\issue609.pandastage',
      characterId: character.id,
      draft: {
        bodyAssetId: character.bodyAssetId,
        facePlacement: { ...placement },
        ...(character.head ? { head: structuredClone(character.head) } : {}),
        expressionAssets: character.expressions.map((expression) => ({
          expressionId: expression.id,
          assetId: expression.assetId,
        })),
        mouthOpenAssetId: character.mouthOpenAssetId ?? null,
      },
    },
  };
}

describe('S07 composite assembly preview', () => {
  it('keeps precision controls collapsed while pending actions stay visible', () => {
    const { project, session } = fixture();
    const pending = {
      ...session,
      draft: {
        ...session.draft,
        facePlacement: { ...session.draft.facePlacement, offsetX: 80 },
      },
    };
    const markup = renderToStaticMarkup(createElement(CharacterAssemblyWorkbench, {
      projectSnapshot: {
        projectRoot: session.projectRoot,
        project,
        dirty: false,
        revision: 0,
      },
      session: pending,
    }));

    for (const control of ['精调', '还原', '应用']) {
      expect(markup).toContain(control);
    }
    expect(markup).not.toContain('data-testid="character-assembly-fine-tune-panel"');
    expect(markup).not.toContain('data-testid="character-assembly-reset"');
    expect(markup).toContain('data-testid="character-assembly-pending"');
    expect(markup).not.toContain('拖动脸部可调整位置，底部可微调大小');
    expect(markup).not.toContain('有未应用更改');
    expect(readFileSync('src/renderer/features/characters/CharacterAssemblyWorkbench.tsx', 'utf8'))
      .toContain('className="character-assembly-message" role="status"');
  });

  it('reconciles assembly images through one mounted session without clearing on History replay', () => {
    const source = readFileSync(
      'src/renderer/features/characters/CharacterAssemblyWorkbench.tsx', 'utf8',
    );
    expect(source).toContain('imageSessionRef.current?.reconcile(');
    expect(source).toContain('imageSession.dispose();');
    expect(source).toContain('imageResult.contextKey === contextKey');
    expect(source).not.toContain('setImageState(EMPTY_CANVAS_IMAGE_STATE)');
  });

  it('uses S03 Body/Face local geometry and previews Mouth as a Face replacement', () => {
    const { project, session } = fixture();
    const expressions = getAssemblyPreviewExpressions(project, session);
    const faceExpression = expressions.find(
      (expression) =>
        expression.id ===
        project.characters[0]!.defaultExpressionId,
    )!;
    const visual = buildCharacterAssemblyPreviewVisual(project, session, {
      kind: 'expression',
      expressionId: faceExpression.id,
    });
    const bodyPart = visual?.parts.find((part) => part.slot === 'body');
    const facePart = visual?.parts.find((part) => part.slot === 'face');
    const bodyAsset = project.assets.find(
      (asset) => asset.id === session.draft.bodyAssetId,
    )!;
    const faceAsset = project.assets.find(
      (asset) => asset.id === faceExpression.assetId,
    )!;
    if (bodyAsset.kind !== 'image' || faceAsset.kind !== 'image') {
      throw new Error('Expected image assets in the assembly fixture.');
    }

    expect(bodyPart?.localRect).toEqual({
      x: -bodyAsset.width / 2,
      y: -bodyAsset.height / 2,
      width: bodyAsset.width,
      height: bodyAsset.height,
    });
    expect(facePart?.localRect).toEqual({
      x:
        session.draft.facePlacement.offsetX -
        (faceAsset.width * session.draft.facePlacement.scale) / 2,
      y:
        session.draft.facePlacement.offsetY -
        (faceAsset.height * session.draft.facePlacement.scale) / 2,
      width: faceAsset.width * session.draft.facePlacement.scale,
      height: faceAsset.height * session.draft.facePlacement.scale,
    });

    const mouthVisual = buildCharacterAssemblyPreviewVisual(project, session, {
      kind: 'mouth',
    });
    expect(mouthVisual?.parts.map(({ slot }) => slot)).toEqual([
      'body',
      'face',
    ]);
    expect(mouthVisual?.parts[1]?.assetId).toBe(
      session.draft.mouthOpenAssetId,
    );
  });

  it('previews Head placement separately while keeping Face/Mouth Character-local', () => {
    const { project, session } = fixture();
    const expression = getAssemblyPreviewExpressions(project, session)[0]!;
    const visual = buildCharacterAssemblyPreviewVisual(project, session, {
      kind: 'expression',
      expressionId: expression.id,
    });
    const headAsset = project.assets.find(
      (asset) => asset.id === session.draft.head?.assetId,
    )!;
    if (headAsset.kind !== 'image') throw new Error('Expected an image Head asset.');

    expect(visual?.headPart).toEqual({
      assetId: headAsset.id,
      localRect: {
        x:
          session.draft.head!.placement.offsetX -
          (headAsset.width * session.draft.head!.placement.scale) / 2,
        y:
          session.draft.head!.placement.offsetY -
          (headAsset.height * session.draft.head!.placement.scale) / 2,
        width: headAsset.width * session.draft.head!.placement.scale,
        height: headAsset.height * session.draft.head!.placement.scale,
      },
    });
    expect(visual?.parts.map(({ slot }) => slot)).toEqual(['body', 'face']);
    expect(visual?.facePlacement).toEqual(session.draft.facePlacement);

    const { head, ...headlessDraft } = session.draft;
    expect(head).toBeDefined();
    const headlessSession = { ...session, draft: headlessDraft };
    const headlessVisual = buildCharacterAssemblyPreviewVisual(
      project,
      headlessSession,
      { kind: 'expression', expressionId: expression.id },
    );
    expect(headlessVisual?.headPart).toBeNull();
    expect(headlessVisual?.parts).toEqual(visual?.parts);
    expect(headlessVisual?.facePlacement).toEqual(session.draft.facePlacement);
  });

  it('keeps Test Head Motion session-only and resets its token on removal or session change', () => {
    const { session } = fixture();
    const token = {
      sessionId: session.sessionId,
      generation: session.generation,
    };
    expect(isAssemblyHeadMotionTestRunning(token, session)).toBe(true);
    expect(
      isAssemblyHeadMotionTestRunning(token, {
        ...session,
        generation: session.generation + 1,
      }),
    ).toBe(false);
    expect(
      isAssemblyHeadMotionTestRunning(token, {
        ...session,
        sessionId: session.sessionId + 1,
      }),
    ).toBe(false);
    const { head, ...headlessDraft } = session.draft;
    expect(head).toBeDefined();
    expect(
      isAssemblyHeadMotionTestRunning(token, { ...session, draft: headlessDraft }),
    ).toBe(false);

    const source = readFileSync(
      'src/renderer/features/characters/CharacterAssemblyWorkbench.tsx',
      'utf8',
    );
    const motionHandler = source.match(
      /const toggleHeadMotionTest = \(\): void => \{([\s\S]*?)\n\s*\};/,
    )?.[1];
    expect(motionHandler).toBeDefined();
    expect(motionHandler).toContain('setHeadMotionTestToken');
    expect(motionHandler).not.toMatch(/updateDraft|updateHead|commit|editorProjectStore|timeline/i);
  });

  it('keeps the assembly preview controls in one Head/Face group and leaves no-Head editing available', () => {
    const { project, session } = fixture();
    const markup = renderToStaticMarkup(createElement(CharacterAssemblyWorkbench, {
      projectSnapshot: {
        projectRoot: session.projectRoot,
        project,
        dirty: false,
        revision: 0,
      },
      session,
    }));
    expect(markup).not.toContain('data-testid="character-assembly-head-asset-selected"');
    expect(markup).not.toContain('data-testid="character-assembly-head-picker"');
    expect(markup).toContain('data-edit-target="head"');
    expect(markup).toContain('data-testid="character-assembly-edit-head"');
    expect(markup).toContain('data-testid="character-assembly-edit-face"');
    expect(markup).toContain('data-testid="character-assembly-head-drag-fallback"');
    expect(markup).toContain('data-testid="character-assembly-head-scale-handle"');
    expect(markup).not.toContain('data-testid="character-assembly-face-drag-target"');
    expect(markup).not.toContain('data-testid="character-assembly-head-pivot"');
    expect(markup).toContain('data-testid="character-assembly-head-pivot-marker"');
    expect(markup).toContain('aria-label="角色组装工作区"');
    expect(markup).toContain('aria-label="角色组装预览"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('data-testid="character-assembly-head-offset-x"');
    expect(markup).toContain('data-testid="character-assembly-test-head-motion"');
    expect(markup).toContain('▶ 测试摇头');
    expect(markup).toContain('data-testid="character-assembly-pivot-mode-toggle"');
    expect(markup).toContain('调整脖子转轴');

    const { head, ...headlessDraft } = session.draft;
    expect(head).toBeDefined();
    const headlessMarkup = renderToStaticMarkup(createElement(CharacterAssemblyWorkbench, {
      projectSnapshot: {
        projectRoot: session.projectRoot,
        project,
        dirty: false,
        revision: 0,
      },
      session: { ...session, draft: headlessDraft },
    }));
    expect(headlessMarkup).toContain('data-edit-target="face"');
    expect(headlessMarkup).toContain('data-testid="character-assembly-face-drag-target"');
    expect(headlessMarkup).not.toContain('data-testid="character-assembly-head-pivot"');
    expect(headlessMarkup).not.toContain('data-testid="character-assembly-test-head-motion"');
  });

  it('calculates transparent-image bounds and viewport-independent pointer adjustments', () => {
    const rgba = new Uint8ClampedArray(4 * 3 * 4);
    rgba[(1 * 4 + 2) * 4 + 3] = 255;
    rgba[(2 * 4 + 3) * 4 + 3] = 8;
    expect(findVisibleImageBounds(rgba, 4, 3)).toEqual({
      x: 0.5,
      y: 1 / 3,
      width: 0.5,
      height: 2 / 3,
    });
    expect(findVisibleImageBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull();
    expect(characterLocalPointerDelta(10, 20, 30, 60, 2)).toEqual({ x: 10, y: 20 });
    expect(characterLocalPointerDelta(10, 20, 30, 60, 0.5)).toEqual({ x: 40, y: 80 });
    expect(headScaleFromPointerDistance(0.8, 20, 30)).toBeCloseTo(1.2);
    expect(headScaleFromPointerDistance(0.1, 20, 1)).toBe(0.05);
  });

  it('keeps Head search and pagination in Character side panels, outside the canvas workbench', () => {
    const pickerSource = readFileSync(
      'src/renderer/features/characters/ImageAssetPicker.tsx',
      'utf8',
    );
    const editorSource = readFileSync(
      'src/renderer/features/characters/CharacterEditor.tsx',
      'utf8',
    );
    const listSource = readFileSync(
      'src/renderer/features/characters/CharacterList.tsx',
      'utf8',
    );
    const workbenchSource = readFileSync(
      'src/renderer/features/characters/CharacterAssemblyWorkbench.tsx',
      'utf8',
    );
    expect(pickerSource).toContain('const visibleCandidateIds = useMemo(');
    expect(pickerSource).toContain('onVisibleCandidatesChange?.(visibleCandidateIds)');
    expect(editorSource).toContain('testId="character-assembly-head-asset"');
    expect(listSource).toContain('testId="character-create-head-picker"');
    expect(editorSource).toContain('searchAndPaginate');
    expect(listSource).toContain('searchAndPaginate');
    expect(workbenchSource).not.toContain('ImageAssetPicker');
    expect(workbenchSource).not.toContain('character-assembly-head-picker');
    const testButton = workbenchSource.match(
      /data-testid="character-assembly-test-head-motion"([\s\S]*?)<\/button>/u,
    )?.[1];
    expect(testButton).toBeDefined();
    expect(testButton).not.toContain('disabled={isEditingNeckPivot}');
    expect(workbenchSource).toContain('观察头和脸是否贴合，转轴是否像从脖子处转动');
  });

  it('reports pending only when the edit draft differs from the persisted definition', () => {
    const { project, session } = fixture();
    expect(isCharacterAssemblyPending(project, session)).toBe(false);
    const pendingSession = {
      ...session,
      draft: {
        ...session.draft,
        facePlacement: { ...session.draft.facePlacement, offsetX: 80 },
      },
    };
    expect(isCharacterAssemblyPending(project, pendingSession)).toBe(true);
    expect(
      isCharacterAssemblyPending(project, {
        ...session,
        draft: {
          ...session.draft,
          head: {
            ...session.draft.head!,
            placement: { ...session.draft.head!.placement, offsetX: 40 },
          },
        },
      }),
    ).toBe(true);
    expect(hasPendingCharacterAssemblyEdit(project, session)).toBe(false);
    expect(hasPendingCharacterAssemblyEdit(project, pendingSession)).toBe(
      true,
    );
    expect(hasPendingCharacterAssemblyEdit(project, null)).toBe(false);

    const character = project.characters[0]!;
    const creationSession: CharacterCreationSnapshot = {
      status: 'active',
      kind: 'create',
      sessionId: 610,
      generation: 0,
      projectId: project.id,
      projectRoot: session.projectRoot,
      draft: {
        name: 'New composite character',
        bodyAssetId: session.draft.bodyAssetId,
        facePlacement: { ...session.draft.facePlacement },
        expressions: character.expressions.map(({ name, assetId }) => ({
          name,
          assetId,
        })),
        defaultExpressionIndex: 0,
        defaultScale: character.defaultScale,
        defaultFlipX: character.defaultFlipX,
      },
    };
    expect(
      hasPendingCharacterAssemblyEdit(project, creationSession),
    ).toBe(false);
  });
});
