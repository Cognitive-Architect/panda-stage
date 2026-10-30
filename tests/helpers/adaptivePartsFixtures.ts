import type { CharacterPart } from '../../src/domain';

const SOURCE_POSE_FRAME = 0;
const EFFECTIVE_FRAME = 0;

const SOURCE_PARTS: readonly {
  partId: string;
  sourceKind: 'source-instance' | 'manual';
  sourceId: string;
  displayName: string;
  matrix: readonly [number, number, number, number, number, number];
}[] = [
  {
    partId: '71000000-0000-4000-8000-000000000001',
    sourceKind: 'source-instance',
    sourceId: 'com1.instances[4]:com6',
    displayName: 'com6',
    matrix: [1, 0, 0, 1, 191.1, 424.75],
  },
  {
    partId: '71000000-0000-4000-8000-000000000002',
    sourceKind: 'source-instance',
    sourceId: 'com1.instances[3]:com2',
    displayName: 'com2',
    matrix: [1, 0, 0, 1, 0, 396.3],
  },
  {
    partId: '71000000-0000-4000-8000-000000000003',
    sourceKind: 'source-instance',
    sourceId: 'com1.instances[2]:com5',
    displayName: 'com5',
    matrix: [1, 0, 0, 1, 167.05, 665.2],
  },
  {
    partId: '71000000-0000-4000-8000-000000000004',
    sourceKind: 'source-instance',
    sourceId: 'com1.instances[1]:com4',
    displayName: 'com4',
    matrix: [1, 0, 0, 1, 151.7, 191.1],
  },
  {
    partId: '71000000-0000-4000-8000-000000000005',
    sourceKind: 'source-instance',
    sourceId: 'com1.instances[0]:com3',
    displayName: 'com3',
    matrix: [1, 0, 0, 1, 230.2, 669.7],
  },
  {
    partId: '71000000-0000-4000-8000-000000000006',
    sourceKind: 'manual',
    sourceId: 'manual:fixture:body-arm-composite',
    displayName: 'Body + arm composite',
    matrix: [1, 0, 0, 1, 320, 420],
  },
];

/** C0 com1 container matrix, kept separate from all Part-local matrices. */
export function adaptivePartsSourceRootTransform() {
  return { a: 1, b: 0, c: 0, d: 1, tx: 790, ty: 47.6 };
}

/** Synthetic no-art Part data: five source instances and one composite source. */
export function adaptivePartsFixture(assetId: string): CharacterPart[] {
  return SOURCE_PARTS.map(({ partId, sourceKind, sourceId, displayName, matrix }, drawOrder) => {
    const [a, b, c, d, tx, ty] = matrix;
    const source = sourceKind === 'source-instance'
      ? {
          kind: sourceKind,
          sourceId,
          sourcePoseFrame: SOURCE_POSE_FRAME,
          effectiveFrame: EFFECTIVE_FRAME,
        }
      : { kind: sourceKind, sourceId };
    return {
      partId,
      assetId,
      source,
      restTransform: { a, b, c, d, tx, ty },
      imageMapping: {
        sourceWidth: 640,
        sourceHeight: 640,
        crop: { x: 0, y: 0, width: 640, height: 640 },
        exportScale: 1,
      },
      drawOrder,
      visible: true,
      displayName,
    };
  });
}
