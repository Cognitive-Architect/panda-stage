import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { resolveFlaDisplayList } from '../../src/main/services/fla-display-list-resolver';
import {
  adaptFlaXflDisplaySource,
} from '../../src/main/services/fla-static-snapshot-display-list-adapter';
import {
  buildSvgForRenderTarget,
  prepareFlaStaticSnapshotDisplaySource,
} from '../../src/main/services/fla-static-snapshot-svg-builder';
import { captureFlaGraphicStructure } from '../../src/main/services/flaGraphicStructureCapture';
import { evaluateFlaGraphicVisual } from '../../src/domain/evaluate-fla-graphic';
import { projectFlaInstance } from '../../src/shared/fla-instance-projection';
import type { FlaRenderTarget } from '../../src/shared/fla-static-snapshot-api';

const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
const perspective = { focalLength: 100, vanishingX: 0, vanishingY: 0, depth: 0, rotationX: 0, rotationY: 0, rotationZ: 0 };

const cardSymbol = {
  name: 'Card.xml',
  xml: `<DOMSymbolItem name="Card" symbolType="graphic"><timeline><DOMTimeline><layers><DOMLayer><frames>
    <DOMFrame index="0"><elements><DOMShape><fills><FillStyle index="1"><SolidColor color="#2266cc"/></FillStyle></fills>
      <edges><Edge fillStyle0="1" edges="!0 0|400 0|400 200|0 200|0 0"/></edges></DOMShape></elements></DOMFrame>
    <DOMFrame index="1"><elements><DOMShape><fills><FillStyle index="1"><SolidColor color="#cc6622"/></FillStyle></fills>
      <edges><Edge fillStyle0="1" edges="!0 0|400 0|400 200|0 200|0 0"/></edges></DOMShape></elements></DOMFrame>
    <DOMFrame index="2"><elements><DOMShape><fills><FillStyle index="1"><SolidColor color="#22aa44"/></FillStyle></fills>
      <edges><Edge fillStyle0="1" edges="!0 0|400 0|400 200|0 200|0 0"/></edges></DOMShape></elements></DOMFrame>
  </frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>`,
};

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
    // Mirrored + 180deg Z should still apply Z instead of aliasing with 0deg.
    const mirrored180 = projectFlaInstance({ ...identity, a: -1 }, identity, { ...perspective, rotationZ: 180 })!;
    expect(mirrored180.a).toBeCloseTo(1);
    expect(mirrored180.d).toBeCloseTo(-1);
    expect(projectFlaInstance(identity, identity, { ...perspective, depth: -100 })).toBeNull();
  });

  it.each([
    ['z="100"', 0.5],
    ['centerPoint3DZ="100"', 0.5],
    ['centerPoint3DZ="100" rotationY="45"', 0.5 * Math.SQRT1_2],
    ['centerPoint3DZ="100" z="0"', 1],
    ['centerPoint3DX="20" centerPoint3DY="30" centerPoint3DZ="0"', 1],
  ])('resolves authored depth and 2D pivot metadata (%s)', (attrs, scaleX) => {
    const doc = `<DOMDocument width="200" height="200" frameRate="24" viewAngle3D="90" vanishingPoint3DX="100" vanishingPoint3DY="100">
      <timelines><DOMTimeline name="Scene 1"><layers><DOMLayer><frames><DOMFrame index="0"><elements>
        <DOMSymbolInstance libraryItemName="Card" symbolType="graphic" ${attrs}><matrix><Matrix tx="100" ty="100"/></matrix></DOMSymbolInstance>
      </elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>`;
    const adapted = adaptFlaXflDisplaySource(doc, [cardSymbol]);
    if (!adapted.ok) throw new Error(adapted.message);
    const frame = adapted.source.buildSceneFrameContext(adapted.source.sceneTimelines[0]!.xml, 0, 'scene:0');
    if (!frame.ok) throw new Error(frame.message);
    const resolved = resolveFlaDisplayList({
      root: { kind: 'scene', name: 'Scene 1', frameContext: frame.value },
      symbols: adapted.source.symbols,
    });
    if (!resolved.ok) throw new Error(resolved.message);
    expect(resolved.displayList.layers[0]?.children[0]?.worldTransform.a).toBeCloseTo(scaleX);
    expect(resolved.displayList.projectionDiagnostics).toBeUndefined();
  });

  it('moves the authored projection pivot with baked IK without moving the vanishing point', () => {
    const doc = `<DOMDocument width="200" height="200" frameRate="24" viewAngle3D="90"
      vanishingPoint3DX="100" vanishingPoint3DY="100"><timelines><DOMTimeline name="Scene 1">
      <layers><DOMLayer><frames><DOMFrame index="0" duration="2" tweenType="IK pose">
        <elements><DOMSymbolInstance libraryItemName="Card" symbolType="graphic" rotationY="45"
            centerPoint3DX="100" centerPoint3DY="100">
          <matrix><Matrix tx="100" ty="100"/></matrix>
        </DOMSymbolInstance></elements>
        <betweenFrameMatrixList><Matrix/><Matrix tx="40"/></betweenFrameMatrixList>
      </DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>`;
    const adapted = adaptFlaXflDisplaySource(doc, [cardSymbol]);
    if (!adapted.ok) throw new Error(adapted.message);
    const sample = (frameIndex: number) => {
      const frame = adapted.source.buildSceneFrameContext(adapted.source.sceneTimelines[0]!.xml, frameIndex, 'scene:0');
      if (!frame.ok) throw new Error(frame.message);
      const result = resolveFlaDisplayList({
        root: { kind: 'scene', name: 'Scene 1', frameContext: frame.value }, symbols: adapted.source.symbols,
      });
      if (!result.ok) throw new Error(result.message);
      expect(result.displayList.projectionDiagnostics).toBeUndefined();
      return result.displayList.layers[0]!.children[0]!.worldTransform;
    };
    expect(sample(0).tx).toBeCloseTo(100);
    expect(sample(1).tx).toBeCloseTo(140);
    expect(sample(1).a * 20).toBeCloseTo(20 * Math.SQRT1_2 * 1.4);
  });

  it('maps an off-center projection pivot through Object Motion rotation and scale', () => {
    const doc = `<DOMDocument width="200" height="200" frameRate="24" viewAngle3D="90"
      vanishingPoint3DX="100" vanishingPoint3DY="100"><timelines><DOMTimeline name="Scene 1">
      <layers><DOMLayer><frames><DOMFrame index="0" duration="3" tweenType="motion object">
        <motionObjectXML><AnimationCore TimeScale="24000" duration="3000"><PropertyContainer id="Motion">
          <Property id="Scale_X"><Keyframe timevalue="0" anchor="0,100"/><Keyframe timevalue="2000" anchor="0,200"/></Property>
          <Property id="Rotation_Z"><Keyframe timevalue="0" anchor="0,0"/><Keyframe timevalue="2000" anchor="0,90"/></Property>
          <Property id="Motion_X"><Keyframe timevalue="0" anchor="0,0"/><Keyframe timevalue="2000" anchor="0,40"/></Property>
        </PropertyContainer></AnimationCore></motionObjectXML>
        <elements><DOMSymbolInstance libraryItemName="Card" symbolType="graphic" rotationY="45"
            centerPoint3DX="110" centerPoint3DY="100">
          <matrix><Matrix tx="100" ty="100"/></matrix><transformationPoint><Point x="0" y="0"/></transformationPoint>
        </DOMSymbolInstance></elements>
      </DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>`;
    const adapted = adaptFlaXflDisplaySource(doc, [cardSymbol]);
    if (!adapted.ok) throw new Error(adapted.message);
    const frame = adapted.source.buildSceneFrameContext(adapted.source.sceneTimelines[0]!.xml, 2, 'scene:0');
    if (!frame.ok) throw new Error(frame.message);
    const element = frame.value.layers[0]!.elements[0]!;
    expect(element).toMatchObject({ kind: 'symbol', projection3D: { rotationY: 45, rotationZ: 0 } });
    if (element.kind !== 'symbol') throw new Error('Expected projected symbol');
    expect(element.projection3D?.pivotX).toBeCloseTo(140);
    expect(element.projection3D?.pivotY).toBeCloseTo(120);
    const result = resolveFlaDisplayList({
      root: { kind: 'scene', name: 'Scene 1', frameContext: frame.value }, symbols: adapted.source.symbols,
    });
    if (!result.ok) throw new Error(result.message);
    const pose = result.displayList.layers[0]!.children[0]!.worldTransform;
    expect(pose.tx + 10 * pose.a).toBeCloseTo(140);
    expect(pose.ty + 10 * pose.b).toBeCloseTo(120);
  });

  it('resolves authored XFL under parent and document perspective, skipping a behind-viewer sibling', () => {
    const doc = `<DOMDocument width="200" height="200" frameRate="24" viewAngle3D="90" vanishingPoint3DX="20" vanishingPoint3DY="30">
      <timelines><DOMTimeline><layers><DOMLayer><frames><DOMFrame index="0"><elements>
        <DOMGroup><matrix><Matrix a="2" d="2" tx="20" ty="30"/></matrix><members>
          <DOMSymbolInstance libraryItemName="Card" symbolType="graphic" rotationY="45" centerPoint3DX="20" centerPoint3DY="30">
            <matrix><Matrix a="2" d="2" tx="20" ty="30"/></matrix>
          </DOMSymbolInstance>
          <DOMSymbolInstance libraryItemName="Card" symbolType="graphic" z="-101"/>
          <DOMSymbolInstance libraryItemName="Card" symbolType="graphic"><matrix3D><Matrix3D/></matrix3D></DOMSymbolInstance>
        </members></DOMGroup>
      </elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>`;
    const source = adaptFlaXflDisplaySource(doc, [cardSymbol]);
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
    expect(resolved.displayList.projectionDiagnostics?.length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ['XY only', '', '', undefined],
    ['zero at both endpoints', ' centerPoint3DZ="0"', ' centerPoint3DZ="0"', undefined],
    ['zero on the start only', ' centerPoint3DZ="0"', '', undefined],
    ['zero on the end only', '', ' centerPoint3DZ="-0.0"', undefined],
    ['nonzero depth', ' centerPoint3DZ="1"', '', 'centerPoint3DZ must be a numeric zero'],
    ['empty depth', '', ' centerPoint3DZ=""', 'centerPoint3DZ must be a numeric zero'],
    ['whitespace depth', ' centerPoint3DZ=" "', '', 'centerPoint3DZ must be a numeric zero'],
    ['invalid depth', '', ' centerPoint3DZ="invalid"', 'centerPoint3DZ must be a numeric zero'],
    ['nonfinite depth', ' centerPoint3DZ="1e999"', '', 'centerPoint3DZ must be a numeric zero'],
    ['3D rotation with zero depth', ' centerPoint3DZ="0" rotationY="45"', '', 'unsupported attributes'],
  ])('evaluates 2D Classic Motion endpoint metadata (%s)', async (_label, startDepth, endDepth, rejection) => {
    const hostXml = `<DOMSymbolItem name="MotionHost" symbolType="graphic"><timeline><DOMTimeline><layers>
      <DOMLayer name="Mover"><frames>
        <DOMFrame index="0" duration="4" tweenType="motion" keyMode="24065" motionTweenSync="true" motionTweenRotate="clockwise" motionTweenRotateTimes="0">
          <elements>
            <DOMSymbolInstance libraryItemName="Card" symbolType="graphic" loop="loop" firstFrame="0" centerPoint3DX="30" centerPoint3DY="40"${startDepth}>
              <matrix><Matrix a="1" b="0" c="0" d="1" tx="10" ty="20"/></matrix>
              <transformationPoint><Point x="0" y="0"/></transformationPoint>
            </DOMSymbolInstance>
          </elements>
        </DOMFrame>
        <DOMFrame index="4" duration="2" keyMode="9728">
          <elements>
            <DOMSymbolInstance libraryItemName="Card" symbolType="graphic" loop="loop" firstFrame="0" centerPoint3DX="110" centerPoint3DY="60"${endDepth}>
              <matrix><Matrix a="0" b="1" c="-1" d="0" tx="90" ty="60"/></matrix>
              <transformationPoint><Point x="0" y="0"/></transformationPoint>
            </DOMSymbolInstance>
          </elements>
        </DOMFrame>
        <DOMFrame index="6" duration="2">
          <elements>
            <DOMSymbolInstance libraryItemName="Card" symbolType="graphic" loop="single frame" firstFrame="2" centerPoint3DX="150" centerPoint3DY="80">
              <matrix><Matrix a="1" b="0" c="0" d="1" tx="150" ty="80"/></matrix>
            </DOMSymbolInstance>
          </elements>
        </DOMFrame>
      </frames></DOMLayer>
      <DOMLayer name="Sibling"><frames>
        <DOMFrame index="0" duration="8"><elements>
          <DOMSymbolInstance libraryItemName="Card" symbolType="graphic" centerPoint3DX="5" centerPoint3DY="5">
            <matrix><Matrix tx="5" ty="5"/></matrix>
          </DOMSymbolInstance>
        </elements></DOMFrame>
      </frames></DOMLayer>
    </layers></DOMTimeline></timeline></DOMSymbolItem>`;
    const doc = '<DOMDocument width="300" height="200" frameRate="24"/>';
    const adapted = adaptFlaXflDisplaySource(doc, [cardSymbol, { name: 'MotionHost.xml', xml: hostXml }]);
    if (!adapted.ok) throw new Error(adapted.message);
    const { source } = adapted;
    const hostSym = source.graphicSymbols.find((s) => s.libraryItemName === 'MotionHost')!;
    const sample = (frameIndex: number) => source.buildGraphicFrameContext(
      hostSym.timelineXml, hostSym.frameSpanIndex, frameIndex, 'graphic:MotionHost',
    );
    if (rejection) {
      expect(sample(2)).toMatchObject({ ok: false, message: expect.stringContaining(rejection) });
      const healthy = sample(6);
      expect(healthy.ok).toBe(true);
      if (!healthy.ok) throw new Error(healthy.message);
      expect(healthy.value.layers.find((layer) => layer.name === 'Sibling')?.elements).toHaveLength(1);
      expect(healthy.value.layers.find((layer) => layer.name === 'Mover')?.elements[0]?.localTransform)
        .toMatchObject({ tx: 150, ty: 80 });
      return;
    }
    for (const [frameIndex, expectedTx, expectedTy] of [[0, 10, 20], [1, 30, 30], [2, 50, 40], [3, 70, 50],
      [4, 90, 60], [5, 90, 60], [6, 150, 80], [7, 150, 80]] as const) {
      const ctx = sample(frameIndex);
      if (!ctx.ok) throw new Error(ctx.message);
      const resolved = resolveFlaDisplayList({
        root: { kind: 'graphic', name: 'MotionHost', frameContext: ctx.value },
        symbols: source.symbols,
      });
      if (!resolved.ok) throw new Error(resolved.message);
      expect(resolved.displayList.projectionDiagnostics).toBeUndefined();
      // Sibling layer is at index 0 (bottom), Mover layer is at index 1 (top)
      expect(resolved.displayList.layers[0]?.children).toHaveLength(1);
      const mover = resolved.displayList.layers[1]?.children[0];
      expect(mover?.kind).toBe('group');
      expect(mover?.worldTransform.tx).toBeCloseTo(expectedTx);
      expect(mover?.worldTransform.ty).toBeCloseTo(expectedTy);
      if (frameIndex === 2) {
        // Halfway through 90-degree clockwise rotation => 45 degrees
        expect(mover?.worldTransform.a).toBeCloseTo(Math.SQRT1_2);
        expect(mover?.worldTransform.b).toBeCloseTo(Math.SQRT1_2);
      }
      // Verify formal Graphic structure capture + evaluation round-trip preserves the moving node
      const captured = captureFlaGraphicStructure(resolved.displayList);
      const evalVisual = evaluateFlaGraphicVisual({
        definition: {
          id: 'def-motion-host',
          kind: 'fla-graphic',
          name: 'MotionHost',
          durationMs: 1_000 / 24,
          source: {
            basename: 'motion.fla',
            sha256: 'a'.repeat(64),
            renderTargetId: 'rt-motion',
            targetKind: 'graphic-symbol',
            targetName: 'MotionHost',
            sourceFps: 24,
            startFrameIndex: 0,
            endFrameIndex: 0,
            canvas: { width: 300, height: 200 },
            anchor: { x: 0, y: 0 },
            documentCanvas: { width: 300, height: 200 },
          },
          frames: [{
            ordinal: 0,
            sourceFrameIndex: frameIndex,
            assetId: 'asset-frame',
            sha256: 'b'.repeat(64),
            offset: { x: 0, y: 0 },
            sourceViewport: { x: 0, y: 0, width: 300, height: 200 },
            startMs: 0,
            durationMs: 1_000 / 24,
            createdBySequenceImport: false,
          }],
          structure: captured,
        },
        frameOrdinal: 0,
        mode: 'instance',
      });
      expect(evalVisual?.layers?.[1]?.nodes[0]?.worldTransform.tx).toBeCloseTo(expectedTx);
      expect(evalVisual?.layers?.[1]?.nodes[0]?.worldTransform.ty).toBeCloseTo(expectedTy);
    }

    // Verify end-to-end SVG render for the same Classic Motion FLA
    const zip = new JSZip();
    zip.file('DOMDocument.xml', doc);
    zip.file('LIBRARY/Card.xml', cardSymbol.xml);
    zip.file('LIBRARY/MotionHost.xml', hostXml);
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const prepared = await prepareFlaStaticSnapshotDisplaySource(bytes, 'preview');
    if (!prepared.ok) throw new Error(prepared.message);
    const target: FlaRenderTarget = {
      renderTargetId: 'rt-motion',
      kind: 'graphic-symbol',
      userLabel: 'MotionHost',
      sourceLibraryItemName: 'MotionHost',
      frameCount: 8,
      compatibility: [],
    };
    const midSvg = await buildSvgForRenderTarget(bytes, { ...target, selectedFrameIndex: 2 }, undefined, prepared.source);
    if (!midSvg.ok) throw new Error(midSvg.message);
    expect(midSvg.svg).toContain('#22aa44'); // motionTweenSync advances Card frame 0 -> frame 2
    expect(midSvg.projectionWarning).toBeUndefined();
  });

  it('evaluates dynamic 2.5D Object Motion curves and diagnoses unsupported 3D channels explicitly', () => {
    const validDoc = `<DOMDocument width="200" height="200" frameRate="24" viewAngle3D="90" vanishingPoint3DX="100" vanishingPoint3DY="100">
      <timelines><DOMTimeline name="Scene 1"><layers>
        <DOMLayer name="Spin3D"><frames>
          <DOMFrame index="0" duration="5" tweenType="motion object">
            <motionObjectXML><AnimationCore TimeScale="24000" duration="5000">
              <PropertyContainer id="Motion">
                <Property id="Motion_X"><Keyframe timevalue="0" anchor="0,0"/><Keyframe timevalue="4000" anchor="0,40"/></Property>
                <Property id="Rotation_Y"><Keyframe timevalue="0" anchor="0,0"/><Keyframe timevalue="4000" anchor="0,45"/></Property>
                <Property id="Motion_Z"><Keyframe timevalue="0" anchor="0,0"/><Keyframe timevalue="4000" anchor="0,100"/></Property>
              </PropertyContainer>
            </AnimationCore></motionObjectXML>
            <elements>
              <DOMSymbolInstance libraryItemName="Card" symbolType="graphic">
                <matrix><Matrix tx="100" ty="100"/></matrix>
                <transformationPoint><Point x="0" y="0"/></transformationPoint>
              </DOMSymbolInstance>
            </elements>
          </DOMFrame>
        </frames></DOMLayer>
        <DOMLayer name="Healthy2D"><frames>
          <DOMFrame index="0" duration="5"><elements>
            <DOMSymbolInstance libraryItemName="Card" symbolType="graphic" centerPoint3DX="20" centerPoint3DY="20">
              <matrix><Matrix tx="20" ty="20"/></matrix>
            </DOMSymbolInstance>
          </elements></DOMFrame>
        </frames></DOMLayer>
      </layers></DOMTimeline></timelines></DOMDocument>`;
    const adapted = adaptFlaXflDisplaySource(validDoc, [cardSymbol]);
    if (!adapted.ok) throw new Error(adapted.message);
    const scene = adapted.source.sceneTimelines[0]!;
    const sceneCtx = adapted.source.buildSceneFrameContext(scene.xml, 4, `scene:${scene.index}`);
    if (!sceneCtx.ok) throw new Error(sceneCtx.message);
    const resolved = resolveFlaDisplayList({
      root: { kind: 'scene', name: 'Scene 1', frameContext: sceneCtx.value },
      symbols: adapted.source.symbols,
    });
    if (!resolved.ok) throw new Error(resolved.message);
    const spinLayer = resolved.displayList.layers.find((layer) => layer.name === 'Spin3D');
    const spinNode = spinLayer?.children[0];
    expect(spinNode?.kind).toBe('group');
    // At frame 4: focalLength=100, depth=100 => distance=200, ratio=0.5, rotationY=45 => cos=sin=SQRT1_2
    // tx shifted to 140 => vx=40, stageX = 100 + 40 * 0.5 = 120
    // Jacobian a = ratio * (cos(45) - vx * (-sin(45)) / distance) = 0.5 * (1 + 40/200) * SQRT1_2 = 0.6 * SQRT1_2
    expect(spinNode?.worldTransform.a).toBeCloseTo(0.6 * Math.SQRT1_2, 5);
    expect(spinNode?.worldTransform.tx).toBeCloseTo(120, 3);
    expect(spinNode?.worldTransform.ty).toBeCloseTo(100, 3);
    const healthyLayer = resolved.displayList.layers.find((layer) => layer.name === 'Healthy2D');
    expect(healthyLayer?.children[0]?.worldTransform.tx).toBeCloseTo(20);

    // Unsupported dynamic 3D channel (Skew_Z) reports explicit diagnostic instead of silent ignore.
    const unsupportedDoc = `<DOMDocument width="200" height="200" frameRate="24">
      <timelines><DOMTimeline name="Scene 1"><layers>
        <DOMLayer name="Unsupported3D"><frames>
          <DOMFrame index="0" duration="5" tweenType="motion object">
            <motionObjectXML><AnimationCore TimeScale="24000" duration="5000">
              <PropertyContainer id="Motion">
                <Property id="Skew_Z"><Keyframe timevalue="0" anchor="0,0"/><Keyframe timevalue="4000" anchor="0,30"/></Property>
              </PropertyContainer>
            </AnimationCore></motionObjectXML>
            <elements>
              <DOMSymbolInstance libraryItemName="Card" symbolType="graphic">
                <matrix><Matrix tx="20" ty="20"/></matrix>
                <transformationPoint><Point x="0" y="0"/></transformationPoint>
              </DOMSymbolInstance>
            </elements>
          </DOMFrame>
        </frames></DOMLayer>
      </layers></DOMTimeline></timelines></DOMDocument>`;
    const badAdapted = adaptFlaXflDisplaySource(unsupportedDoc, [cardSymbol]);
    if (!badAdapted.ok) throw new Error(badAdapted.message);
    const badScene = badAdapted.source.sceneTimelines[0]!;
    const badCtx = badAdapted.source.buildSceneFrameContext(badScene.xml, 2, `scene:${badScene.index}`);
    if (!badCtx.ok) throw new Error(badCtx.message);
    expect(badCtx.value.unsupportedDisplayReason).toContain('Skew_Z');
  });

  it('clears stale initial 2.5D projection when dynamic Rotation_X/Y and Motion_Z return to zero (E-F08)', () => {
    const resetDoc = `<DOMDocument width="200" height="200" frameRate="24" viewAngle3D="90" vanishingPoint3DX="100" vanishingPoint3DY="100">
      <timelines><DOMTimeline name="Scene 1"><layers>
        <DOMLayer name="Reset3D"><frames>
          <DOMFrame index="0" duration="5" tweenType="motion object">
            <motionObjectXML><AnimationCore TimeScale="24000" duration="5000">
              <PropertyContainer id="Motion">
                <Property id="Motion_X">
                  <Keyframe timevalue="0" anchor="0,0"/>
                  <Keyframe timevalue="2000" anchor="0,20"/>
                  <Keyframe timevalue="4000" anchor="0,40"/>
                </Property>
                <Property id="Rotation_X">
                  <Keyframe timevalue="0" anchor="0,30"/>
                  <Keyframe timevalue="2000" anchor="0,0"/>
                  <Keyframe timevalue="4000" anchor="0,30"/>
                </Property>
                <Property id="Motion_Z">
                  <Keyframe timevalue="0" anchor="0,0"/>
                  <Keyframe timevalue="2000" anchor="0,-100"/>
                  <Keyframe timevalue="4000" anchor="0,0"/>
                </Property>
              </PropertyContainer>
            </AnimationCore></motionObjectXML>
            <elements>
              <DOMSymbolInstance libraryItemName="Card" symbolType="graphic" rotationX="30" centerPoint3DZ="100">
                <matrix><Matrix tx="100" ty="100"/></matrix>
                <transformationPoint><Point x="0" y="0"/></transformationPoint>
              </DOMSymbolInstance>
            </elements>
          </DOMFrame>
        </frames></DOMLayer>
      </layers></DOMTimeline></timelines></DOMDocument>`;
    const adapted = adaptFlaXflDisplaySource(resetDoc, [cardSymbol]);
    if (!adapted.ok) throw new Error(adapted.message);
    const scene = adapted.source.sceneTimelines[0]!;

    const sampleNode = (frameIndex: number) => {
      const ctx = adapted.source.buildSceneFrameContext(scene.xml, frameIndex, `scene:${scene.index}`);
      if (!ctx.ok) throw new Error(ctx.message);
      const resolved = resolveFlaDisplayList({
        root: { kind: 'scene', name: 'Scene 1', frameContext: ctx.value },
        symbols: adapted.source.symbols,
      });
      if (!resolved.ok) throw new Error(resolved.message);
      return { ctx: ctx.value, node: resolved.displayList.layers[0]!.children[0]! };
    };

    // Frame 0: initial non-zero 2.5D projection (depth=100, rotationX=30 => focalLength=100, ratio=0.5, d=0.5*cos(30))
    const f0 = sampleNode(0);
    expect(f0.node.worldTransform.a).toBeCloseTo(0.5, 5);
    expect(f0.node.worldTransform.d).toBeCloseTo(0.5 * Math.cos(Math.PI / 6), 5);
    expect(f0.node.worldTransform.tx).toBeCloseTo(100, 3);

    // Frame 1: midpoint (depth=50 => ratio=100/150, rotationX=15)
    const f1 = sampleNode(1);
    expect(f1.node.worldTransform.a).toBeCloseTo(100 / 150, 5);
    expect(f1.node.worldTransform.d).toBeCloseTo((100 / 150) * Math.cos(Math.PI / 12), 5);

    // Frame 2: dynamic Rotation_X=0 and Motion_Z=-100 (depth=100-100=0) => stale projection MUST be cleared!
    const f2 = sampleNode(2);
    expect(f2.ctx.layers[0]!.elements[0]!.kind).toBe('symbol');
    if (f2.ctx.layers[0]!.elements[0]!.kind === 'symbol') {
      expect(f2.ctx.layers[0]!.elements[0]!.projection3D).toBeUndefined();
    }
    expect(f2.node.worldTransform.a).toBeCloseTo(1, 5);
    expect(f2.node.worldTransform.b).toBeCloseTo(0, 5);
    expect(f2.node.worldTransform.c).toBeCloseTo(0, 5);
    expect(f2.node.worldTransform.d).toBeCloseTo(1, 5);
    expect(f2.node.worldTransform.tx).toBeCloseTo(120, 3);
    expect(f2.node.worldTransform.ty).toBeCloseTo(100, 3);

    // Frame 4: returns to non-zero 2.5D projection (depth=100, rotationX=30, tx=140 => stageX = 100 + 40*0.5 = 120)
    const f4 = sampleNode(4);
    expect(f4.node.worldTransform.a).toBeCloseTo(0.5, 5);
    expect(f4.node.worldTransform.d).toBeCloseTo(0.5 * Math.cos(Math.PI / 6), 5);
    expect(f4.node.worldTransform.tx).toBeCloseTo(120, 3);
  });
});
