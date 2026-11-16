import { CharacterMotionService, LayerService, ProjectSchema, type FlaGraphicDefinition } from '../../src/domain';
import { characterPartAnimationFixture } from './characterPartAnimationFixture';
import { graphicFaceProject } from './graphicFaceProject';
import { IDS } from '../unit/domain/testProject';
import { adaptFlaXflDisplaySource } from '../../src/main/services/fla-static-snapshot-display-list-adapter';
import { prepareFlaNestedGraphicFrameSelections } from '../../src/main/services/fla-nested-graphic-frame-selector';
import { resolveFlaDisplayList } from '../../src/main/services/fla-display-list-resolver';
import { captureFlaGraphicStructure } from '../../src/main/services/flaGraphicStructureCapture';

/** Small, synthetic A/B/C acceptance samples. Never represents the real bitmap-fill sample D. */
export function animationV0UatFixture(nested = false) {
  const fixture = characterPartAnimationFixture();
  const project = fixture.project;
  project.name = nested ? 'V0 C Nested clocks' : 'V0 A-B Image and Graphic';
  project.shots[0]!.durationMs = 1000;
  project.shots[0]!.layers = project.shots[0]!.layers.filter(l => l.id === fixture.layerId || l.id === IDS.layerBg);
  const character = project.characters.find(c => c.id === fixture.characterId)!;
  if (character.mode !== 'adaptive-parts') throw new Error('Expected adaptive parts');
  character.sourceRootTransform = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  character.parts[0]!.displayName = 'Image';
  character.parts[0]!.imageMapping = { sourceWidth: 640, sourceHeight: 640, crop: { x: 0, y: 0, width: 640, height: 640 }, exportScale: 1 };
  character.parts[0]!.restTransform = { a: .25, b: 0, c: 0, d: .25, tx: 0, ty: 0 };
  character.parts[1]!.displayName = 'Graphic';
  character.parts[1]!.restTransform = { a: 1, b: 0, c: 0, d: 1, tx: 210, ty: 0 };
  const definition = project.animations[0] as FlaGraphicDefinition;
  definition.structure = (graphicFaceProject().animations[0] as FlaGraphicDefinition).structure;
  if (nested) definition.structure = nestedStructure(definition);
  const first = project.shots[0]!.layers.find(l => l.id === fixture.layerId)!;
  first.name = 'Instance A'; first.x = 600; first.y = 540;
  const placed = new LayerService().createFromAdaptiveCharacter(ProjectSchema.parse(project), IDS.shot, fixture.characterId, { x: 1250, y: 540 });
  placed.project.shots[0]!.layers.find(l => l.id === placed.layer.id)!.name = 'Instance B';
  const motion = new CharacterMotionService();
  let authored = motion.apply(placed.project, { shotId: IDS.shot, layerId: first.id, partId: fixture.imagePartId, timeMs: 500, autoKey: true }, { 'transform.rotationDeg': 90 });
  authored = motion.apply(authored, { shotId: IDS.shot, layerId: first.id, partId: fixture.graphicPartId, timeMs: 500, autoKey: true }, { 'transform.rotationDeg': 90, 'transform.offsetY': -50 });
  authored = motion.apply(authored, { shotId: IDS.shot, layerId: placed.layer.id, partId: fixture.graphicPartId, timeMs: 500, autoKey: true }, { 'transform.rotationDeg': -45 });
  return { ...fixture, project: authored, secondLayerId: placed.layer.id };
}

function nestedStructure(definition: FlaGraphicDefinition) {
  const timeline = (frames: string) => `<DOMTimeline name="clock"><layers><DOMLayer name="content"><frames>${frames}</frames></DOMLayer></layers></DOMTimeline>`;
  const symbol = (name: string, frames: string) => ({ name: `LIBRARY/${name}.xml`, xml: `<DOMSymbolItem name="${name}" symbolType="graphic"><timeline>${timeline(frames)}</timeline></DOMSymbolItem>` });
  const instance = (name: string, mode: string, x = 0) => `<DOMSymbolInstance libraryItemName="${name}" symbolType="graphic" loop="${mode}" firstFrame="1"><matrix><Matrix tx="${x}"/></matrix></DOMSymbolInstance>`;
  const source = adaptFlaXflDisplaySource('<DOMDocument width="200" height="180"/>', [
    symbol('root', `<DOMFrame index="0" duration="4"><elements>${['loop', 'play once', 'single frame'].map((mode, i) => instance('middle', mode, i * 55)).join('')}</elements></DOMFrame>`),
    symbol('middle', `<DOMFrame index="0" duration="4"><elements>${instance('leaf', 'loop')}</elements></DOMFrame>`),
    symbol('leaf', Array.from({ length: 4 }, (_, i) => `<DOMFrame index="${i}" duration="1"><elements><DOMBitmapInstance libraryItemName="frame-${i}" ><matrix><Matrix a="0.07" d="0.07" tx="${i * 3}"/></matrix></DOMBitmapInstance></elements></DOMFrame>`).join('')),
  ]);
  if (!source.ok) throw new Error(source.message);
  const root = source.source.graphicSymbols.find(s => s.sourceLibraryItemName === 'root')!;
  const frames = definition.frames.map(frame => {
    const context = source.source.buildGraphicFrameContext(root.timelineXml, root.frameSpanIndex, frame.ordinal, 'uat-root');
    if (!context.ok) throw new Error(context.message);
    const selected = prepareFlaNestedGraphicFrameSelections(source.source, { kind: 'graphic', name: 'root', frameContext: context.value });
    if (!selected.ok) throw new Error(selected.message);
    const resolved = resolveFlaDisplayList(selected.resolverInput);
    if (!resolved.ok) throw new Error(resolved.message);
    const captured = captureFlaGraphicStructure(resolved.displayList, { bitmapAssetMap: new Map([0, 1, 2, 3].map(i => [`frame-${i}`, i % 2 ? IDS.assetChar2 : IDS.assetChar])) })!;
    for (const layer of captured.frames[0]!.layers) for (const node of layer.nodes) node.id += `-frame-${frame.ordinal}`;
    return { ...captured, frame: { ...captured.frames[0]!, ordinal: frame.ordinal } };
  });
  return { version: 1 as const, frames: frames.map(f => f.frame), symbolDefinitions: Object.assign({}, ...frames.map(f => f.symbolDefinitions)) };
}
