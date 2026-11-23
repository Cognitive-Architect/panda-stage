import { isFlaGraphicDefinition, LayerService, ProjectSchema, setGraphicFrameAtTime } from '../../src/domain';
import { IDS } from '../unit/domain/testProject';
import { graphicFaceProject } from './graphicFaceProject';

/** Color-coded mouth and prop on two ordinary Graphic layers. */
export function graphicFrameUatFixture() {
  const project = graphicFaceProject();
  const mouth = project.animations[0]!;
  if (!isFlaGraphicDefinition(mouth)) throw new Error('Expected a Graphic fixture.');
  const propId = '91000000-0000-4000-8000-000000001122';
  const prop = {
    ...structuredClone(mouth), id: propId, name: 'Prop',
    frames: mouth.frames.map((frame) => ({
      ...frame, assetId: `92000000-0000-4000-8000-0000000001${String(frame.ordinal).padStart(2, '0')}`,
    })),
  };
  project.animations.push(prop);
  for (const [index, frame] of prop.frames.entries()) {
    const asset = project.assets.find((entry) => entry.id === mouth.frames[index]!.assetId);
    if (asset?.kind !== 'image') throw new Error('Expected a baked Graphic frame.');
    project.assets.push({
      ...asset, id: frame.assetId, name: `Prop ${index}`, relativePath: `assets/prop-${index}.svg`,
      flaGraphicFrame: { definitionId: propId, ordinal: index },
    });
  }
  project.characters = [];
  project.voiceProfiles = [];
  project.shots[0]!.layers = project.shots[0]!.layers.filter((entry) => entry.id === IDS.layerBg);
  const service = new LayerService();
  const left = service.createFromAnimation(ProjectSchema.parse(project), IDS.shot, {
    animationId: mouth.id, startTimeMs: 0, position: { x: 500, y: 500 },
  });
  const right = service.createFromAnimation(left.project, IDS.shot, {
    animationId: prop.id, startTimeMs: 0, position: { x: 1300, y: 500 },
  });
  let authored = right.project;
  for (const [timeMs, leftFrame, rightFrame] of [[0, 7, 8], [500, 8, 7], [1_000, 7, 8]] as const) {
    authored = setGraphicFrameAtTime(authored, IDS.shot, left.layer.id, mouth.id, leftFrame, timeMs);
    authored = setGraphicFrameAtTime(authored, IDS.shot, right.layer.id, prop.id, rightFrame, timeMs);
  }
  return authored;
}
