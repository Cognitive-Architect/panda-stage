import { CharacterService, ProjectSchema, upsertCharacterActionEvent } from '../../src/domain';
import { isFlaGraphicDefinition } from '../../src/domain/models/animation';
import { IDS } from '../unit/domain/testProject';
import { graphicFaceProject } from './graphicFaceProject';

export function characterActionGraphicFixture(animated = true) {
  const project = graphicFaceProject();
  const graphic = project.animations[0]!;
  if (!isFlaGraphicDefinition(graphic) || !graphic.structure) throw new Error('Expected a structured Graphic.');
  const frame = graphic.frames[0]!;
  const structureFrame = graphic.structure.frames[0]!;
  const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  graphic.frames = [frame];
  graphic.durationMs = frame.durationMs;
  graphic.source.endFrameIndex = graphic.source.startFrameIndex;
  graphic.structure.frames = [structureFrame];
  structureFrame.layers = [{ name: 'Arm', nodes: [{
    type: 'symbol', id: 'arm', symbolRef: 'Arm', nestedDefinitionId: 'arm-definition',
    playbackMode: 'loop', firstFrame: '0', drawOrder: 0, localTransform: identity,
  }] }];
  graphic.structure.symbolDefinitions = {
    'arm-definition': {
      symbolRef: 'Arm',
      sourceFrameCount: animated ? 13 : 1,
      children: [{
        type: 'bitmap', id: 'hand', sourceAddress: 'Arm/hand', bitmapRef: 'Hand',
        assetId: IDS.assetChar2, drawOrder: 0, localTransform: identity,
      }],
      ...(animated ? { timeline: { tracks: [{
        trackId: 'addr:Arm/hand',
        keyframes: [0, 250, 500].map((timeMs) => ({
          timeMs, easing: 'linear' as const,
          transform: { tx: timeMs / 5, ty: 0, rotationDeg: 0, scaleX: 1, scaleY: 1 },
        })),
      }] } } : {}),
    },
  };
  project.assets = project.assets.filter((asset) => !('flaGraphicFrame' in asset) ||
    !asset.flaGraphicFrame || asset.id === frame.assetId);
  const shot = project.shots[0]!;
  const layer = shot.layers.find((entry) => entry.id === IDS.layerChar)!;
  Object.assign(layer, { x: 600, y: 400, scaleX: 1, scaleY: 1, flipX: true, rotationDeg: 90 });
  const actionId = '71000000-0000-4000-8000-000000000003';
  const authored = new CharacterService({ createId: () => actionId }).setAction(
    ProjectSchema.parse(project), IDS.character, {
      name: '挥手', animationId: graphic.id, placement: { offsetX: 24, offsetY: 12, scale: 1.5 },
    },
  );
  return upsertCharacterActionEvent(authored, shot.id, layer.id, {
    actionId, startMs: 250, endMs: 1_250,
  });
}
