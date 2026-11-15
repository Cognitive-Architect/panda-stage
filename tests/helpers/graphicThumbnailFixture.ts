import { createHash } from 'node:crypto';
import { ProjectSchema } from '../../src/domain';
import { graphicFaceProject } from './graphicFaceProject';

export function graphicThumbnailFixture(svg = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="70"><path fill="#336699" d="M0 0H80V70H0Z"/></svg>', shape = false) {
  const source = graphicFaceProject();
  const definition = source.animations[0]!;
  const frame = definition.frames[0]!;
  const bytes = Buffer.from(svg, 'utf8');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const shapeAsset = { ...source.assets.find(asset => asset.id === frame.assetId)!, id: '92000000-0000-4000-8000-000000009999', relativePath: 'assets/generated-shape.svg', sha256 };
  Reflect.deleteProperty(shapeAsset, 'flaGraphicFrame');
  const structure = { version: 1, frames: [{ ordinal: 0, layers: [{ name: 'shape', nodes: [{
    id: 'shape', type: 'opaque', drawOrder: 0, opaqueKind: 'shape', fallbackScope: 'subtree',
    fallbackAssetId: shapeAsset.id, localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
  }] }] }] };
  const project = ProjectSchema.parse({
    ...source,
    assets: [...source.assets.map((asset) => asset.id === frame.assetId ? { ...asset, sha256 } : asset), ...(shape ? [shapeAsset] : [])],
    animations: [{ ...definition, ...(shape ? { structure } : {}), frames: definition.frames.map((item) => item.assetId === frame.assetId ? { ...item, sha256 } : item) }],
  });
  const asset = project.assets.find((item) => item.id === (shape ? shapeAsset.id : frame.assetId))!;
  return { project, asset, bytes };
}
