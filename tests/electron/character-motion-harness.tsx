import { createRoot } from 'react-dom/client';
import Konva from 'konva';
import { CanvasStage } from '../../src/renderer/features/canvas/CanvasStage';
import { RightInspector } from '../../src/renderer/shell/RightInspector';
import { LayerService, type FlaGraphicDefinition } from '../../src/domain';
import { graphicFaceProject } from '../helpers/graphicFaceProject';
import { TimelineDock } from '../../src/renderer/features/timeline/TimelineDock';
import { PendingDialoguePlacementProvider } from '../../src/renderer/features/timeline/PendingDialoguePlacement';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { characterPartAnimationFixture } from '../helpers/characterPartAnimationFixture';
import { IDS } from '../unit/domain/testProject';
import '../../src/renderer/styles.css';

const fixture = characterPartAnimationFixture();
const character = fixture.project.characters.find(c => c.id === fixture.characterId)!;
if (character.mode !== 'adaptive-parts') throw new Error('Expected adaptive parts');
character.sourceRootTransform = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
character.parts[0]!.displayName = '右手';
character.parts[0]!.imageMapping = { sourceWidth: 640, sourceHeight: 640, crop: { x: 0, y: 0, width: 640, height: 640 }, exportScale: 1 };
character.parts[0]!.restTransform = { a: .25, b: 0, c: 0, d: .25, tx: 0, ty: 0 };
character.parts[1]!.displayName = '配件';
character.parts[1]!.restTransform = { a: 1, b: 0, c: 0, d: 1, tx: 210, ty: 0 };
(fixture.project.animations[0] as FlaGraphicDefinition).structure = (graphicFaceProject().animations[0] as FlaGraphicDefinition).structure;
fixture.project.shots[0]!.layers = fixture.project.shots[0]!.layers.filter(l => l.id === IDS.layerBg || l.id === fixture.layerId);
const firstLayer = fixture.project.shots[0]!.layers.find(l => l.id === fixture.layerId)!;
firstLayer.name = 'Instance A'; firstLayer.x = 600; firstLayer.y = 540;
const placed = new LayerService().createFromAdaptiveCharacter(fixture.project, IDS.shot, fixture.characterId, { x: 1250, y: 540 });
fixture.project = placed.project;
fixture.project.shots[0]!.layers.find(l => l.id === placed.layer.id)!.name = 'Instance B';
const trace: unknown[] = [];
fixture.project.assets.forEach(asset => { asset.sha256 = 'a'.repeat(64); });
const responses = new Map<string, { bytes: Uint8Array; width: number; height: number }>();
for (const asset of fixture.project.assets) {
  if (asset.kind !== 'image') continue;
  const canvas = document.createElement('canvas'); canvas.width = asset.width; canvas.height = asset.height;
  const context = canvas.getContext('2d')!; context.fillStyle = asset.id === IDS.assetChar ? '#327d4b' : '#c98b35';
  context.fillRect(0, 0, asset.width, asset.height);
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
  responses.set(asset.id, { bytes: new Uint8Array(await blob.arrayBuffer()), width: asset.width, height: asset.height });
}
Object.defineProperty(window, 'pandaStage', { value: { assets: { readCanvasImage: async (request: { assetId: string; sha256: string }) => ({
  ok: true, status: 'ready', mimeType: 'image/png', assetId: request.assetId, sha256: request.sha256,
  ...responses.get(request.assetId), byteLength: responses.get(request.assetId)!.bytes.length,
}), readThumbnail: async () => ({ ok: false, error: { code: 'NOT_FOUND', message: 'No harness thumbnail' } }) } } });
editorProjectStore.open('D:/PandaStage-Acceptance/issue1126', fixture.project);
shotStore.select(IDS.shot); selectionStore.select(fixture.layerId);
createRoot(document.getElementById('root')!).render(<PendingDialoguePlacementProvider><div style={{ height: 850, display: 'grid', gridTemplateRows: '650px 190px', gridTemplateColumns: 'minmax(0, 1fr) 280px' }}>
  <CanvasStage showHeading={false} /><RightInspector embedded shellMode="landscape" /><div style={{ gridColumn: '1 / -1' }}><TimelineDock /></div>
</div></PendingDialoguePlacementProvider>);
Object.assign(window, { motionAcceptance: {
  fixture,
  clearSelection: () => selectionStore.clear(),
  reset: () => {
    editorProjectStore.open('D:/PandaStage-Acceptance/issue1128', fixture.project);
    shotStore.select(IDS.shot); selectionStore.select(fixture.layerId);
    timelineUiStore.seek(0, 3000); timelineUiStore.setCharacterMotionAutoKey(false);
  },
  partPoint: (kind: 'image' | 'graphic') => {
    const stage = Konva.stages[0]!;
    const partId = kind === 'image' ? fixture.imagePartId : fixture.graphicPartId;
    const node = stage.findOne((n: Konva.Node) => n.id() === `${fixture.layerId}:${partId}:body`);
    if (!node) return null;
    const bounds = node.getClientRect(), rect = stage.container().getBoundingClientRect();
    stage.off('.directTest');
    stage.on('mousedown.directTest mouseup.directTest click.directTest', e => trace.push({ type: e.type, target: e.target.name(), id: e.target.id(), pointer: stage.getPointerPosition() }));
    const hit = stage.getIntersection({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
    return { x: (bounds.x + bounds.width / 2) * rect.width / stage.width() + rect.left, y: (bounds.y + bounds.height / 2) * rect.height / stage.height() + rect.top,
      bounds, hit: hit?.name(), hitPath: hit?.getAncestors().map((n: Konva.Node) => ({ id:n.id(),name:n.name(),kind:n.getClassName() })), listening:node.isListening() };
  },
  inspect: () => ({ ...editorProjectStore.getSnapshot(), history: editorProjectStore.history.getSnapshot(), selectedPartId: selectionStore.getSelectedCharacterPartId(), trace, stageNodes: Konva.stages.map(stage => stage.toJSON()) }),
  seek: (timeMs: number) => timelineUiStore.seek(timeMs, 3000),
  singleImage: () => {
    const project = structuredClone(fixture.project);
    const character = project.characters.find(c => c.id === fixture.characterId)!;
    if (character.mode === 'adaptive-parts') character.parts = [character.parts[0]!];
    editorProjectStore.open('D:/PandaStage-Acceptance/issue1126-single', project);
    shotStore.select(IDS.shot); selectionStore.select(fixture.layerId); timelineUiStore.seek(500, 3000);
  },
  undo: () => editorProjectStore.undo(), redo: () => editorProjectStore.redo(),
  handle: (kind: string) => {
    const stage = Konva.stages[0], node = kind === 'move' ? stage?.findOne((n: Konva.Node) => n.hasName('character-motion-part') && n.draggable()) : stage?.findOne(`.character-motion-${kind}`);
    if (!stage || !node) return null;
    stage.off('.motionTest');
    stage.on('mousedown.motionTest dragstart.motionTest dragend.motionTest click.motionTest', event => trace.push({ type: event.type, target: event.target.name(), pointer: stage.getPointerPosition() }));
    node.off('.motionTest');
    node.on('dragstart.motionTest dragmove.motionTest dragend.motionTest', event => trace.push({ type: event.type, node: node.name(), pointer: stage.getPointerPosition() }));
    const bounds = node.getClientRect();
    const position = kind === 'move' ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } : node.getAbsolutePosition(), rect = stage.container().getBoundingClientRect();
    return { x: position.x * rect.width / stage.width() + rect.left, y: position.y * rect.height / stage.height() + rect.top,
      hit: stage.getIntersection(position)?.name(), position, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
  },
} });
