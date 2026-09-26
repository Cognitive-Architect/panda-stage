import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Image as KonvaImage, Rect } from 'react-konva';
import {
  evaluateShotAtTime,
  buildEditorStageRenderModel,
  projectShotMouth,
  ProjectSchema,
  upsertExpressionEventAtTime,
  type Project,
} from '../../src/domain';
import { SelectableLayer } from '../../src/renderer/features/canvas/SelectableLayer';
import { canvasImageResourceKey } from '../../src/renderer/features/canvas/canvasImageResources';
import { buildEditorTemporalCanvasModel } from '../../src/renderer/features/canvas/editorTemporalCanvasModel';
import {
  commitEditorTemporalContinuityBucket,
  createEditorTemporalContinuityState,
  editorTemporalContinuityMode,
  readEditorTemporalContinuityBucket,
} from '../../src/renderer/features/canvas/editorTemporalCanvasContinuity';
import { resolveEditorTemporalAssetResolution } from '../../src/renderer/features/canvas/temporalVisualContinuity';
import { buildProject, IDS } from './domain/testProject';

const BODY_ID = '10000000-0000-4000-8000-000000000004';
const FACE_NORMAL_ID = '10000000-0000-4000-8000-000000000005';
const FACE_ANGRY_ID = '10000000-0000-4000-8000-000000000006';
const MOUTH_ID = '10000000-0000-4000-8000-000000000007';
const AUDIO_ID = '10000000-0000-4000-8000-000000000008';
const BODY_REPLACEMENT_ID = '10000000-0000-4000-8000-000000000012';
const DIALOGUE_ID = '80000000-0000-4000-8000-000000000004';
const AUDIO_CLIP_ID = '70000000-0000-4000-8000-000000000004';
const EXPRESSION_EVENT_ID = '90000000-0000-4000-8000-000000000004';
const AUTHORED_EXPRESSION_EVENT_ID = '90000000-0000-4000-8000-000000000027';

function imageAsset(
  id: string,
  name: string,
  width: number,
  height: number,
  sha256?: string,
): Project['assets'][number] {
  return {
    id,
    kind: 'image',
    name,
    relativePath: `assets/${name}.png`,
    mimeType: 'image/png',
    width,
    height,
    ...(sha256 ? { sha256 } : {}),
  };
}

function compositeProject(options: { mouth?: boolean } = {}): Project {
  const base = buildProject();
  const mouth = options.mouth ?? true;
  const character = base.characters[0]!;
  return ProjectSchema.parse({
    ...base,
    assets: [
      ...base.assets,
      imageAsset(BODY_ID, 'body', 800, 1_000),
      imageAsset(FACE_NORMAL_ID, 'face-normal', 200, 100),
      imageAsset(FACE_ANGRY_ID, 'face-angry', 300, 200),
      ...(mouth ? [imageAsset(MOUTH_ID, 'mouth-open', 400, 300)] : []),
      ...(mouth
        ? [
            {
              id: AUDIO_ID,
              kind: 'audio' as const,
              name: 'voice',
              relativePath: 'assets/voice.wav',
              mimeType: 'audio/wav',
              durationMs: 1_000,
            },
          ]
        : []),
    ],
    characters: [
      {
        ...character,
        mode: 'composite' as const,
        baseAssetId: FACE_NORMAL_ID,
        expressions: [
          {
            id: IDS.expressionNormal,
            name: 'normal-face',
            assetId: FACE_NORMAL_ID,
          },
          {
            id: IDS.expressionAngry,
            name: 'angry-face',
            assetId: FACE_ANGRY_ID,
          },
        ],
        defaultExpressionId: IDS.expressionNormal,
        bodyAssetId: BODY_ID,
        facePlacement: { offsetX: 420, offsetY: -8, scale: 0.5 },
        ...(mouth ? { mouthOpenAssetId: MOUTH_ID } : {}),
      },
    ],
    shots: base.shots.map((shot) => ({
      ...shot,
      timelineEvents: [
        {
          id: EXPRESSION_EVENT_ID,
          type: 'expression' as const,
          layerId: IDS.layerChar,
          startMs: 500,
          endMs: 500,
          expressionId: IDS.expressionAngry,
        },
      ],
      ...(mouth
        ? {
            dialogues: [
              {
                id: DIALOGUE_ID,
                characterId: character.id,
                voiceProfileId: character.defaultVoiceProfileId,
                subtitleStyleId: IDS.subtitle,
                audioClipId: AUDIO_CLIP_ID,
                startMs: 0,
                endMs: 1_000,
                text: 'speaking',
              },
            ],
            audioClips: [
              {
                id: AUDIO_CLIP_ID,
                name: 'voice',
                assetId: AUDIO_ID,
                startMs: 0,
                endMs: 1_000,
                offsetMs: 0,
                volume: 1,
              },
            ],
          }
        : {}),
    })),
  });
}

describe('Issue #627 authored composite Expression switch', () => {
  it('keeps Body and placement while speaking overrides Face, then recovers B at 5s', () => {
    const base = compositeProject();
    const dialogue = base.shots[0]!.dialogues[0]!;
    const prepared = ProjectSchema.parse({
      ...base,
      assets: base.assets.map((asset) =>
        asset.id === AUDIO_ID && asset.kind === 'audio'
          ? { ...asset, durationMs: 5_000 }
          : asset,
      ),
      shots: [{
        ...base.shots[0]!,
        durationMs: 6_000,
        timelineEvents: [],
        dialogues: [{ ...dialogue, startMs: 1_000, endMs: 5_000 }],
        audioClips: [{ ...base.shots[0]!.audioClips[0]!, startMs: 1_000, endMs: 5_000 }],
      }],
    });
    const authored = upsertExpressionEventAtTime(
      prepared, IDS.shot, IDS.layerChar, IDS.expressionAngry, 3_000,
      () => AUTHORED_EXPRESSION_EVENT_ID,
    );
    const shot = authored.shots[0]!;
    const atTwo = projectShotMouth(authored, shot, evaluateShotAtTime(shot, 2_000, authored), DIALOGUE_ID);
    const atFour = projectShotMouth(authored, shot, evaluateShotAtTime(shot, 4_000, authored), DIALOGUE_ID);
    const atFive = projectShotMouth(authored, shot, evaluateShotAtTime(shot, 5_000, authored), DIALOGUE_ID);
    const visualAt = (evaluated: typeof atFour) => buildEditorStageRenderModel(authored, shot, evaluated)
      .layers.find((layer) => layer.layer.id === IDS.layerChar)!;

    expect(atTwo.layers.find((layer) => layer.id === IDS.layerChar)).toMatchObject({
      currentExpressionId: IDS.expressionNormal,
      mouthOverrideAssetId: MOUTH_ID,
    });
    expect(atFour.layers.find((layer) => layer.id === IDS.layerChar)).toMatchObject({
      currentExpressionId: IDS.expressionAngry,
      mouthOverrideAssetId: MOUTH_ID,
    });
    expect(visualAt(atFour).visual.parts.map((part) => part.assetId)).toEqual([BODY_ID, MOUTH_ID]);
    expect(atFive.layers.find((layer) => layer.id === IDS.layerChar)).toMatchObject({
      currentExpressionId: IDS.expressionAngry,
      mouthOverrideAssetId: null,
    });
    expect(visualAt(atFive).visual.parts.map((part) => part.assetId)).toEqual([BODY_ID, FACE_ANGRY_ID]);
    expect(visualAt(atFour).render).toMatchObject({ x: 500, y: 600, scaleX: 0.5, scaleY: 0.5 });
    expect(authored.characters).toEqual(prepared.characters);
    expect(shot.layers).toEqual(prepared.shots[0]!.layers);
  });

  it('shows an authored 0:00 Face in the editor without changing base transform editing', () => {
    const base = compositeProject({ mouth: false });
    const authored = upsertExpressionEventAtTime(
      base, IDS.shot, IDS.layerChar, IDS.expressionAngry, 0,
      () => AUTHORED_EXPRESSION_EVENT_ID,
    );
    const model = buildEditorTemporalCanvasModel({
      project: authored,
      shot: authored.shots[0]!,
      currentTimeMs: 0,
      readyAssetIds: new Set([IDS.assetBg, BODY_ID, FACE_NORMAL_ID, FACE_ANGRY_ID]),
      previousVisuals: new Map(),
    });
    expect(model.directEditingEnabled).toBe(true);
    expect(model.evaluatedShot.layers.find((layer) => layer.id === IDS.layerChar)).toMatchObject({
      currentExpressionId: IDS.expressionAngry,
      x: 500,
      y: 600,
      scaleX: 0.5,
      scaleY: 0.5,
    });
    expect(model.visualsByLayer.get(IDS.layerChar)?.parts.map((part) => part.assetId)).toEqual([
      BODY_ID, FACE_ANGRY_ID,
    ]);
  });
});

function layerAt(
  project: Project,
  timeMs: number,
  mouthDialogueId: string | null = null,
) {
  const shot = project.shots[0]!;
  const evaluated = evaluateShotAtTime(shot, timeMs, project);
  const projected = mouthDialogueId
    ? projectShotMouth(project, shot, evaluated, mouthDialogueId)
    : evaluated;
  return projected.layers.find((layer) => layer.id === IDS.layerChar)!;
}

function imageMap(assetIds: readonly string[]): ReadonlyMap<string, HTMLImageElement> {
  return new Map(
    assetIds.map((assetId) => [assetId, {} as HTMLImageElement]),
  );
}

function childElements(children: React.ReactNode): React.ReactElement[] {
  const elements: React.ReactElement[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    elements.push(child);
    const nested = (child.props as { children?: React.ReactNode }).children;
    if (nested) elements.push(...childElements(nested));
  });
  return elements;
}

function selectableComposite(
  project: Project,
  timeMs: number,
  readyAssetIds: readonly string[],
  selected = true,
) {
  const shot = project.shots[0]!;
  const evaluated = layerAt(project, timeMs);
  const stage = buildEditorStageRenderModel(project, shot, {
    shotId: shot.id,
    timeMs,
    backgroundLayerId: shot.backgroundLayerId,
    layers: [
      ...evaluateShotAtTime(shot, timeMs, project).layers.filter(
        (layer) => layer.id !== IDS.layerChar,
      ),
      evaluated,
    ],
  });
  const model = stage.layers.find((layer) => layer.layer.id === IDS.layerChar)!;
  const element = SelectableLayer({
    image: readyAssetIds.includes(model.asset.id)
      ? imageMap([model.asset.id]).get(model.asset.id)
      : undefined,
    images: imageMap(readyAssetIds),
    layer: model.layer,
    nodeRef: { current: null },
    render: model.render,
    selected,
    visual: model.visual,
    onSelect: vi.fn(),
    onCommitPosition: vi.fn(),
    onCommitTransform: vi.fn(),
    onError: vi.fn(),
  });
  return { element, model };
}

describe('BFM-S04 composite Character Editor Canvas', () => {
  it('renders Body and Face under one root with shared selection and combined bounds', () => {
    const project = compositeProject({ mouth: false });
    const { element, model } = selectableComposite(
      project,
      0,
      [BODY_ID, FACE_NORMAL_ID],
    );
    const onSelect = vi.fn();
    const withSelection = SelectableLayer({
      image: imageMap([model.asset.id]).get(model.asset.id),
      images: imageMap([BODY_ID, FACE_NORMAL_ID]),
      layer: model.layer,
      nodeRef: { current: null },
      render: model.render,
      selected: true,
      visual: model.visual,
      onSelect,
      onCommitPosition: vi.fn(),
      onCommitTransform: vi.fn(),
      onError: vi.fn(),
    });
    const root = withSelection.props as {
      x: number;
      y: number;
      scaleX: number;
      opacity: number;
      children: React.ReactNode;
    };
    const children = childElements(root.children);
    const parts = children.filter((child) => child.type === KonvaImage);
    const outline = children.find(
      (child) =>
        child.type === Rect &&
        (child.props as { name?: string }).name !== 'composite-visual-hit-area',
    );
    const partProps = (part: React.ReactElement) =>
      part.props as unknown as {
        x: number;
        y: number;
        onClick: (event: { cancelBubble: boolean }) => void;
        [key: string]: unknown;
      };

    expect(element.type).not.toBe(Symbol.for('react.fragment'));
    expect(root.x).toBe(500);
    expect(root.y).toBe(600);
    expect(root.scaleX).toBe(0.5);
    expect(parts).toHaveLength(2);
    expect(parts.map((part) => partProps(part).x)).toEqual([-400, 370]);
    expect(parts.map((part) => partProps(part).y)).toEqual([-500, -33]);
    expect(parts.every((part) => !('opacity' in partProps(part)))).toBe(true);
    expect(outline?.props).toMatchObject({
      x: -400,
      y: -500,
      width: 870,
      height: 1_000,
    });

    for (const part of parts) {
      const event = { cancelBubble: false };
      partProps(part).onClick(event);
      expect(event.cancelBubble).toBe(true);
      expect(onSelect).toHaveBeenLastCalledWith(IDS.layerChar);
    }
  });

  it('refreshes combined bounds from Face source while keeping the root position stable', () => {
    const project = compositeProject({ mouth: false });
    const shot = project.shots[0]!;
    const atBase = buildEditorStageRenderModel(
      project,
      shot,
      evaluateShotAtTime(shot, 0, project),
    ).layers.find((layer) => layer.layer.id === IDS.layerChar)!;
    const atExpression = buildEditorStageRenderModel(
      project,
      shot,
      evaluateShotAtTime(shot, 500, project),
    ).layers.find((layer) => layer.layer.id === IDS.layerChar)!;

    expect(atBase.visual.parts[1]?.assetId).toBe(FACE_NORMAL_ID);
    expect(atExpression.visual.parts[1]?.assetId).toBe(FACE_ANGRY_ID);
    expect(atBase.visual.combinedLocalBounds.width).not.toBe(
      atExpression.visual.combinedLocalBounds.width,
    );
    expect(atBase.render.x).toBe(atExpression.render.x);
    expect(atBase.render.y).toBe(atExpression.render.y);

    const placementProject = ProjectSchema.parse({
      ...project,
      characters: project.characters.map((character) =>
        character.mode === 'composite' && character.id === IDS.character
          ? {
              ...character,
              facePlacement: {
                ...character.facePlacement,
                offsetX: 620,
                scale: 1,
              },
            }
          : character,
      ),
    });
    const placementShot = placementProject.shots[0]!;
    const atPlacement = buildEditorStageRenderModel(
      placementProject,
      placementShot,
      evaluateShotAtTime(placementShot, 0, placementProject),
    ).layers.find((layer) => layer.layer.id === IDS.layerChar)!;

    expect(atPlacement.visual.combinedLocalBounds).not.toEqual(
      atBase.visual.combinedLocalBounds,
    );
    expect(atPlacement.render.x).toBe(atBase.render.x);
    expect(atPlacement.render.y).toBe(atBase.render.y);
  });

  it('keeps composite Position and Shake on the root without baking Face Placement', () => {
    const baseProject = compositeProject({ mouth: false });
    const project = ProjectSchema.parse({
      ...baseProject,
      shots: baseProject.shots.map((shot) => ({
        ...shot,
        timelineEvents: [
          {
            id: '40000000-0000-4000-8000-000000000031',
            type: 'move' as const,
            layerId: IDS.layerChar,
            startMs: 0,
            endMs: 2_000,
            easing: 'linear' as const,
            from: { x: 500, y: 600 },
            to: { x: 700, y: 600 },
          },
          {
            id: '40000000-0000-4000-8000-000000000032',
            type: 'shake' as const,
            layerId: IDS.layerChar,
            startMs: 1_000,
            endMs: 1_500,
            amplitudeX: 20,
            amplitudeY: 10,
            frequencyHz: 1,
          },
        ],
      })),
    });
    const shot = project.shots[0]!;
    const model = buildEditorTemporalCanvasModel({
      currentTimeMs: 1_250,
      previousVisuals: new Map(),
      positionDraft: {
        layerId: IDS.layerChar,
        position: { x: 900, y: 700 },
      },
      project,
      readyAssetIds: new Set([BODY_ID, FACE_NORMAL_ID]),
      shot,
    });
    const stageLayer = model.stageModel.layers.find(
      (layer) => layer.layer.id === IDS.layerChar,
    )!;
    const face = stageLayer.visual.parts.find((part) => part.slot === 'face')!;

    expect(stageLayer.render.x).toBe(920);
    expect(stageLayer.render.y).toBe(710);
    expect(model.positionAuthoringShakeOffset).toEqual({ x: 20, y: 10 });
    expect(face.localRect).toMatchObject({ x: 370, y: -33 });
    expect(project.shots[0]!.layers.find((layer) => layer.id === IDS.layerChar)).toMatchObject({
      x: 500,
      y: 600,
    });
    expect(model.directEditingEnabled).toBe(false);
  });

  it('applies partial opacity once at the Character Group boundary', () => {
    const base = compositeProject({ mouth: false });
    const project = ProjectSchema.parse({
      ...base,
      shots: base.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.map((layer) =>
          layer.id === IDS.layerChar ? { ...layer, opacity: 0.5 } : layer,
        ),
      })),
    });
    const { element } = selectableComposite(
      project,
      0,
      [BODY_ID, FACE_NORMAL_ID],
    );
    const root = element.props as { opacity: number };

    // One representative source-over overlap reference: flatten Body + Face
    // first, then apply the one logical Character opacity to the result.
    const bodyAlpha = 1;
    const faceAlpha = 0.75;
    const flattenedAlpha = faceAlpha + bodyAlpha * (1 - faceAlpha);
    const expectedOutputAlpha = flattenedAlpha * 0.5;

    expect(root.opacity).toBe(0.5);
    expect(expectedOutputAlpha).toBeCloseTo(0.5, 10);
  });

  it('retains a complete visual for Body-first and Face-first loading, never a half Character', () => {
    const project = compositeProject({ mouth: false });
    const shot = project.shots[0]!;
    const atTarget = evaluateShotAtTime(shot, 500, project);
    const targetBodyAndFace = atTarget.layers.find(
      (layer) => layer.id === IDS.layerChar,
    )!;
    const baseLayer = layerAt(project, 0);

    const bodyFirst = resolveEditorTemporalAssetResolution(
      project,
      shot,
      atTarget,
      new Set([FACE_ANGRY_ID]),
      new Map(),
    );
    const faceFirst = resolveEditorTemporalAssetResolution(
      project,
      shot,
      atTarget,
      new Set([BODY_ID]),
      new Map(),
    );

    expect(bodyFirst.visualStatusByLayer.get(IDS.layerChar)).toBe(
      'pending',
    );
    expect(faceFirst.visualStatusByLayer.get(IDS.layerChar)).toBe(
      'pending',
    );
    expect(bodyFirst.targetReadyLayerIds.has(IDS.layerChar)).toBe(false);
    expect(faceFirst.targetReadyLayerIds.has(IDS.layerChar)).toBe(false);

    const bodyOnly = selectableComposite(
      project,
      500,
      [FACE_ANGRY_ID],
      true,
    );
    const faceOnly = selectableComposite(project, 500, [BODY_ID], true);
    expect(
      childElements(
        (bodyOnly.element.props as { children: React.ReactNode }).children,
      ).filter((child) => child.type === KonvaImage),
    ).toHaveLength(0);
    expect(
      childElements(
        (faceOnly.element.props as { children: React.ReactNode }).children,
      ).filter((child) => child.type === KonvaImage),
    ).toHaveLength(0);
    expect(targetBodyAndFace.assetId).toBe(FACE_ANGRY_ID);
    expect(baseLayer.assetId).toBe(FACE_NORMAL_ID);
  });

  it('retains the previous complete visual and keeps it distinct from target readiness', () => {
    const project = compositeProject({ mouth: false });
    const shot = project.shots[0]!;
    const base = evaluateShotAtTime(shot, 0, project);
    const target = evaluateShotAtTime(shot, 500, project);
    const first = resolveEditorTemporalAssetResolution(
      project,
      shot,
      base,
      new Set([BODY_ID, FACE_NORMAL_ID]),
      new Map(),
    );
    const held = resolveEditorTemporalAssetResolution(
      project,
      shot,
      target,
      new Set([BODY_ID, FACE_NORMAL_ID]),
      first.lastValidVisuals,
    );

    expect(held.visualStatusByLayer.get(IDS.layerChar)).toBe(
      'previous-complete',
    );
    expect(held.targetReadyLayerIds.has(IDS.layerChar)).toBe(false);
    expect(
      held.evaluatedShot.layers.find((layer) => layer.id === IDS.layerChar),
    ).toEqual(base.layers.find((layer) => layer.id === IDS.layerChar));
    expect(held.visualsByLayer.get(IDS.layerChar)).toEqual(
      first.visualsByLayer.get(IDS.layerChar),
    );
  });

  it('keeps the exact previous geometry and resource versions during replacement', () => {
    const oldBodyHash = 'a'.repeat(64);
    const oldFaceHash = 'b'.repeat(64);
    const newBodyHash = 'c'.repeat(64);
    const newFaceHash = 'd'.repeat(64);
    const base = compositeProject({ mouth: false });
    const project = ProjectSchema.parse({
      ...base,
      assets: base.assets.map((asset) =>
        asset.id === BODY_ID
          ? { ...asset, sha256: oldBodyHash }
          : asset.id === FACE_NORMAL_ID
            ? { ...asset, sha256: oldFaceHash }
            : asset,
      ),
    });
    const shot = project.shots[0]!;
    const first = resolveEditorTemporalAssetResolution(
      project,
      shot,
      evaluateShotAtTime(shot, 0, project),
      new Set([BODY_ID, FACE_NORMAL_ID]),
      new Map(),
      new Map([
        [BODY_ID, oldBodyHash],
        [FACE_NORMAL_ID, oldFaceHash],
      ]),
    );
    const previous = first.lastValidVisuals.get(IDS.layerChar)!;
    const replacement = ProjectSchema.parse({
      ...project,
      assets: project.assets.map((asset) =>
        asset.id === BODY_ID
          ? { ...asset, width: 1_200, sha256: newBodyHash }
          : asset.id === FACE_NORMAL_ID
            ? { ...asset, width: 500, sha256: newFaceHash }
            : asset,
      ),
      characters: project.characters.map((character) =>
        character.id === IDS.character && character.mode === 'composite'
          ? {
              ...character,
              facePlacement: {
                ...character.facePlacement,
                offsetX: 700,
                scale: 1,
              },
            }
          : character,
      ),
    });
    const replacementShot = replacement.shots[0]!;
    const held = resolveEditorTemporalAssetResolution(
      replacement,
      replacementShot,
      evaluateShotAtTime(replacementShot, 0, replacement),
      new Set([BODY_ID, FACE_NORMAL_ID]),
      first.lastValidVisuals,
      new Map([
        [BODY_ID, oldBodyHash],
        [FACE_NORMAL_ID, oldFaceHash],
      ]),
      new Set(),
      new Set([
        canvasImageResourceKey(BODY_ID, oldBodyHash),
        canvasImageResourceKey(FACE_NORMAL_ID, oldFaceHash),
      ]),
    );
    const replacementVisual = resolveEditorTemporalAssetResolution(
      replacement,
      replacementShot,
      evaluateShotAtTime(replacementShot, 0, replacement),
      new Set([BODY_ID, FACE_NORMAL_ID]),
      new Map(),
      new Map([
        [BODY_ID, newBodyHash],
        [FACE_NORMAL_ID, newFaceHash],
      ]),
    );

    expect(held.visualStatusByLayer.get(IDS.layerChar)).toBe(
      'previous-complete',
    );
    expect(held.targetReadyLayerIds.has(IDS.layerChar)).toBe(false);
    expect(held.visualsByLayer.get(IDS.layerChar)).toEqual(previous.visual);
    expect(held.visualSourceKeysByLayer.get(IDS.layerChar)).toEqual(
      previous.assetSourceKeys,
    );
    expect(held.visualsByLayer.get(IDS.layerChar)).not.toEqual(
      replacementVisual.visualsByLayer.get(IDS.layerChar),
    );
  });

  it('marks definitive Body and Face failures without rendering a half Character', () => {
    const project = compositeProject({ mouth: false });
    const shot = project.shots[0]!;
    const target = evaluateShotAtTime(shot, 500, project);
    const bodyFailure = resolveEditorTemporalAssetResolution(
      project,
      shot,
      target,
      new Set([FACE_ANGRY_ID]),
      new Map(),
      new Map(),
      new Set([BODY_ID]),
    );
    const faceFailure = resolveEditorTemporalAssetResolution(
      project,
      shot,
      target,
      new Set([BODY_ID]),
      new Map(),
      new Map(),
      new Set([FACE_ANGRY_ID]),
    );
    const bodyFailureModel = buildEditorTemporalCanvasModel({
      currentTimeMs: 500,
      missingAssetIds: new Set([BODY_ID]),
      previousVisuals: new Map(),
      project,
      readyAssetIds: new Set([FACE_ANGRY_ID]),
      shot,
    });
    const bodyStageLayer = bodyFailureModel.stageModel.layers.find(
      (layer) => layer.layer.id === IDS.layerChar,
    )!;

    expect(bodyFailure.visualStatusByLayer.get(IDS.layerChar)).toBe(
      'required-failed',
    );
    expect(faceFailure.visualStatusByLayer.get(IDS.layerChar)).toBe(
      'required-failed',
    );
    expect(bodyFailure.targetReadyLayerIds.has(IDS.layerChar)).toBe(false);
    expect(faceFailure.targetReadyLayerIds.has(IDS.layerChar)).toBe(false);
    expect(bodyFailure.visualsByLayer.get(IDS.layerChar)).toBeNull();
    expect(faceFailure.visualsByLayer.get(IDS.layerChar)).toBeNull();
    expect(bodyStageLayer.visual.parts).toHaveLength(0);
  });

  it('keeps a retained visual visible but still surfaces a required Face failure', () => {
    const project = compositeProject({ mouth: false });
    const shot = project.shots[0]!;
    const previous = resolveEditorTemporalAssetResolution(
      project,
      shot,
      evaluateShotAtTime(shot, 0, project),
      new Set([BODY_ID, FACE_NORMAL_ID]),
      new Map(),
    );
    const failed = resolveEditorTemporalAssetResolution(
      project,
      shot,
      evaluateShotAtTime(shot, 500, project),
      new Set([BODY_ID, FACE_NORMAL_ID]),
      previous.lastValidVisuals,
      new Map(),
      new Set([FACE_ANGRY_ID]),
    );

    expect(failed.visualStatusByLayer.get(IDS.layerChar)).toBe(
      'required-failed',
    );
    expect(failed.targetReadyLayerIds.has(IDS.layerChar)).toBe(false);
    expect(failed.visualsByLayer.get(IDS.layerChar)).toEqual(
      previous.visualsByLayer.get(IDS.layerChar),
    );
  });

  it('falls back from a missing Mouth to the current Expression only', () => {
    const project = compositeProject();
    const shot = project.shots[0]!;
    const speaking = projectShotMouth(
      project,
      shot,
      evaluateShotAtTime(shot, 750, project),
      DIALOGUE_ID,
    );
    const pending = resolveEditorTemporalAssetResolution(
      project,
      shot,
      speaking,
      new Set([BODY_ID, FACE_ANGRY_ID]),
      new Map(),
      new Map(),
      new Set(),
    );
    expect(pending.visualStatusByLayer.get(IDS.layerChar)).toBe(
      'pending',
    );
    const resolved = resolveEditorTemporalAssetResolution(
      project,
      shot,
      speaking,
      new Set([BODY_ID, FACE_ANGRY_ID]),
      new Map(),
      new Map(),
      new Set([MOUTH_ID]),
    );
    const layer = resolved.evaluatedShot.layers.find(
      (candidate) => candidate.id === IDS.layerChar,
    )!;

    expect(resolved.visualStatusByLayer.get(IDS.layerChar)).toBe(
      'mouth-expression-fallback',
    );
    expect(layer.assetId).toBe(FACE_ANGRY_ID);
    expect(layer.currentExpressionId).toBe(IDS.expressionAngry);
    expect(layer.mouthOverrideAssetId).toBe(null);
    expect(
      resolved.visualsByLayer
        .get(IDS.layerChar)
        ?.parts.map((part) => part.assetId),
    ).toEqual([BODY_ID, FACE_ANGRY_ID]);
    expect(resolved.targetReadyLayerIds.has(IDS.layerChar)).toBe(false);
  });

  it('does not show an unrelated previous Mouth when the current Expression is unavailable', () => {
    const project = compositeProject();
    const shot = project.shots[0]!;
    const speaking = projectShotMouth(
      project,
      shot,
      evaluateShotAtTime(shot, 750, project),
      DIALOGUE_ID,
    );
    const previous = resolveEditorTemporalAssetResolution(
      project,
      shot,
      speaking,
      new Set([BODY_ID, MOUTH_ID]),
      new Map(),
      new Map(),
      new Set(),
    );
    const resolved = resolveEditorTemporalAssetResolution(
      project,
      shot,
      speaking,
      new Set([BODY_ID]),
      previous.lastValidVisuals,
      new Map(),
      new Set([MOUTH_ID, FACE_ANGRY_ID]),
    );

    expect(resolved.visualStatusByLayer.get(IDS.layerChar)).toBe(
      'mouth-fallback-pending',
    );
    expect(resolved.visualsByLayer.get(IDS.layerChar)).toBeNull();
  });

  it('keeps and atomically replaces the complete Body/Face visual at 0:00', () => {
    const oldBodyHash = 'a'.repeat(64);
    const oldFaceHash = 'b'.repeat(64);
    const newBodyHash = 'c'.repeat(64);
    const unversionedBase = compositeProject({ mouth: false });
    const base = ProjectSchema.parse({
      ...unversionedBase,
      assets: unversionedBase.assets.map((asset) =>
        asset.id === BODY_ID
          ? { ...asset, sha256: oldBodyHash }
          : asset.id === FACE_NORMAL_ID
            ? { ...asset, sha256: oldFaceHash }
            : asset,
      ),
    });
    const baseShot = base.shots[0]!;
    const baseReady = new Set([IDS.assetBg, BODY_ID, FACE_NORMAL_ID]);
    const baseReadySourceKeys = new Map([
      [BODY_ID, oldBodyHash],
      [FACE_NORMAL_ID, oldFaceHash],
    ]);
    const baseModel = buildEditorTemporalCanvasModel({
      currentTimeMs: 0,
      previousVisuals: new Map(),
      project: base,
      readyAssetIds: baseReady,
      readyAssetSourceKeys: baseReadySourceKeys,
      shot: baseShot,
    });
    const baseCharacter = baseModel.stageModel.layers.find(
      (candidate) => candidate.layer.id === IDS.layerChar,
    )!;

    const replacement = ProjectSchema.parse({
      ...base,
      assets: [
        ...base.assets,
        imageAsset(
          BODY_REPLACEMENT_ID,
          'body-replacement',
          1_200,
          900,
          newBodyHash,
        ),
      ],
      characters: base.characters.map((character) =>
        character.id === IDS.character
          ? { ...character, bodyAssetId: BODY_REPLACEMENT_ID }
          : character,
      ),
    });
    const replacementShot = replacement.shots[0]!;
    const pending = buildEditorTemporalCanvasModel({
      currentTimeMs: 0,
      previousVisuals: baseModel.lastValidVisuals,
      project: replacement,
      readyAssetIds: baseReady,
      readyAssetSourceKeys: new Map([[FACE_NORMAL_ID, oldFaceHash]]),
      readyResourceKeys: new Set([
        canvasImageResourceKey(BODY_ID, oldBodyHash),
        canvasImageResourceKey(FACE_NORMAL_ID, oldFaceHash),
      ]),
      shot: replacementShot,
    });
    const pendingCharacter = pending.stageModel.layers.find(
      (candidate) => candidate.layer.id === IDS.layerChar,
    )!;

    expect(baseModel.temporalInspection).toBe(false);
    expect(baseModel.visualStatusByLayer.get(IDS.layerChar)).toBe(
      'current-complete',
    );
    expect(baseCharacter.visual.parts.map((part) => part.assetId)).toEqual([
      BODY_ID,
      FACE_NORMAL_ID,
    ]);
    expect(pending.temporalInspection).toBe(false);
    expect(pending.directEditingEnabled).toBe(true);
    expect(pending.visualStatusByLayer.get(IDS.layerChar)).toBe(
      'previous-complete',
    );
    expect(pending.targetReadyLayerIds.has(IDS.layerChar)).toBe(false);
    expect(pendingCharacter.visual.parts.map((part) => part.assetId)).toEqual([
      BODY_ID,
      FACE_NORMAL_ID,
    ]);
    expect(pendingCharacter.render).toMatchObject({
      x: baseCharacter.render.x,
      y: baseCharacter.render.y,
      scaleX: baseCharacter.render.scaleX,
      scaleY: baseCharacter.render.scaleY,
    });
    expect(pendingCharacter.visual.combinedLocalBounds).toEqual(
      baseCharacter.visual.combinedLocalBounds,
    );
    expect(pending.visualSourceKeysByLayer.get(IDS.layerChar)).toEqual(
      baseModel.visualSourceKeysByLayer.get(IDS.layerChar),
    );

    const committed = buildEditorTemporalCanvasModel({
      currentTimeMs: 0,
      previousVisuals: pending.lastValidVisuals,
      project: replacement,
      readyAssetIds: new Set([
        IDS.assetBg,
        BODY_REPLACEMENT_ID,
        FACE_NORMAL_ID,
      ]),
      readyAssetSourceKeys: new Map([
        [BODY_REPLACEMENT_ID, newBodyHash],
        [FACE_NORMAL_ID, oldFaceHash],
      ]),
      readyResourceKeys: new Set([
        canvasImageResourceKey(BODY_REPLACEMENT_ID, newBodyHash),
        canvasImageResourceKey(FACE_NORMAL_ID, oldFaceHash),
      ]),
      shot: replacementShot,
    });
    const committedCharacter = committed.stageModel.layers.find(
      (candidate) => candidate.layer.id === IDS.layerChar,
    )!;

    expect(committed.visualStatusByLayer.get(IDS.layerChar)).toBe(
      'current-complete',
    );
    expect(committed.targetReadyLayerIds.has(IDS.layerChar)).toBe(true);
    expect(committedCharacter.visual.parts.map((part) => part.assetId)).toEqual([
      BODY_REPLACEMENT_ID,
      FACE_NORMAL_ID,
    ]);
    expect(
      committed.visualSourceKeysByLayer.get(IDS.layerChar)?.get(
        BODY_REPLACEMENT_ID,
      ),
    ).toBe(newBodyHash);
  });

  it('keeps and atomically replaces the Base Face/Expression visual at 0:00', () => {
    const project = compositeProject({ mouth: false });
    const baseShot = project.shots[0]!;
    const readyBase = new Set([IDS.assetBg, BODY_ID, FACE_NORMAL_ID]);
    const baseModel = buildEditorTemporalCanvasModel({
      currentTimeMs: 0,
      previousVisuals: new Map(),
      project,
      readyAssetIds: readyBase,
      shot: baseShot,
    });
    const replacement = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.map((layer) =>
          layer.id === IDS.layerChar && layer.source.kind === 'character'
            ? {
                ...layer,
                source: {
                  ...layer.source,
                  expressionId: IDS.expressionAngry,
                },
              }
            : layer,
        ),
      })),
    });
    const replacementShot = replacement.shots[0]!;
    const pending = buildEditorTemporalCanvasModel({
      currentTimeMs: 0,
      previousVisuals: baseModel.lastValidVisuals,
      project: replacement,
      readyAssetIds: readyBase,
      shot: replacementShot,
    });
    const committed = buildEditorTemporalCanvasModel({
      currentTimeMs: 0,
      previousVisuals: pending.lastValidVisuals,
      project: replacement,
      readyAssetIds: new Set([IDS.assetBg, BODY_ID, FACE_ANGRY_ID]),
      shot: replacementShot,
    });

    expect(pending.visualStatusByLayer.get(IDS.layerChar)).toBe(
      'previous-complete',
    );
    expect(
      pending.visualsByLayer
        .get(IDS.layerChar)
        ?.parts.map((part) => part.assetId),
    ).toEqual([BODY_ID, FACE_NORMAL_ID]);
    expect(committed.visualStatusByLayer.get(IDS.layerChar)).toBe(
      'current-complete',
    );
    expect(committed.targetReadyLayerIds.has(IDS.layerChar)).toBe(true);
    expect(
      committed.visualsByLayer
        .get(IDS.layerChar)
        ?.parts.map((part) => part.assetId),
    ).toEqual([BODY_ID, FACE_ANGRY_ID]);
  });

  it('keeps 0:00 Base semantics, rejects Mouth projection, and exposes hard failure', () => {
    const project = compositeProject();
    const shot = project.shots[0]!;
    const base = buildEditorTemporalCanvasModel({
      activeDialogueId: DIALOGUE_ID,
      currentTimeMs: 0,
      previousVisuals: new Map(),
      project,
      readyAssetIds: new Set([
        IDS.assetBg,
        BODY_ID,
        FACE_NORMAL_ID,
        FACE_ANGRY_ID,
        MOUTH_ID,
      ]),
      shot,
    });
    const characterLayer = base.evaluatedShot.layers.find(
      (layer) => layer.id === IDS.layerChar,
    )!;
    const characterVisual = base.visualsByLayer.get(IDS.layerChar)!;

    expect(base.temporalInspection).toBe(false);
    expect(base.directEditingEnabled).toBe(true);
    expect(base.evaluatedShot.timeMs).toBe(0);
    expect(characterLayer.mouthOverrideAssetId).toBeNull();
    expect(characterVisual.activeFace?.source).toBe('expression');
    expect(characterVisual.parts.map((part) => part.assetId)).toEqual([
      BODY_ID,
      FACE_NORMAL_ID,
    ]);

    const replacement = ProjectSchema.parse({
      ...project,
      assets: [
        ...project.assets,
        imageAsset(BODY_REPLACEMENT_ID, 'body-replacement', 1_200, 900),
      ],
      characters: project.characters.map((character) =>
        character.id === IDS.character
          ? { ...character, bodyAssetId: BODY_REPLACEMENT_ID }
          : character,
      ),
    });
    const replacementShot = replacement.shots[0]!;

    const failedWithRetention = buildEditorTemporalCanvasModel({
      currentTimeMs: 0,
      missingAssetIds: new Set([BODY_REPLACEMENT_ID]),
      previousVisuals: base.lastValidVisuals,
      project: replacement,
      readyAssetIds: new Set([IDS.assetBg, BODY_ID, FACE_NORMAL_ID]),
      shot: replacementShot,
    });
    expect(
      failedWithRetention.visualStatusByLayer.get(IDS.layerChar),
    ).toBe('required-failed');
    expect(failedWithRetention.targetReadyLayerIds.has(IDS.layerChar)).toBe(
      false,
    );
    expect(failedWithRetention.visualsByLayer.get(IDS.layerChar)).toEqual(
      base.visualsByLayer.get(IDS.layerChar),
    );

    const failedBeforeFirstPaint = buildEditorTemporalCanvasModel({
      currentTimeMs: 0,
      missingAssetIds: new Set([BODY_REPLACEMENT_ID]),
      previousVisuals: new Map(),
      project: replacement,
      readyAssetIds: new Set([IDS.assetBg, FACE_NORMAL_ID]),
      shot: replacementShot,
    });
    const failedCharacter = failedBeforeFirstPaint.stageModel.layers.find(
      (candidate) => candidate.layer.id === IDS.layerChar,
    )!;
    expect(
      failedBeforeFirstPaint.visualStatusByLayer.get(IDS.layerChar),
    ).toBe('required-failed');
    expect(failedBeforeFirstPaint.visualsByLayer.get(IDS.layerChar)).toBeNull();
    expect(failedCharacter.visual.parts).toHaveLength(0);
  });

  it('rejects a stale source hash even when the Asset id is present', () => {
    const base = compositeProject({ mouth: false });
    const project = ProjectSchema.parse({
      ...base,
      assets: base.assets.map((asset) =>
        asset.id === BODY_ID
          ? { ...asset, sha256: 'a'.repeat(64) }
          : asset.id === FACE_NORMAL_ID
            ? { ...asset, sha256: 'b'.repeat(64) }
            : asset,
      ),
    });
    const shot = project.shots[0]!;
    const resolved = resolveEditorTemporalAssetResolution(
      project,
      shot,
      evaluateShotAtTime(shot, 0, project),
      new Set([BODY_ID, FACE_NORMAL_ID]),
      new Map(),
      new Map([
        [BODY_ID, 'c'.repeat(64)],
        [FACE_NORMAL_ID, 'b'.repeat(64)],
      ]),
    );

    expect(resolved.visualStatusByLayer.get(IDS.layerChar)).toBe(
      'pending',
    );
    expect(resolved.targetReadyLayerIds.has(IDS.layerChar)).toBe(false);
  });

  it('keeps a temporal snapshot out of Base fallback while the Base target is pending', () => {
    const oldBodyHash = 'a'.repeat(64);
    const oldFaceHash = 'b'.repeat(64);
    const newBodyHash = 'c'.repeat(64);
    const base = compositeProject({ mouth: false });
    const project = ProjectSchema.parse({
      ...base,
      assets: base.assets.map((asset) =>
        asset.id === BODY_ID
          ? { ...asset, sha256: oldBodyHash }
          : asset.id === FACE_NORMAL_ID
            ? { ...asset, sha256: oldFaceHash }
            : asset,
      ),
      shots: base.shots.map((shot) => ({
        ...shot,
        timelineEvents: [
          ...shot.timelineEvents,
          {
            id: '90000000-0000-4000-8000-000000000031',
            type: 'move' as const,
            layerId: IDS.layerChar,
            startMs: 0,
            endMs: 1_000,
            easing: 'linear' as const,
            from: { x: 500, y: 600 },
            to: { x: 900, y: 600 },
          },
        ],
      })),
    });
    const baseShot = project.shots[0]!;
    const contextKey = 'project:open-instance:shot';
    let continuity = createEditorTemporalContinuityState();
    const readyBase = new Set([IDS.assetBg, BODY_ID, FACE_NORMAL_ID]);

    const baseModel = buildEditorTemporalCanvasModel({
      currentTimeMs: 0,
      previousVisuals: readEditorTemporalContinuityBucket(
        continuity,
        contextKey,
        editorTemporalContinuityMode(0),
      ),
      project,
      readyAssetIds: readyBase,
      readyAssetSourceKeys: new Map([
        [BODY_ID, oldBodyHash],
        [FACE_NORMAL_ID, oldFaceHash],
      ]),
      readyResourceKeys: new Set([
        canvasImageResourceKey(BODY_ID, oldBodyHash),
        canvasImageResourceKey(FACE_NORMAL_ID, oldFaceHash),
      ]),
      shot: baseShot,
    });
    continuity = commitEditorTemporalContinuityBucket(
      continuity,
      contextKey,
      editorTemporalContinuityMode(0),
      baseModel.lastValidVisuals,
    );

    const temporalModel = buildEditorTemporalCanvasModel({
      currentTimeMs: 500,
      previousVisuals: readEditorTemporalContinuityBucket(
        continuity,
        contextKey,
        editorTemporalContinuityMode(500),
      ),
      project,
      readyAssetIds: new Set([
        IDS.assetBg,
        BODY_ID,
        FACE_NORMAL_ID,
        FACE_ANGRY_ID,
      ]),
      readyAssetSourceKeys: new Map([
        [BODY_ID, oldBodyHash],
        [FACE_NORMAL_ID, oldFaceHash],
        [FACE_ANGRY_ID, 'd'.repeat(64)],
      ]),
      readyResourceKeys: new Set([
        canvasImageResourceKey(BODY_ID, oldBodyHash),
        canvasImageResourceKey(FACE_NORMAL_ID, oldFaceHash),
        canvasImageResourceKey(FACE_ANGRY_ID, 'd'.repeat(64)),
      ]),
      shot: baseShot,
    });
    continuity = commitEditorTemporalContinuityBucket(
      continuity,
      contextKey,
      editorTemporalContinuityMode(500),
      temporalModel.lastValidVisuals,
    );

    const temporalCharacter = temporalModel.stageModel.layers.find(
      (candidate) => candidate.layer.id === IDS.layerChar,
    )!;
    expect(temporalCharacter.render.x).toBe(700);
    expect(temporalModel.visualsByLayer.get(IDS.layerChar)?.activeFace?.source).toBe(
      'expression',
    );
    expect(
      temporalModel.visualsByLayer.get(IDS.layerChar)?.activeFace?.assetId,
    ).toBe(FACE_ANGRY_ID);

    const replacement = ProjectSchema.parse({
      ...project,
      assets: [
        ...project.assets,
        imageAsset(BODY_REPLACEMENT_ID, 'body-replacement', 1_200, 900, newBodyHash),
      ],
      characters: project.characters.map((character) =>
        character.id === IDS.character
          ? { ...character, bodyAssetId: BODY_REPLACEMENT_ID }
          : character,
      ),
    });
    const replacementShot = replacement.shots[0]!;
    const pendingBase = buildEditorTemporalCanvasModel({
      currentTimeMs: 0,
      previousVisuals: readEditorTemporalContinuityBucket(
        continuity,
        contextKey,
        editorTemporalContinuityMode(0),
      ),
      project: replacement,
      readyAssetIds: readyBase,
      readyAssetSourceKeys: new Map([
        [BODY_ID, oldBodyHash],
        [FACE_NORMAL_ID, oldFaceHash],
      ]),
      readyResourceKeys: new Set([
        canvasImageResourceKey(BODY_ID, oldBodyHash),
        canvasImageResourceKey(FACE_NORMAL_ID, oldFaceHash),
      ]),
      shot: replacementShot,
    });
    const pendingCharacter = pendingBase.stageModel.layers.find(
      (candidate) => candidate.layer.id === IDS.layerChar,
    )!;

    expect(pendingBase.visualStatusByLayer.get(IDS.layerChar)).toBe(
      'previous-complete',
    );
    expect(pendingCharacter.render.x).toBe(500);
    expect(
      pendingBase.visualsByLayer.get(IDS.layerChar)?.activeFace?.assetId,
    ).toBe(FACE_NORMAL_ID);
    expect(pendingBase.visualsByLayer.get(IDS.layerChar)?.parts.map((part) => part.assetId)).toEqual([
      BODY_ID,
      FACE_NORMAL_ID,
    ]);
    expect(
      pendingBase.visualsByLayer.get(IDS.layerChar)?.parts.map((part) => part.assetId),
    ).not.toContain(FACE_ANGRY_ID);

    const readyReplacement = buildEditorTemporalCanvasModel({
      currentTimeMs: 0,
      previousVisuals: pendingBase.lastValidVisuals,
      project: replacement,
      readyAssetIds: new Set([IDS.assetBg, BODY_REPLACEMENT_ID, FACE_NORMAL_ID]),
      readyAssetSourceKeys: new Map([
        [BODY_REPLACEMENT_ID, newBodyHash],
        [FACE_NORMAL_ID, oldFaceHash],
      ]),
      readyResourceKeys: new Set([
        canvasImageResourceKey(BODY_REPLACEMENT_ID, newBodyHash),
        canvasImageResourceKey(FACE_NORMAL_ID, oldFaceHash),
      ]),
      shot: replacementShot,
    });
    expect(readyReplacement.visualStatusByLayer.get(IDS.layerChar)).toBe(
      'current-complete',
    );
    expect(
      readyReplacement.visualsByLayer.get(IDS.layerChar)?.parts.map((part) => part.assetId),
    ).toEqual([BODY_REPLACEMENT_ID, FACE_NORMAL_ID]);
  });

  it('does not use Base-only continuity for pending Temporal inspection, but keeps same-mode Temporal continuity', () => {
    const base = compositeProject({ mouth: false });
    const project = ProjectSchema.parse({
      ...base,
      shots: base.shots.map((shot) => ({
        ...shot,
        timelineEvents: [
          ...shot.timelineEvents,
          {
            id: '90000000-0000-4000-8000-000000000032',
            type: 'move' as const,
            layerId: IDS.layerChar,
            startMs: 0,
            endMs: 1_000,
            easing: 'linear' as const,
            from: { x: 500, y: 600 },
            to: { x: 900, y: 600 },
          },
        ],
      })),
    });
    const shot = project.shots[0]!;
    const contextKey = 'project:open-instance:shot';
    let continuity = createEditorTemporalContinuityState();
    const baseModel = buildEditorTemporalCanvasModel({
      currentTimeMs: 0,
      previousVisuals: readEditorTemporalContinuityBucket(
        continuity,
        contextKey,
        editorTemporalContinuityMode(0),
      ),
      project,
      readyAssetIds: new Set([IDS.assetBg, BODY_ID, FACE_NORMAL_ID]),
      shot,
    });
    continuity = commitEditorTemporalContinuityBucket(
      continuity,
      contextKey,
      editorTemporalContinuityMode(0),
      baseModel.lastValidVisuals,
    );

    const temporalPending = buildEditorTemporalCanvasModel({
      currentTimeMs: 500,
      previousVisuals: readEditorTemporalContinuityBucket(
        continuity,
        contextKey,
        editorTemporalContinuityMode(500),
      ),
      project,
      readyAssetIds: new Set([IDS.assetBg, BODY_ID, FACE_NORMAL_ID]),
      shot,
    });
    expect(temporalPending.temporalInspection).toBe(true);
    expect(temporalPending.directEditingEnabled).toBe(false);
    expect(temporalPending.visualStatusByLayer.get(IDS.layerChar)).toBe(
      'pending',
    );
    expect(temporalPending.visualsByLayer.get(IDS.layerChar)).toBeNull();
    expect(temporalPending.stageModel.layers.find(
      (candidate) => candidate.layer.id === IDS.layerChar,
    )!.visual.parts).toHaveLength(0);

    continuity = commitEditorTemporalContinuityBucket(
      continuity,
      contextKey,
      editorTemporalContinuityMode(500),
      temporalPending.lastValidVisuals,
    );
    const temporalReady = buildEditorTemporalCanvasModel({
      currentTimeMs: 500,
      previousVisuals: readEditorTemporalContinuityBucket(
        continuity,
        contextKey,
        editorTemporalContinuityMode(500),
      ),
      project,
      readyAssetIds: new Set([
        IDS.assetBg,
        BODY_ID,
        FACE_NORMAL_ID,
        FACE_ANGRY_ID,
      ]),
      shot,
    });
    expect(temporalReady.visualStatusByLayer.get(IDS.layerChar)).toBe(
      'current-complete',
    );
    continuity = commitEditorTemporalContinuityBucket(
      continuity,
      contextKey,
      editorTemporalContinuityMode(500),
      temporalReady.lastValidVisuals,
    );

    const temporalReplacement = ProjectSchema.parse({
      ...project,
      assets: [
        ...project.assets,
        imageAsset(BODY_REPLACEMENT_ID, 'temporal-body-replacement', 1_100, 900),
      ],
      characters: project.characters.map((character) =>
        character.id === IDS.character
          ? { ...character, bodyAssetId: BODY_REPLACEMENT_ID }
          : character,
      ),
    });
    const temporalReplacementShot = temporalReplacement.shots[0]!;
    const temporalPendingReplacement = buildEditorTemporalCanvasModel({
      currentTimeMs: 500,
      missingAssetIds: new Set([BODY_REPLACEMENT_ID]),
      previousVisuals: readEditorTemporalContinuityBucket(
        continuity,
        contextKey,
        editorTemporalContinuityMode(500),
      ),
      project: temporalReplacement,
      readyAssetIds: new Set([IDS.assetBg, BODY_ID, FACE_NORMAL_ID, FACE_ANGRY_ID]),
      shot: temporalReplacementShot,
    });
    const retainedTemporalCharacter = temporalPendingReplacement.stageModel.layers.find(
      (candidate) => candidate.layer.id === IDS.layerChar,
    )!;
    expect(temporalPendingReplacement.visualStatusByLayer.get(IDS.layerChar)).toBe(
      'required-failed',
    );
    expect(retainedTemporalCharacter.render.x).toBe(700);
    expect(
      temporalPendingReplacement.visualsByLayer.get(IDS.layerChar)?.activeFace?.assetId,
    ).toBe(FACE_ANGRY_ID);
  });

  it('bounds continuity to Base and Temporal buckets and invalidates both on context change', () => {
    const state = createEditorTemporalContinuityState('project-a:instance-a:shot-a');
    const baseVisuals = new Map<string, never>();
    const temporalVisuals = new Map<string, never>();
    const withBase = commitEditorTemporalContinuityBucket(
      state,
      'project-a:instance-a:shot-a',
      'base',
      baseVisuals,
    );
    const withBoth = commitEditorTemporalContinuityBucket(
      withBase,
      'project-a:instance-a:shot-a',
      'temporal',
      temporalVisuals,
    );

    expect(withBoth.buckets.base).toBe(baseVisuals);
    expect(withBoth.buckets.temporal).toBe(temporalVisuals);
    expect(
      readEditorTemporalContinuityBucket(
        withBoth,
        'project-a:instance-a:shot-a',
        'base',
      ),
    ).toBe(baseVisuals);
    expect(
      readEditorTemporalContinuityBucket(
        withBoth,
        'project-a:instance-a:shot-a',
        'temporal',
      ),
    ).toBe(temporalVisuals);

    const switched = commitEditorTemporalContinuityBucket(
      withBoth,
      'project-b:instance-b:shot-b',
      'base',
      baseVisuals,
    );
    expect(
      readEditorTemporalContinuityBucket(
        switched,
        'project-a:instance-a:shot-a',
        'base',
      ),
    ).not.toBe(baseVisuals);
    expect(
      readEditorTemporalContinuityBucket(
        switched,
        'project-b:instance-b:shot-b',
        'temporal',
      ).size,
    ).toBe(0);
  });
});
