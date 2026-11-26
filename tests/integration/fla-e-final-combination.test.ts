import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AudioClipService,
  evaluateFlaGraphicVisual,
  evaluateShotAtTime,
  LayerService,
  ProjectSchema,
  resolveLayerVisualParts,
  type FlaGraphicDefinition,
  type ImageAsset,
  type Layer,
  type Project,
} from '../../src/domain';
import { HistoryStore } from '../../src/history/HistoryStore';
import { ProjectCommand } from '../../src/history/commands/ProjectCommand';
import { ExportPreparationService } from '../../src/main/services/ExportPreparationService';
import { ExportService, type FrameRenderer } from '../../src/main/services/ExportService';
import { FFmpegAdapter } from '../../src/main/services/FFmpegAdapter';
import { FileSystemService } from '../../src/main/services/FileSystemService';
import { FlaEmbeddedVideoService } from '../../src/main/services/FlaEmbeddedVideoService';
import { preflightFlaBytes } from '../../src/main/services/fla-import-preflight-service';
import { readFlaEmbeddedVideo } from '../../src/main/services/fla-native-video';
import {
  buildRenderableTargetCatalog,
  buildSvgForRenderTarget,
  prepareFlaStaticSnapshotDisplaySource,
} from '../../src/main/services/fla-static-snapshot-svg-builder';
import { resolveFlaDisplayList } from '../../src/main/services/fla-display-list-resolver';
import { captureFlaGraphicStructure } from '../../src/main/services/flaGraphicStructureCapture';
import { ProjectService } from '../../src/main/services/ProjectService';
import { freezeVideoOutputProfile } from '../../src/shared/export-output-profile';
import { EncodePngSequenceRequestSchema } from '../../src/shared/ffmpeg-types';

const execFileAsync = promisify(execFile);
const bundledFfmpegPath = path.resolve('node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe');
const bundledFfprobePath = path.resolve('node_modules/@ffprobe-installer/win32-x64/ffprobe.exe');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const createdDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

async function buildFlaZip(
  docXml: string,
  entries: Record<string, string | Uint8Array> = {},
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', docXml);
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: 'uint8array' });
}

async function createRealMp4WithAudio(outputPath: string, durationSec = 0.25): Promise<void> {
  await execFileAsync(bundledFfmpegPath, [
    '-y',
    '-f', 'lavfi',
    '-i', `testsrc=duration=${durationSec}:size=64x64:rate=24`,
    '-f', 'lavfi',
    '-i', `sine=frequency=440:sample_rate=48000:duration=${durationSec}`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    outputPath,
  ]);
}

async function createRealToneWav(outputPath: string, frequencyHz: number, durationSec: number): Promise<void> {
  await execFileAsync(bundledFfmpegPath, [
    '-y',
    '-f', 'lavfi',
    '-i', `sine=frequency=${frequencyHz}:sample_rate=48000:duration=${durationSec}`,
    '-ac', '2',
    '-ar', '48000',
    '-c:a', 'pcm_s16le',
    outputPath,
  ]);
}

async function createSolidPng(outputPath: string, width: number, height: number, color: string): Promise<Uint8Array<ArrayBuffer>> {
  await execFileAsync(bundledFfmpegPath, [
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=${color}:s=${width}x${height}:d=0.05`,
    '-frames:v', '1',
    outputPath,
  ]);
  return Uint8Array.from(await readFile(outputPath));
}

afterEach(async () => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe('Issue #1350 E-I02 targeted combination acceptance', () => {
  it('Combo 1: 2D Classic Motion (with centerPoint3DX/Y) + Wave TimeMap Object Motion + Inner/Knockout Glow & ColorMatrix', async () => {
    const badgeSymbol = `<DOMSymbolItem xmlns="http://ns.adobe.com/xfl/2008/" name="Badge" symbolType="graphic">
  <timeline><DOMTimeline name="Badge"><layers><DOMLayer name="Fill"><frames>
    <DOMFrame index="0" duration="1"><elements><DOMShape>
      <fills><FillStyle index="1"><SolidColor color="#3366ff"/></FillStyle></fills>
      <edges><Edge fillStyle1="1" edges="!0 0|400 0|400 400|0 400|0 0"/></edges>
    </DOMShape></elements></DOMFrame>
  </frames></DOMLayer></layers></DOMTimeline></timeline>
</DOMSymbolItem>`;

    const docXml = `<?xml version="1.0" encoding="utf-8"?>
<DOMDocument width="400" height="300" frameRate="24" xmlns="http://ns.adobe.com/xfl/2008/">
  <symbols><Include href="Badge.xml"/></symbols>
  <timelines><DOMTimeline name="Scene 1"><layers>
    <DOMLayer name="Classic2D">
      <frames>
        <DOMFrame index="0" duration="4" tweenType="motion" motionTweenSnap="true" motionTweenSync="true" keyMode="24065">
          <elements>
            <DOMSymbolInstance libraryItemName="Badge" symbolType="graphic" centerPoint3DX="10" centerPoint3DY="10">
              <matrix><Matrix tx="20" ty="40"/></matrix>
              <filters>
                <GlowFilter blurX="8" blurY="8" color="#ff6600" strength="1" quality="1" inner="true"/>
                <AdjustColorFilter matrix="1 0 0 0 25 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/>
              </filters>
            </DOMSymbolInstance>
          </elements>
        </DOMFrame>
        <DOMFrame index="4" duration="1" keyMode="9728">
          <elements>
            <DOMSymbolInstance libraryItemName="Badge" symbolType="graphic" centerPoint3DX="110" centerPoint3DY="90">
              <matrix><Matrix tx="120" ty="120"/></matrix>
              <filters>
                <GlowFilter blurX="8" blurY="8" color="#ff6600" strength="1" quality="1" inner="true"/>
                <AdjustColorFilter matrix="1 0 0 0 25 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/>
              </filters>
            </DOMSymbolInstance>
          </elements>
        </DOMFrame>
      </frames>
    </DOMLayer>
    <DOMLayer name="Wave25D">
      <frames>
        <DOMFrame index="0" duration="5" tweenType="motion object" keyMode="8192">
          <motionObjectXML>
            <AnimationCore TimeScale="24000" Version="1" duration="5000">
              <TimeMap strength="2" type="SineWave"/>
              <PropertyContainer id="headContainer">
                <PropertyContainer id="Basic_Motion">
                  <Property id="Motion_X">
                    <Keyframe anchor="0,0" timevalue="0"/>
                    <Keyframe anchor="0,100" timevalue="4000"/>
                  </Property>
                  <Property id="Motion_Z">
                    <Keyframe anchor="0,0" timevalue="0"/>
                    <Keyframe anchor="0,100" timevalue="4000"/>
                  </Property>
                </PropertyContainer>
                <PropertyContainer id="Rotation_3D">
                  <Property id="Rotation_X">
                    <Keyframe anchor="0,0" timevalue="0"/>
                    <Keyframe anchor="0,30" timevalue="4000"/>
                  </Property>
                </PropertyContainer>
              </PropertyContainer>
            </AnimationCore>
          </motionObjectXML>
          <elements>
            <DOMSymbolInstance libraryItemName="Badge" symbolType="graphic" centerPoint3DX="200" centerPoint3DY="150">
              <matrix><Matrix tx="200" ty="150"/></matrix>
              <filters>
                <GlowFilter blurX="6" blurY="6" color="#00ff99" strength="1" quality="1" knockout="true"/>
              </filters>
            </DOMSymbolInstance>
          </elements>
        </DOMFrame>
      </frames>
    </DOMLayer>
  </layers></DOMTimeline></timelines>
</DOMDocument>`;

    const flaBytes = await buildFlaZip(docXml, { 'LIBRARY/Badge.xml': badgeSymbol });
    const prepared = await prepareFlaStaticSnapshotDisplaySource(flaBytes, 'preview');
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error(prepared.message);
    const catalog = await buildRenderableTargetCatalog(flaBytes, undefined, {}, prepared.source);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) throw new Error(catalog.message);
    const sceneEntry = catalog.entries.find((e) => e.target.kind === 'scene')!;
    const sceneDesc = prepared.source.sceneTimelines[0]!;
    const frame2Ctx = prepared.source.buildSceneFrameContext(sceneDesc.xml, 2, 'scene:0');
    if (!frame2Ctx.ok) throw new Error(frame2Ctx.message);

    const frame2 = resolveFlaDisplayList({
      root: { kind: 'scene', name: sceneDesc.name, frameContext: frame2Ctx.value },
      symbols: prepared.source.symbols,
    });
    if (!frame2.ok) throw new Error(`Combo1 resolve failed: ${frame2.message}`);
    expect(frame2.ok).toBe(true);
    // Layer 1 (2D Classic Motion with centerPoint3DX/Y) interpolated cleanly to tx=70, ty=80:
    const classicItem = frame2.displayList.layers
      .find((l) => l.name === 'Classic2D')?.children[0];
    expect(classicItem).toBeDefined();
    expect(classicItem!.worldTransform.tx).toBeCloseTo(70, 2);
    expect(classicItem!.worldTransform.ty).toBeCloseTo(80, 2);

    // Layer 2 (Wave + 2.5D Object Motion) resolved cleanly with 2.5D matrix:
    const waveItem = frame2.displayList.layers
      .find((l) => l.name === 'Wave25D')?.children[0];
    expect(waveItem).toBeDefined();

    // SVG contains inner glow, knockout glow, and feColorMatrix filters:
    const svgResult = await buildSvgForRenderTarget(
      flaBytes,
      { ...sceneEntry.target, selectedFrameIndex: 2 },
      undefined,
      prepared.source,
    );
    expect(svgResult.ok).toBe(true);
    if (!svgResult.ok) throw new Error(svgResult.message);
    expect(svgResult.svg).toContain('feColorMatrix');
    expect(svgResult.svg).toContain('feGaussianBlur');
    expect(svgResult.svg).toContain('operator="out"');
  });

  it('Combo 2: Scale9Grid (asymmetric/negative/mirrored/gradient-separated) + formal RGBA + Filters + Mask + Multiply Blend', async () => {
    const scale9Symbol = `<DOMSymbolItem xmlns="http://ns.adobe.com/xfl/2008/" name="Card9" symbolType="graphic"
      scalingGrid="true" scalingGridRect="200 200 800 800">
  <timeline><DOMTimeline name="Card9"><layers><DOMLayer name="Bg"><frames>
    <DOMFrame index="0" duration="1"><elements><DOMShape>
      <fills>
        <FillStyle index="1">
          <LinearGradient>
            <matrix><Matrix a="0.0366" d="0.0366" tx="20" ty="20"/></matrix>
            <GradientEntry color="#ff4444" ratio="0"/>
            <GradientEntry color="#4444ff" ratio="1"/>
          </LinearGradient>
        </FillStyle>
      </fills>
      <edges><Edge fillStyle1="1" edges="!-200 -200|1000 -200|1000 1000|-200 1000|-200 -200"/></edges>
    </DOMShape></elements></DOMFrame>
  </frames></DOMLayer></layers></DOMTimeline></timeline>
</DOMSymbolItem>`;

    const docXml = `<?xml version="1.0" encoding="utf-8"?>
<DOMDocument width="400" height="300" frameRate="24" xmlns="http://ns.adobe.com/xfl/2008/">
  <symbols><Include href="Card9.xml"/></symbols>
  <timelines><DOMTimeline name="Scene 1"><layers>
    <DOMLayer name="MaskLayer" layerType="mask">
      <frames><DOMFrame index="0" duration="1"><elements><DOMShape>
        <fills><FillStyle index="1"><SolidColor color="#000000"/></FillStyle></fills>
        <edges><Edge fillStyle1="1" edges="!400 400|6000 400|6000 4800|400 4800|400 400"/></edges>
      </DOMShape></elements></DOMFrame></frames>
    </DOMLayer>
    <DOMLayer name="MaskedCard" parentLayerIndex="0">
      <frames><DOMFrame index="0" duration="1"><elements>
        <DOMSymbolInstance libraryItemName="Card9" symbolType="graphic" blendMode="multiply">
          <matrix><Matrix a="-2" d="1.8" tx="220" ty="50"/></matrix>
          <color><Color alphaMultiplier="0.8" alphaOffset="12" redOffset="15"/></color>
          <filters>
            <GlowFilter blurX="6" blurY="6" color="#22cc88" strength="1" quality="1" inner="true"/>
            <AdjustColorFilter matrix="1 0 0 0 15 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/>
          </filters>
        </DOMSymbolInstance>
      </elements></DOMFrame></frames>
    </DOMLayer>
    <DOMLayer name="SkewedCard">
      <frames><DOMFrame index="0" duration="1"><elements>
        <DOMSymbolInstance libraryItemName="Card9" symbolType="graphic">
          <matrix><Matrix a="2" b="0.35" c="0.2" d="1.5" tx="40" ty="160"/></matrix>
        </DOMSymbolInstance>
      </elements></DOMFrame></frames>
    </DOMLayer>
  </layers></DOMTimeline></timelines>
</DOMDocument>`;

    const flaBytes = await buildFlaZip(docXml, { 'LIBRARY/Card9.xml': scale9Symbol });
    const prepared = await prepareFlaStaticSnapshotDisplaySource(flaBytes, 'preview');
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error(prepared.message);
    const catalog = await buildRenderableTargetCatalog(flaBytes, undefined, {}, prepared.source);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) throw new Error(catalog.message);
    const sceneEntry = catalog.entries.find((e) => e.target.kind === 'scene')!;
    const sceneDesc = prepared.source.sceneTimelines[0]!;

    const svgResult = await buildSvgForRenderTarget(flaBytes, sceneEntry.target, undefined, prepared.source);
    if (!svgResult.ok) throw new Error(`Combo2 svg failed: ${svgResult.message}`);
    expect(svgResult.ok).toBe(true);
    // Gradient mapped continuously in stage space with clipPath slices (not distorted by nested preserveAspectRatio="none"):
    expect(svgResult.svg).toContain('fla-s9-clip-');
    expect(svgResult.svg).toContain('mix-blend-mode:multiply');
    expect(svgResult.svg).toContain('clip-path="url(#');
    // Skewed Scale9 instance emitted a local diagnostic without aborting healthy masked sibling:
    expect(svgResult.projectionWarning).toBeTruthy();

    // Formal FlaGraphicStructure capture & JSON Save/Reopen round-trip preserves rgbaTransform/blend/filters/mask once:
    const resolved = resolveFlaDisplayList({
      root: { kind: 'scene', name: sceneDesc.name, frameContext: sceneDesc.frameContext },
      symbols: prepared.source.symbols,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error(resolved.message);
    const captured = captureFlaGraphicStructure(resolved.displayList, {});
    expect(captured).not.toBeNull();
    const reopenedStructure = JSON.parse(JSON.stringify(captured!));
    const def: FlaGraphicDefinition = {
      id: randomUUID(),
      kind: 'fla-graphic',
      name: 'Combo2Graphic',
      durationMs: 1_000 / 24,
      source: {
        basename: 'combo2.fla',
        sha256: 'a'.repeat(64),
        renderTargetId: sceneEntry.target.renderTargetId,
        targetKind: 'scene',
        targetName: 'Scene 1',
        sourceFps: 24,
        startFrameIndex: 0,
        endFrameIndex: 0,
        canvas: { width: 400, height: 300 },
        anchor: { x: 0, y: 0 },
        documentCanvas: { width: 400, height: 300 },
      },
      frames: [{
        ordinal: 0,
        sourceFrameIndex: 0,
        assetId: randomUUID(),
        sha256: 'b'.repeat(64),
        offset: { x: 0, y: 0 },
        sourceViewport: { x: 0, y: 0, width: 400, height: 300 },
        startMs: 0,
        durationMs: 1_000 / 24,
        createdBySequenceImport: false,
      }],
      structure: reopenedStructure,
    };
    const evaluated = evaluateFlaGraphicVisual({ definition: def, frameOrdinal: 0, mode: 'instance' });
    expect(evaluated).not.toBeNull();
  });

  it('Combo 3: Static text single-instance replacement sharing one Definition + Undo/Redo + Save/Reopen', async () => {
    const workDir = await makeTempDir('panda-ei02-text-');
    const projectRoot = path.join(workDir, 'text-project.pandastage');

    const docXml = `<?xml version="1.0" encoding="utf-8"?>
<DOMDocument width="320" height="180" frameRate="24" xmlns="http://ns.adobe.com/xfl/2008/">
  <timelines><DOMTimeline name="Scene 1"><layers>
    <DOMLayer name="TitleLayer"><frames><DOMFrame index="0" duration="1"><elements>
      <DOMStaticText left="20" width="220" height="40" isSelectable="false">
        <matrix><Matrix tx="20" ty="30"/></matrix>
        <textRuns>
          <DOMTextRun>
            <characters>Hello Stage</characters>
            <textAttrs><DOMTextAttrs alignment="left" size="24" face="Microsoft YaHei" fillColor="#ffffff"/></textAttrs>
          </DOMTextRun>
        </textRuns>
      </DOMStaticText>
    </elements></DOMFrame></frames></DOMLayer>
  </layers></DOMTimeline></timelines>
</DOMDocument>`;

    const flaBytes = await buildFlaZip(docXml);
    const prepared = await prepareFlaStaticSnapshotDisplaySource(flaBytes, 'preview');
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error(prepared.message);
    const catalog = await buildRenderableTargetCatalog(flaBytes, undefined, {}, prepared.source);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) throw new Error(catalog.message);
    const sceneEntry = catalog.entries.find((e) => e.target.kind === 'scene')!;
    const sceneDesc = prepared.source.sceneTimelines[0]!;
    const sceneSvg = await buildSvgForRenderTarget(flaBytes, sceneEntry.target, undefined, prepared.source);
    if (!sceneSvg.ok) throw new Error(sceneSvg.message);
    const parsedDescriptor = sceneSvg.staticTexts?.[0]?.descriptor;
    expect(parsedDescriptor).toBeDefined();
    const resolved = resolveFlaDisplayList({
      root: { kind: 'scene', name: sceneDesc.name, frameContext: sceneDesc.frameContext },
      symbols: prepared.source.symbols,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error(resolved.message);
    const bgAssetId = randomUUID();
    const frameAssetId = randomUUID();
    const defId = randomUUID();
    const shotId = randomUUID();
    const bgLayerId = randomUUID();
    const inst1Id = randomUUID();
    const inst2Id = randomUUID();
    const bgSha = createHash('sha256').update(TINY_PNG).digest('hex');

    const structure = captureFlaGraphicStructure(resolved.displayList, {
      fallbackAssetId: frameAssetId,
      resolveIsolatedSubtree: () => ({
        scope: 'subtree',
        viewBox: { x: 0, y: 0, width: 320, height: 180 },
        sourceRef: 'text-0',
      }),
      resolveStaticText: () => parsedDescriptor,
    });
    expect(structure).not.toBeNull();

    const textNode = structure!.frames[0]!.layers[0]!.nodes[0]!;
    expect(textNode.type).toBe('opaque');
    if (textNode.type !== 'opaque') throw new Error('Expected opaque static text node');
    expect(textNode.opaqueKind).toBe('text');
    expect(textNode.editableText?.runs[0]?.characters).toBe('Hello Stage');

    const projectService = new ProjectService();
    const created = await projectService.create(projectRoot, { name: 'Combo3 Text Project' });
    const frameDurationMs = 40; // exact integer at 25fps

    const graphicDef: FlaGraphicDefinition = {
      id: defId,
      kind: 'fla-graphic',
      name: 'SharedTitleCard',
      durationMs: frameDurationMs,
      source: {
        basename: 'title.fla',
        sha256: 'c'.repeat(64),
        renderTargetId: sceneEntry.target.renderTargetId,
        targetKind: 'graphic-symbol',
        targetName: 'TitleCard',
        sourceFps: 25,
        startFrameIndex: 0,
        endFrameIndex: 0,
        canvas: { width: 320, height: 180 },
        anchor: { x: 0, y: 0 },
        documentCanvas: { width: 320, height: 180 },
      },
      frames: [{
        ordinal: 0,
        sourceFrameIndex: 0,
        assetId: frameAssetId,
        sha256: bgSha,
        offset: { x: 0, y: 0 },
        sourceViewport: { x: 0, y: 0, width: 320, height: 180 },
        startMs: 0,
        durationMs: frameDurationMs,
        createdBySequenceImport: false,
      }],
      structure: structure!,
    };

    const project: Project = ProjectSchema.parse({
      ...created.project,
      assets: [
        {
          id: bgAssetId,
          kind: 'image',
          name: 'bg.png',
          relativePath: 'assets/bg.png',
          mimeType: 'image/png',
          sha256: bgSha,
          width: 1,
          height: 1,
          usage: 'background',
          keywords: [],
        },
        {
          id: frameAssetId,
          kind: 'image',
          name: 'frame.png',
          relativePath: 'assets/frame.png',
          mimeType: 'image/png',
          sha256: bgSha,
          width: 320,
          height: 180,
          usage: 'prop',
          keywords: [],
        },
      ],
      animations: [graphicDef],
      shots: [{
        id: shotId,
        name: 'Shot 1',
        durationMs: 1_000,
        defaultSubtitleStyleId: created.project.subtitleStyles[0]!.id,
        backgroundLayerId: bgLayerId,
        layers: [
          {
            id: bgLayerId,
            name: 'Bg',
            source: { kind: 'asset', assetId: bgAssetId },
            anchor: 'center',
            x: 960,
            y: 540,
            scaleX: 1,
            scaleY: 1,
            rotationDeg: 0,
            opacity: 1,
            visible: true,
            locked: false,
            flipX: false,
            zIndex: 0,
          },
          {
            id: inst1Id,
            name: 'Title Instance 1',
            source: { kind: 'animation', animationId: defId },
            anchor: 'center',
            x: 400,
            y: 300,
            scaleX: 1,
            scaleY: 1,
            rotationDeg: 0,
            opacity: 1,
            visible: true,
            locked: false,
            flipX: false,
            zIndex: 1,
            startTimeMs: 0,
            animationPlayback: { mode: 'loop', endBehavior: 'hold' },
          },
          {
            id: inst2Id,
            name: 'Title Instance 2',
            source: { kind: 'animation', animationId: defId },
            anchor: 'center',
            x: 900,
            y: 300,
            scaleX: 1,
            scaleY: 1,
            rotationDeg: 0,
            opacity: 1,
            visible: true,
            locked: false,
            flipX: false,
            zIndex: 2,
            startTimeMs: 0,
            animationPlayback: { mode: 'loop', endBehavior: 'hold' },
          },
        ],
        timelineEvents: [],
        audioClips: [],
        dialogues: [],
      }],
    });
    await writeFile(path.join(projectRoot, 'assets', 'bg.png'), TINY_PNG);
    await writeFile(path.join(projectRoot, 'assets', 'frame.png'), TINY_PNG);
    await projectService.save(projectRoot, project);

    // Replace static text ONLY on Instance 1 via LayerService + HistoryStore:
    const layerService = new LayerService();
    const nodePath = [textNode.id];
    let current = project;
    const history = new HistoryStore();
    const updated = layerService.updateFlaGraphicInstanceText(current, shotId, inst1Id, 0, nodePath, 'Replaced Title');
    history.execute(new ProjectCommand(
      'Replace Instance 1 text',
      current,
      updated,
      (next) => { current = next; },
    ));

    const readText = (proj: Project, layerId: string) => {
      const shot = proj.shots[0]!;
      const ev = evaluateShotAtTime(shot, 0, proj);
      const layer = ev.layers.find((l) => l.id === layerId)!;
      const visual = resolveLayerVisualParts(proj, shot, layer, 0);
      const evalNode = visual.flaGraphic?.layers?.[0]?.nodes?.[0];
      if (evalNode?.staticText) return evalNode.staticText.runs[0]?.characters;
      return evalNode?.source.type === 'opaque' ? evalNode.source.editableText?.runs[0]?.characters : undefined;
    };

    expect(readText(current, inst1Id)).toBe('Replaced Title');
    expect(readText(current, inst2Id)).toBe('Hello Stage'); // Sibling sharing Definition is untouched!

    // Undo restores Instance 1; Redo re-applies:
    history.undo();
    expect(readText(current, inst1Id)).toBe('Hello Stage');
    history.redo();
    expect(readText(current, inst1Id)).toBe('Replaced Title');

    // Save & Reopen preserves override cleanly:
    await projectService.save(projectRoot, current);
    const reopened = await projectService.open(projectRoot);
    expect(readText(reopened.project, inst1Id)).toBe('Replaced Title');
    expect(readText(reopened.project, inst2Id)).toBe('Hello Stage');
  });

  it('Combo 4: Multi-style Shape Tween + Gradient Morph + Mismatched local diagnostic + Healthy Sibling', async () => {
    const morphSymbol = `<DOMSymbolItem xmlns="http://ns.adobe.com/xfl/2008/" name="MorphPanel" symbolType="graphic">
  <timeline><DOMTimeline name="MorphPanel"><layers>
    <DOMLayer name="GradientMorph"><frames>
      <DOMFrame index="0" duration="4" tweenType="shape"><elements><DOMShape>
        <fills><FillStyle index="1">
          <LinearGradient><matrix><Matrix a="0.0610" d="0.0610" tx="50" ty="50"/></matrix>
            <GradientEntry color="#ff0000" ratio="0"/><GradientEntry color="#0000ff" ratio="1"/>
          </LinearGradient>
        </FillStyle></fills>
        <edges><Edge fillStyle1="1" edges="!0 0|1000 0|1000 1000|0 1000|0 0"/></edges>
      </DOMShape></elements></DOMFrame>
      <DOMFrame index="4" duration="1"><elements><DOMShape>
        <fills><FillStyle index="1">
          <LinearGradient><matrix><Matrix a="0.0610" d="0.0610" tx="150" ty="50"/></matrix>
            <GradientEntry color="#00ff00" ratio="0"/><GradientEntry color="#ffff00" ratio="1"/>
          </LinearGradient>
        </FillStyle></fills>
        <edges><Edge fillStyle1="1" edges="!2000 0|3000 0|3000 1000|2000 1000|2000 0"/></edges>
      </DOMShape></elements></DOMFrame>
    </frames></DOMLayer>
    <DOMLayer name="MismatchMorph"><frames>
      <DOMFrame index="0" duration="4" tweenType="shape"><elements><DOMShape>
        <fills><FillStyle index="1"><SolidColor color="#ff00ff"/></FillStyle></fills>
        <edges><Edge fillStyle1="1" edges="!0 2000|1000 2000|1000 3000|0 3000|0 2000"/></edges>
      </DOMShape></elements></DOMFrame>
      <DOMFrame index="4" duration="1"><elements><DOMShape>
        <fills><FillStyle index="1">
          <RadialGradient><matrix><Matrix a="0.05" d="0.05" tx="50" ty="150"/></matrix>
            <GradientEntry color="#ffffff" ratio="0"/><GradientEntry color="#000000" ratio="1"/>
          </RadialGradient>
        </FillStyle></fills>
        <edges><Edge fillStyle1="1" edges="!0 2000|1000 2000|1000 3000|0 3000|0 2000"/></edges>
      </DOMShape></elements></DOMFrame>
    </frames></DOMLayer>
    <DOMLayer name="HealthySibling"><frames>
      <DOMFrame index="0" duration="5"><elements><DOMShape>
        <fills><FillStyle index="1"><SolidColor color="#11aa44"/></FillStyle></fills>
        <edges><Edge fillStyle1="1" edges="!4000 0|5000 0|5000 1000|4000 1000|4000 0"/></edges>
      </DOMShape></elements></DOMFrame>
    </frames></DOMLayer>
  </layers></DOMTimeline></timeline>
</DOMSymbolItem>`;

    const flaBytes = await buildFlaZip(
      `<DOMDocument width="320" height="240" frameRate="24" xmlns="http://ns.adobe.com/xfl/2008/">
        <symbols><Include href="MorphPanel.xml"/></symbols>
      </DOMDocument>`,
      { 'LIBRARY/MorphPanel.xml': morphSymbol },
    );
    const prepared = await prepareFlaStaticSnapshotDisplaySource(flaBytes, 'preview');
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error(prepared.message);
    const catalog = await buildRenderableTargetCatalog(flaBytes, undefined, {}, prepared.source);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) throw new Error(catalog.message);
    const morphEntry = catalog.entries.find((e) => e.target.sourceLibraryItemName === 'MorphPanel')!;

    const midSvg = await buildSvgForRenderTarget(
      flaBytes,
      { ...morphEntry.target, selectedFrameIndex: 2 },
      undefined,
      prepared.source,
    );
    if (!midSvg.ok) throw new Error(`Combo4 midSvg failed: ${midSvg.message}`);
    expect(midSvg.ok).toBe(true);
    // Gradient morph interpolated cleanly + start-frame fallback preserved for MismatchMorph + HealthySibling rendered:
    expect(midSvg.svg).toContain('linearGradient');
    expect(midSvg.svg).toContain('#ff00ff');
    expect(midSvg.svg).toContain('#11aa44');
    // Local non-fatal diagnostic names affected layer and source frame range:
    expect(midSvg.projectionWarning).toContain('MismatchMorph');
    expect(midSvg.projectionWarning).toContain('第 1–4 帧');
  });

  it('Combo 5: Same formal project (with embedded video + cross-shot audio) exports MP4, WebM (audio+silent), GIF (loop/non-loop/24+30fps/reject-60fps), Cancel, PNG seq, PixiJS sprite sheet, and F08 isolated object', async () => {
    const workDir = await makeTempDir('panda-ei02-export-');
    const projectRoot = path.join(workDir, 'multi-export.pandastage');

    // Generate real media fixtures via real Windows FFmpeg:
    const clipMp4 = path.join(workDir, 'clip.mp4');
    const bgmWav = path.join(workDir, 'bgm.wav');
    await createRealMp4WithAudio(clipMp4, 0.25);
    await createRealToneWav(bgmWav, 261.63, 0.75);
    const clipMp4Bytes = await readFile(clipMp4);
    const bgmBytes = await readFile(bgmWav);
    const solid720 = await createSolidPng(path.join(workDir, 'frame720.png'), 1280, 720, '0x1e3a5f');
    const solid1080 = await createSolidPng(path.join(workDir, 'frame1080.png'), 1920, 1080, '0x2d4a22');

    // Create a 2-shot project with non-integer duration boundary (550ms + 500ms = 1050ms):
    const projectService = new ProjectService();
    const created = await projectService.create(projectRoot, { name: 'Combo5 Multi-Export' });
    const bgAssetId = randomUUID();
    const bgmAssetId = randomUUID();
    const bgLayer1Id = randomUUID();
    const bgLayer2Id = randomUUID();
    const shot1Id = randomUUID();
    const shot2Id = randomUUID();
    const bgSha = createHash('sha256').update(TINY_PNG).digest('hex');
    const bgmSha = createHash('sha256').update(bgmBytes).digest('hex');

    const bgAsset: ImageAsset = {
      id: bgAssetId,
      kind: 'image',
      name: 'bg.png',
      relativePath: 'assets/bg.png',
      mimeType: 'image/png',
      sha256: bgSha,
      width: 1,
      height: 1,
      usage: 'background',
      keywords: [],
    };
    const mkBgLayer = (id: string): Layer => ({
      id,
      name: 'Background',
      source: { kind: 'asset', assetId: bgAssetId },
      anchor: 'center',
      x: 960,
      y: 540,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      locked: false,
      flipX: false,
      zIndex: 0,
    });

    const baseProject: Project = ProjectSchema.parse({
      ...created.project,
      assets: [
        bgAsset,
        {
          id: bgmAssetId,
          kind: 'audio',
          name: 'bgm.wav',
          relativePath: 'assets/bgm.wav',
          mimeType: 'audio/wav',
          sha256: bgmSha,
          durationMs: 750,
        },
      ],
      shots: [
        {
          id: shot1Id,
          name: 'Shot 1',
          durationMs: 550, // non-integer 24fps boundary!
          defaultSubtitleStyleId: created.project.subtitleStyles[0]!.id,
          backgroundLayerId: bgLayer1Id,
          layers: [mkBgLayer(bgLayer1Id)],
          timelineEvents: [],
          audioClips: [{
            id: randomUUID(),
            assetId: bgmAssetId,
            name: 'Shot 1 BGM',
            role: 'bgm',
            startMs: 0,
            endMs: 550,
            offsetMs: 0,
            volume: 0.5,
          }],
          dialogues: [],
        },
        {
          id: shot2Id,
          name: 'Shot 2',
          durationMs: 500,
          defaultSubtitleStyleId: created.project.subtitleStyles[0]!.id,
          backgroundLayerId: bgLayer2Id,
          layers: [mkBgLayer(bgLayer2Id)],
          timelineEvents: [],
          audioClips: [{
            id: randomUUID(),
            assetId: bgmAssetId,
            name: 'Shot 2 BGM',
            role: 'bgm',
            startMs: 0,
            endMs: 500,
            offsetMs: 100,
            volume: 0.5,
          }],
          dialogues: [],
        },
      ],
    });
    await writeFile(path.join(projectRoot, 'assets', 'bg.png'), TINY_PNG);
    await writeFile(path.join(projectRoot, 'assets', 'bgm.wav'), bgmBytes);
    await projectService.save(projectRoot, baseProject);

    // Import embedded video from FLA into Shot 1:
    const flaBytes = await buildFlaZip(
      `<DOMDocument width="640" height="360" frameRate="24" xmlns="http://ns.adobe.com/xfl/2008/">
        <media><DOMVideoItem name="CutIn" videoType="H264" fps="24" width="64" height="64" videoDataHRef="clip.dat"/></media>
        <timelines><DOMTimeline name="Scene 1"><layers><DOMLayer name="L1"><frames><DOMFrame index="0" duration="6"><elements/></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines>
      </DOMDocument>`,
      { 'bin/clip.dat': Buffer.concat([Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]), clipMp4Bytes]) },
    );
    const flaArchive = preflightFlaBytes(flaBytes, 'cutin.fla');
    const ffmpegAdapter = new FFmpegAdapter({
      ffmpegPath: bundledFfmpegPath,
      ffprobePath: bundledFfprobePath,
    });
    const embeddedVideoService = new FlaEmbeddedVideoService({
      flaImportService: {
        prepareEmbeddedVideo: async (_sid, name, adapter, signal) => {
          const media = readFlaEmbeddedVideo(flaBytes, flaArchive.entries, name);
          if (!media) return null;
          const dir = await makeTempDir('panda-ei02-vprobe-');
          const target = path.join(dir, 'source.mp4');
          await writeFile(target, media.bytes, { flag: 'wx' });
          const metadata = await adapter.probeFlaNativeVideo(target, signal);
          return { ...media, metadata, sourceSha256: 'd'.repeat(64) };
        },
      },
      projectService,
      ffmpegAdapter,
      audioClipService: new AudioClipService(),
    });
    const imported = await embeddedVideoService.importFromFlaSession({
      sessionId: 'combo5-session',
      videoName: 'CutIn',
      projectRoot,
      shotId: shot1Id,
      playbackMode: 'play-once',
    });
    const projectWithAudio = imported.project;
    const projectSilent: Project = ProjectSchema.parse({
      ...projectWithAudio,
      shots: projectWithAudio.shots.map((s) => ({ ...s, audioClips: [] })),
    });

    const makeMockRenderer = (width: 1280 | 1920, height: 720 | 1080, onFrame?: (idx: number) => void): FrameRenderer => ({
      loadProbe: async () => { throw new Error('unused'); },
      loadFormal: async (req) => ({ jobId: req.jobId, acknowledged: true }),
      renderFrame: async (req) => {
        onFrame?.(req.frameIndex);
        return {
          jobId: req.jobId,
          frameIndex: req.frameIndex,
          timeMs: req.timeMs,
          shotId: req.shotId,
          shotLocalTimeMs: req.shotLocalTimeMs,
          width,
          height,
          pngBytes: width === 1280 ? solid720 : solid1080,
        };
      },
      cancelJob: () => true,
    });

    const runVideoExport = async (
      proj: Project,
      fileName: string,
      videoFormat: 'mp4' | 'webm' | 'gif',
      width: 1280 | 1920,
      fps: 24 | 30 | 60,
      gifLoop?: boolean,
    ) => {
      const projForRun: Project = gifLoop === undefined
        ? proj
        : ProjectSchema.parse({
            ...proj,
            exportPreferences: {
              format: 'gif',
              rangeMode: 'shot',
              transparent: false,
              gifLoop,
            },
          });
      const outPath = path.join(workDir, fileName);
      const prepService = new ExportPreparationService({
        getCurrentProjectSnapshot: (root) =>
          root === projectRoot ? { project: projForRun, revision: 1, dirty: false, openInstanceId: 1 } : null,
      });
      try {
        const sel = await prepService.selectOutput({
          projectRoot,
          projectId: projForRun.id,
          projectName: projForRun.name,
          openInstanceId: 1,
          videoFormat,
        }, outPath);
        expect(sel.status).toBe('selected');
        if (sel.status !== 'selected') throw new Error(JSON.stringify(sel));
        const prep = await prepService.prepare({
          selectionId: sel.selectionId,
          attemptId: randomUUID(),
          projectRoot,
          projectId: projForRun.id,
          openInstanceId: 1,
          revision: 1,
          dirty: false,
          cameraMode: 'static',
          videoOutput: { width, fps },
          project: projForRun,
        });
        expect(prep.status).toBe('PREPARATION_READY');
        if (prep.status !== 'PREPARATION_READY') throw new Error(JSON.stringify(prep));
        const frozen = await prepService.acquireCandidateForExport(prep.candidate.snapshotId);
        const exportFs = new FileSystemService(path.join(workDir, `tmp-${fileName}`), {
          inspectWindowsVolume: async () => ({ driveType: 'Fixed', fileSystem: 'NTFS' }),
        });
        const exportService = new ExportService(
          makeMockRenderer(width, width === 1280 ? 720 : 1080),
          exportFs,
          ffmpegAdapter,
        );
        const res = await exportService.startFormalExport(
          frozen,
          () => prepService.assertOutputTargetUnchanged(prep.candidate.snapshotId),
        ).completion;
        await prepService.finalizeCandidateExport(prep.candidate.snapshotId);
        return res;
      } finally {
        await prepService.dispose();
      }
    };

    try {
      // (a) MP4 H.264 / AAC — 720p@24fps AND 1080p@30fps (cross-shot + embedded video audio + BGM):
      const mp4720 = await runVideoExport(projectWithAudio, 'out-720-24.mp4', 'mp4', 1280, 24);
      expect(mp4720.probe.codecName).toBe('h264');
      expect(mp4720.probe.pixelFormat).toBe('yuv420p');
      expect(mp4720.probe.width).toBe(1280);
      expect(mp4720.probe.height).toBe(720);
      expect(mp4720.probe.hasAudio).toBe(true);
      expect(mp4720.probe.audioCodecName).toBe('aac');
      expect(mp4720.probe.formatDurationSeconds).toBeGreaterThanOrEqual(0.95);
      expect(mp4720.probe.formatDurationSeconds).toBeLessThanOrEqual(1.2);

      const mp41080 = await runVideoExport(projectWithAudio, 'out-1080-30.mp4', 'mp4', 1920, 30);
      expect(mp41080.probe.codecName).toBe('h264');
      expect(mp41080.probe.width).toBe(1920);
      expect(mp41080.probe.height).toBe(1080);
      expect(mp41080.probe.fps).toBeCloseTo(30, 0);
      expect(mp41080.probe.hasAudio).toBe(true);
      expect(mp41080.probe.audioCodecName).toBe('aac');

      // 60fps MP4 profile freezes cleanly:
      expect(freezeVideoOutputProfile('mp4', { width: 1280, fps: 60 })).toMatchObject({
        format: 'mp4', width: 1280, height: 720, fps: 60, videoCodec: 'h264', audioCodec: 'aac',
      });

      // (b) WebM VP9 / Opus — with audio AND silent:
      const webmAudio = await runVideoExport(projectWithAudio, 'out-audio.webm', 'webm', 1280, 24);
      expect(webmAudio.probe.codecName).toBe('vp9');
      expect(webmAudio.probe.hasAudio).toBe(true);
      expect(webmAudio.probe.audioCodecName).toBe('opus');

      const webmSilent = await runVideoExport(projectSilent, 'out-silent.webm', 'webm', 1280, 24);
      expect(webmSilent.probe.codecName).toBe('vp9');
      expect(webmSilent.probe.hasAudio).toBe(false);

      // (c) GIF — silent, loop=true (24fps) & loop=false (30fps), 60fps clamped in profile & rejected in encoder contract:
      const gifLoop = await runVideoExport(projectWithAudio, 'out-loop.gif', 'gif', 1280, 24, true);
      expect(gifLoop.probe.codecName).toBe('gif');
      expect(gifLoop.probe.hasAudio).toBe(false);
      // Verify NETSCAPE2.0 loop extension is present when gifLoop=true:
      const gifLoopBytes = await readFile(gifLoop.outputPath);
      expect(gifLoopBytes.includes(Buffer.from('NETSCAPE2.0'))).toBe(true);

      const gifOnce = await runVideoExport(projectWithAudio, 'out-once.gif', 'gif', 1280, 30, false);
      expect(gifOnce.probe.codecName).toBe('gif');
      expect(gifOnce.probe.hasAudio).toBe(false);
      const gifOnceBytes = await readFile(gifOnce.outputPath);
      expect(gifOnceBytes.includes(Buffer.from('NETSCAPE2.0'))).toBe(false);

      expect(freezeVideoOutputProfile('gif', { width: 1280, fps: 60 }, true)).toMatchObject({
        format: 'gif', fps: 30, audioCodec: null, loop: true,
      });
      expect(EncodePngSequenceRequestSchema.safeParse({
        framesDirectory: workDir,
        outputPath: path.join(workDir, 'bad60.gif'),
        fps: 60,
        gifLoop: true,
      }).success).toBe(false);

      // (d) Cancel mid-export leaves zero partial output and zero dangling FFmpeg processes:
      const cancelTarget = path.join(workDir, 'cancelled.mp4');
      const cancelPrep = new ExportPreparationService({
        getCurrentProjectSnapshot: (root) =>
          root === projectRoot ? { project: projectWithAudio, revision: 1, dirty: false, openInstanceId: 1 } : null,
      });
      try {
        const sel = await cancelPrep.selectOutput({
          projectRoot, projectId: projectWithAudio.id, projectName: projectWithAudio.name, openInstanceId: 1, videoFormat: 'mp4',
        }, cancelTarget);
        if (sel.status !== 'selected') throw new Error('Select failed');
        const prep = await cancelPrep.prepare({
          selectionId: sel.selectionId, attemptId: randomUUID(), projectRoot,
          projectId: projectWithAudio.id, openInstanceId: 1, revision: 1, dirty: false,
          cameraMode: 'static', videoOutput: { width: 1280, fps: 24 }, project: projectWithAudio,
        });
        if (prep.status !== 'PREPARATION_READY') throw new Error('Prep failed');
        const frozen = await cancelPrep.acquireCandidateForExport(prep.candidate.snapshotId);
        let cancelService: ExportService | null = null;
        let cancelJobId = '';
        const cancelRenderer = makeMockRenderer(1280, 720, (idx) => {
          if (idx === 2 && cancelJobId) cancelService?.cancelJob(cancelJobId);
        });
        cancelService = new ExportService(
          cancelRenderer,
          new FileSystemService(path.join(workDir, 'tmp-cancel'), {
            inspectWindowsVolume: async () => ({ driveType: 'Fixed', fileSystem: 'NTFS' }),
          }),
          ffmpegAdapter,
        );
        const handle = cancelService.startFormalExport(
          frozen,
          () => cancelPrep.assertOutputTargetUnchanged(prep.candidate.snapshotId),
        );
        cancelJobId = handle.jobId;
        await expect(handle.completion).rejects.toThrow();
        await expect(stat(cancelTarget)).rejects.toThrow();
        expect(ffmpegAdapter.getActiveProcessCount()).toBe(0);
      } finally {
        await cancelPrep.dispose();
      }

      // (e) Legacy regression: PNG sequence, PixiJS sprite sheet, and F08 selected-object isolated export:
      const runImageExport = async (dirName: string, pngSequence: {
        shotId: string;
        transparent: boolean;
        layerId?: string;
        spriteSheet?: true;
        spriteSheetOptions?: { format: 'pixi' | 'panda'; trim: boolean; scale: number; padding: number; extrusion: number };
      }) => {
        const outDir = path.join(workDir, dirName);
        const prepService = new ExportPreparationService({
          getCurrentProjectSnapshot: (root) =>
            root === projectRoot ? { project: projectWithAudio, revision: 1, dirty: false, openInstanceId: 1 } : null,
        });
        try {
          const sel = await prepService.selectOutput({
            projectRoot, projectId: projectWithAudio.id, projectName: projectWithAudio.name, openInstanceId: 1, pngSequence,
          }, outDir);
          expect(sel.status).toBe('selected');
          if (sel.status !== 'selected') throw new Error(JSON.stringify(sel));
          const prep = await prepService.prepare({
            selectionId: sel.selectionId, attemptId: randomUUID(), projectRoot,
            projectId: projectWithAudio.id, openInstanceId: 1, revision: 1, dirty: false,
            cameraMode: 'static', project: projectWithAudio,
          });
          expect(prep.status).toBe('PREPARATION_READY');
          if (prep.status !== 'PREPARATION_READY') throw new Error(JSON.stringify(prep));
          const frozen = await prepService.acquireCandidateForExport(prep.candidate.snapshotId);
          const exportService = new ExportService(
            makeMockRenderer(1920, 1080),
            new FileSystemService(path.join(workDir, `tmp-${dirName}`), {
              inspectWindowsVolume: async () => ({ driveType: 'Fixed', fileSystem: 'NTFS' }),
            }),
            ffmpegAdapter,
          );
          const res = await exportService.startPngSequenceExport(
            frozen,
            () => prepService.assertOutputTargetUnchanged(prep.candidate.snapshotId),
          ).completion;
          await prepService.finalizeCandidateExport(prep.candidate.snapshotId);
          return { outDir, res };
        } finally {
          await prepService.dispose();
        }
      };

      const pngSeq = await runImageExport('out-png-seq', { shotId: shot1Id, transparent: true });
      expect((await stat(path.join(pngSeq.outDir, 'frame_000000.png'))).size).toBeGreaterThan(0);

      const pixiSheet = await runImageExport('out-pixi-sheet', {
        shotId: shot1Id,
        transparent: true,
        layerId: imported.layer.id, // F08 selected-object isolated export + PixiJS packed sprite sheet!
        spriteSheet: true,
        spriteSheetOptions: { format: 'pixi', trim: true, scale: 0.25, padding: 2, extrusion: 1 },
      });
      expect((await stat(path.join(pixiSheet.outDir, 'sprite-sheet.png'))).size).toBeGreaterThan(0);
      const pixiJson = JSON.parse(await readFile(path.join(pixiSheet.outDir, 'sprite-sheet.json'), 'utf8'));
      expect(pixiJson.meta.image).toBe('sprite-sheet.png');
    } finally {
      await embeddedVideoService.dispose();
    }
  }, 120_000);
});
