import { describe, expect, it } from 'vitest';
import {
  CharacterService,
  LayerService,
  ProjectSchema,
  ShotService,
  evaluateShotAtTime,
  resolveLayerVisualParts,
  transformPointByVisualPart,
  type LayerVisualPart,
  type LayerVisualParts,
  type Project,
} from '../../../src/domain';
import { characterPartTransformFromStaticAdjustment } from '../../../src/domain/geometry/characterPartLayout';
import { adaptivePartsFixture } from '../../helpers/adaptivePartsFixtures';
import { buildProject, IDS } from './testProject';

function worldCorners(visual: LayerVisualParts, part: LayerVisualPart) {
  const owner = visual.ownerTransform;
  const scaleX = owner.scaleX * (owner.flipX ? -1 : 1);
  const scaleY = owner.scaleY;
  const radians = (owner.rotationDeg * Math.PI) / 180;
  return [
    { x: 0, y: 0 },
    { x: part.localRect.width, y: 0 },
    { x: part.localRect.width, y: part.localRect.height },
    { x: 0, y: part.localRect.height },
  ].map((corner) => {
    const local = transformPointByVisualPart(corner, part);
    const scaledX = local.x * scaleX;
    const scaledY = local.y * scaleY;
    return {
      x: owner.x + scaledX * Math.cos(radians) - scaledY * Math.sin(radians),
      y: owner.y + scaledX * Math.sin(radians) + scaledY * Math.cos(radians),
    };
  });
}

describe('Adaptive Parts visibility pivot', () => {
  it('keeps dispersed Part world corners fixed in existing and new Shots across hide and reveal', () => {
    const base = buildProject();
    const cropAssetId = '10000000-0000-4000-8000-000000000098';
    const mapping = {
      sourceWidth: 100,
      sourceHeight: 80,
      crop: { x: 10, y: 20, width: 40, height: 30 },
      exportScale: 2,
    };
    const sourceRootTransform = {
      a: 0.97,
      b: 0.08,
      c: -0.16,
      d: 1.03,
      tx: 30,
      ty: -20,
    };
    const adjustments = [
      { offsetX: 14, offsetY: -9, scale: 1.1, rotationDeg: 7 },
      { offsetX: -12, offsetY: 6, scale: 0.9, rotationDeg: -8 },
      { offsetX: 25, offsetY: -15, scale: 0.95, rotationDeg: 12 },
    ];
    const sourceTransforms = [
      { a: 1.1, b: 0.2, c: 0.3, d: 0.9, tx: -170, ty: -110 },
      { a: -0.95, b: 0.1, c: 0.2, d: 1.05, tx: 230, ty: 45 },
      { a: 0.8, b: 0.25, c: -0.3, d: 0.85, tx: 1_900, ty: 1_200 },
    ];
    const parts = sourceTransforms.map((sourceTransform, index) => {
      const adjustment = adjustments[index]!;
      return {
        ...adaptivePartsFixture(IDS.assetChar)[index]!,
        partId: `71000000-0000-4000-8000-00000000020${index}`,
        assetId: cropAssetId,
        source: {
          kind: 'manual' as const,
          sourceId: `manual:hidden-pivot:${index}`,
        },
        sourceRestTransform: { ...sourceTransform },
        restTransform: characterPartTransformFromStaticAdjustment(
          sourceRootTransform,
          sourceTransform,
          mapping,
          adjustment,
        ),
        staticAdjustment: adjustment,
        imageMapping: mapping,
        drawOrder: index,
        visible: true,
      };
    });
    const projectWithAsset = ProjectSchema.parse({
      ...base,
      assets: [
        ...base.assets,
        {
          id: cropAssetId,
          kind: 'image',
          name: 'hidden-pivot-parts',
          relativePath: 'assets/hidden-pivot-parts.png',
          mimeType: 'image/png',
          width: 80,
          height: 60,
          usage: 'uncategorized',
          keywords: [],
        },
      ],
    });
    const project = new CharacterService().createAdaptiveParts(projectWithAsset, {
      name: 'Hidden pivot Adaptive Character',
      sourceRootTransform,
      parts,
    });
    const character = project.characters.at(-1)!;
    if (character.mode !== 'adaptive-parts') {
      throw new Error('Expected an Adaptive Parts Character.');
    }

    const layerService = new LayerService();
    const place = (candidate: Project, shotId: string) =>
      layerService.createFromAdaptiveCharacter(
        candidate,
        shotId,
        character.id,
        { x: 910, y: 510 },
      );
    const placement = place(project, IDS.shot);
    const ownerTransform = {
      x: 910,
      y: 510,
      scale: 0.84,
      rotationDeg: 17,
      opacity: 1,
      flipX: true,
    };
    const existingVisibleProject = layerService.updateTransform(
      placement.project,
      IDS.shot,
      placement.layer.id,
      ownerTransform,
    );
    const setEdgeVisible = (candidate: Project, visible: boolean) =>
      ProjectSchema.parse({
        ...candidate,
        characters: candidate.characters.map((item) =>
          item.id === character.id && item.mode === 'adaptive-parts'
            ? {
                ...item,
                parts: item.parts.map((part) =>
                  part.partId === parts[2]!.partId ? { ...part, visible } : part,
                ),
              }
            : item,
        ),
      });
    const resolve = (candidate: Project, shotId: string, layerId: string) => {
      const shot = candidate.shots.find((item) => item.id === shotId)!;
      const evaluated = evaluateShotAtTime(shot, 0, candidate);
      return resolveLayerVisualParts(
        candidate,
        shot,
        evaluated.layers.find((item) => item.id === layerId)!,
      );
    };
    const partById = (visual: LayerVisualParts, partId: string) =>
      visual.parts.find((part) =>
        part.source.kind === 'adaptive-part' &&
        part.source.characterPartId === partId,
      )!;
    const assertSameWorldCorners = (
      before: LayerVisualParts,
      after: LayerVisualParts,
      partId: string,
    ) => {
      const beforeCorners = worldCorners(before, partById(before, partId));
      const afterCorners = worldCorners(after, partById(after, partId));
      for (const [index, corner] of beforeCorners.entries()) {
        expect(afterCorners[index]!.x).toBeCloseTo(corner.x, 8);
        expect(afterCorners[index]!.y).toBeCloseTo(corner.y, 8);
      }
    };

    const existingVisible = resolve(
      existingVisibleProject,
      IDS.shot,
      placement.layer.id,
    );
    const hiddenProject = setEdgeVisible(existingVisibleProject, false);
    const existingHidden = resolve(hiddenProject, IDS.shot, placement.layer.id);
    const revealedProject = setEdgeVisible(hiddenProject, true);
    const existingRevealed = resolve(
      revealedProject,
      IDS.shot,
      placement.layer.id,
    );
    for (const part of parts.slice(0, 2)) {
      assertSameWorldCorners(existingVisible, existingHidden, part.partId);
      assertSameWorldCorners(existingVisible, existingRevealed, part.partId);
    }
    expect(partById(existingHidden, parts[2]!.partId).visible).toBe(false);
    expect(existingHidden.combinedLocalBounds).not.toEqual(
      existingVisible.combinedLocalBounds,
    );

    const placeInNewShot = (candidate: Project) => {
      const withShot = new ShotService().create(candidate, {
        name: 'Hidden pivot placement check',
        durationMs: 6_000,
      });
      const shotId = withShot.shots.at(-1)!.id;
      const newPlacement = place(withShot, shotId);
      const transformed = layerService.updateTransform(
        newPlacement.project,
        shotId,
        newPlacement.layer.id,
        ownerTransform,
      );
      return resolve(transformed, shotId, newPlacement.layer.id);
    };
    const newShotVisible = placeInNewShot(existingVisibleProject);
    const newShotHidden = placeInNewShot(hiddenProject);
    for (const part of parts) {
      assertSameWorldCorners(newShotVisible, newShotHidden, part.partId);
    }
  });
});
