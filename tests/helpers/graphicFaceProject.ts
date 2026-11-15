import { ProjectSchema, type FlaGraphicDefinition } from '../../src/domain';
import { buildProject, IDS } from '../unit/domain/testProject';

export const FACE_GRAPHIC_ID = '91000000-0000-4000-8000-000000001112';
export const faceSource = (firstFrame: number) => ({ kind: 'fla-graphic' as const, animationId: FACE_GRAPHIC_ID, firstFrame });

export function graphicFaceProject(structured = true) {
  const project = buildProject();
  const duration = 1000 / 24;
  const definition: FlaGraphicDefinition = {
    id: FACE_GRAPHIC_ID, name: 'Four faces', kind: 'fla-graphic',
    source: { basename: 'faces.fla', sha256: 'c'.repeat(64), renderTargetId: 'faces', targetKind: 'graphic-symbol', targetName: 'faces', startFrameIndex: 7, endFrameIndex: 10, sourceFps: 24, canvas: { width: 200, height: 180 }, anchor: { x: 0, y: 0 }, documentCanvas: { width: 1920, height: 1080 } },
    durationMs: 4 * duration,
    frames: Array.from({ length: 4 }, (_, ordinal) => ({ ordinal, sourceFrameIndex: ordinal + 7, assetId: `92000000-0000-4000-8000-${String(ordinal + 1).padStart(12, '0')}`, sha256: 'a'.repeat(64), sourceViewport: { x: ordinal * 5, y: 8, width: 80 + ordinal * 10, height: 70 }, offset: { x: ordinal * 5, y: 8 }, startMs: ordinal * duration, durationMs: duration, createdBySequenceImport: false })),
    ...(structured ? { structure: { version: 1 as const, frames: Array.from({ length: 4 }, (_, ordinal) => ({ ordinal, layers: [{ name: 'face', nodes: [{ id: 'face-' + ordinal, type: 'bitmap' as const, drawOrder: 0, bitmapRef: 'face', assetId: ordinal % 2 === 0 ? IDS.assetChar : IDS.assetChar2, localTransform: { a: 0.2, b: 0, c: 0, d: 0.2, tx: 12, ty: 10 } }] }] })) } } : {}),
  };
  return ProjectSchema.parse({ ...project, animations: [definition], assets: [...project.assets, ...definition.frames.map(frame => ({ id: frame.assetId, kind: 'image', name: `Face ${frame.ordinal}`, relativePath: `assets/face-${frame.ordinal}.svg`, mimeType: 'image/svg+xml', sha256: frame.sha256, width: frame.sourceViewport.width, height: frame.sourceViewport.height, usage: 'character', keywords: [], flaGraphicFrame: { definitionId: definition.id, ordinal: frame.ordinal } }))] });
}
