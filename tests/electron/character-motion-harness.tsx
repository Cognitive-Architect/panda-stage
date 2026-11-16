import { createRoot } from 'react-dom/client';
import Konva from 'konva';
import { CanvasStage } from '../../src/renderer/features/canvas/CanvasStage';
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
}) } } });
editorProjectStore.open('D:/PandaStage-Acceptance/issue1126', fixture.project);
shotStore.select(IDS.shot); selectionStore.select(fixture.layerId);
createRoot(document.getElementById('root')!).render(<PendingDialoguePlacementProvider><div style={{ height: 850, display: 'grid', gridTemplateRows: '650px 190px' }}>
  <CanvasStage showHeading={false} /><TimelineDock />
</div></PendingDialoguePlacementProvider>);
Object.assign(window, { motionAcceptance: {
  fixture,
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
    const stage = Konva.stages[0], node = stage?.findOne(`.character-motion-${kind}`);
    if (!stage || !node) return null;
    stage.off('.motionTest');
    stage.on('mousedown.motionTest dragstart.motionTest dragend.motionTest click.motionTest', event => trace.push({ type: event.type, target: event.target.name(), pointer: stage.getPointerPosition() }));
    node.off('.motionTest');
    node.on('dragstart.motionTest dragmove.motionTest dragend.motionTest', event => trace.push({ type: event.type, node: node.name(), pointer: stage.getPointerPosition() }));
    const position = node.getAbsolutePosition(), rect = stage.container().getBoundingClientRect();
    return { x: position.x * rect.width / stage.width() + rect.left, y: position.y * rect.height / stage.height() + rect.top,
      hit: stage.getIntersection(position)?.name(), position, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
  },
} });
