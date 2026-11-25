import { describe, expect, it } from 'vitest';
import { resolveFlaDisplayList } from '../../src/main/services/fla-display-list-resolver';
import { adaptFlaXflDisplaySource } from '../../src/main/services/fla-static-snapshot-display-list-adapter';
import { projectFlaInstance } from '../../src/shared/fla-instance-projection';

const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
const perspective = { focalLength: 100, vanishingX: 0, vanishingY: 0, depth: 0, rotationX: 0, rotationY: 0, rotationZ: 0 };

describe('XFL instance affine projection', () => {
  it('foreshortens each axis, retains mirrored transforms and avoids a second authored Z rotation', () => {
    const x = projectFlaInstance(identity, identity, { ...perspective, rotationX: 45 })!;
    expect(x.d).toBeCloseTo(Math.SQRT1_2);
    expect(x.a).toBeCloseTo(1);
    const y = projectFlaInstance({ ...identity, a: -1 }, identity, { ...perspective, rotationY: -45 })!;
    expect(y.a).toBeCloseTo(-Math.SQRT1_2);
    expect(y.d).toBeCloseTo(1);
    const rotated = { ...identity, a: 0, b: 1, c: -1, d: 0 };
    expect(projectFlaInstance(rotated, identity, { ...perspective, rotationZ: 90 })).toEqual(rotated);
    expect(projectFlaInstance(identity, identity, { ...perspective, depth: -100 })).toBeNull();
  });

  it('resolves authored XFL under parent and document perspective, skipping a behind-viewer sibling', () => {
    const symbols = [{
      name: 'Card.xml',
      xml: '<DOMSymbolItem name="Card" symbolType="graphic"><timeline><DOMTimeline><layers><DOMLayer><frames><DOMFrame index="0"><elements><DOMShape/></elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>',
    }];
    const doc = `<DOMDocument width="200" height="200" frameRate="24" viewAngle3D="90" vanishingPoint3DX="20" vanishingPoint3DY="30">
      <timelines><DOMTimeline><layers><DOMLayer><frames><DOMFrame index="0"><elements>
        <DOMGroup><matrix><Matrix a="2" d="2" tx="20" ty="30"/></matrix><members>
          <DOMSymbolInstance libraryItemName="Card" symbolType="graphic" rotationY="45" centerPoint3DX="20" centerPoint3DY="30">
            <matrix><Matrix a="2" d="2" tx="20" ty="30"/></matrix>
          </DOMSymbolInstance>
          <DOMSymbolInstance libraryItemName="Card" symbolType="graphic" z="-101"/>
        </members></DOMGroup>
      </elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>`;
    const source = adaptFlaXflDisplaySource(doc, symbols);
    if (!source.ok) throw new Error(source.message);
    const scene = source.source.sceneTimelines[0]!;
    const resolved = resolveFlaDisplayList({ root: { kind: 'scene', name: scene.name, frameContext: scene.frameContext }, symbols: source.source.symbols });
    if (!resolved.ok) throw new Error(resolved.message);
    const group = resolved.displayList.layers[0]?.children[0];
    if (group?.kind !== 'group') throw new Error('Expected parent group');
    expect(group.children).toHaveLength(1);
    const card = group.children[0]!;
    expect(card.worldTransform.a).toBeCloseTo(2 * Math.SQRT1_2);
    expect(card.worldTransform.tx).toBeCloseTo(20);
    expect(card.worldTransform.ty).toBeCloseTo(30);
    expect(resolved.displayList.projectionDiagnostics?.[0]).toContain('3D instance projection');
  });
});
