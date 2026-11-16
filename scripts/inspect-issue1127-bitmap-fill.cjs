/* Real-source diagnostic only: does not stand in for D's product/OWNER fallback UAT. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { classifyForFlaRecovery, normalizeRecoveryCandidate } = require('../src/main/services/fla-recovery-classifier.js');
const { prepareFlaStaticSnapshotDisplaySource, buildSvgForResolvedDisplayList } = require('../dist-electron/main/services/fla-static-snapshot-svg-builder.js');
const { prepareFlaNestedGraphicFrameSelections } = require('../dist-electron/main/services/fla-nested-graphic-frame-selector.js');
const { resolveFlaDisplayList } = require('../dist-electron/main/services/fla-display-list-resolver.js');
const { captureFlaGraphicStructure } = require('../dist-electron/main/services/flaGraphicStructureCapture.js');
const { CharacterMotionService, ProjectSchema } = require('../dist-electron/domain/index.js');
(async () => {
  const sourcePath=path.resolve(process.argv[2]);
  const outputPath=path.resolve(process.argv[3]);
  const original=await fs.readFile(sourcePath);
  const classification=classifyForFlaRecovery(original);
  const normalization=normalizeRecoveryCandidate(original,classification);
  const bytes=normalization.applied?normalization.bytes:original;
  const prepared=await prepareFlaStaticSnapshotDisplaySource(bytes,'preview');
  assert(prepared.ok,JSON.stringify(prepared));
  const source=prepared.source;
  let sample;
  function bitmapFill(nodes) {
    return nodes.some(n=>n.kind==='shape' ? /BitmapFill/i.test(source.shapeBlocks.get(n.shapeId)??'') : n.kind==='group' && bitmapFill(n.children));
  }
  for(const symbol of source.graphicSymbols) {
    const context=source.buildGraphicFrameContext(symbol.timelineXml,symbol.frameSpanIndex,0,'issue1127-D');
    if(!context.ok) continue;
    const selected=prepareFlaNestedGraphicFrameSelections(source,{kind:'graphic',name:symbol.sourceLibraryItemName,frameContext:context.value});
    if(!selected.ok) continue;
    const resolved=resolveFlaDisplayList(selected.resolverInput);
    if(!resolved.ok || !resolved.displayList.layers.some(l=>bitmapFill(l.children))) continue;
    const renderer=buildSvgForResolvedDisplayList({displayList:resolved.displayList,renderTargetId:'issue1127-D',stageWidth:source.stageWidth,stageHeight:source.stageHeight,shapeBlocks:source.shapeBlocks,resolveBitmapMedia:()=>({ok:false,reason:'missing'})});
    if(renderer.ok || !/FillStyle/.test(renderer.message)) continue;
    sample={symbol:symbol.sourceLibraryItemName,renderer,structure:captureFlaGraphicStructure(resolved.displayList)}; break;
  }
  assert(sample,'No bitmap-fill Graphic with the expected renderer refusal found.');
  const {createServer}=await import('vite'); const server=await createServer({server:{middlewareMode:true}});
  let fixture;
  try { const m=await server.ssrLoadModule('/tests/helpers/animationV0UatFixture.ts'); fixture=m.animationV0UatFixture(); }
  finally {await server.close();}
  const project=structuredClone(fixture.project);
  const definition=project.animations[0];
  definition.structure=sample.structure;
  // Keep only the source frame actually captured, and remove synthetic animation bases.
  definition.structure.frames[0].ordinal=0;
  project.shots[0].layers.forEach(l=>delete l.animationClip);
  const authored=new CharacterMotionService().apply(ProjectSchema.parse(project),{shotId:project.shots[0].id,layerId:fixture.layerId,partId:fixture.graphicPartId,timeMs:500,autoKey:true},{'transform.rotationDeg':90});
  const clip=authored.shots[0].layers.find(l=>l.id===fixture.layerId).animationClip;
  assert.equal(clip.tracks[0].keys.at(-1).value,90);
  const result={sourcePath,sha256:createHash('sha256').update(original).digest('hex'),normalized:normalization.applied,symbol:sample.symbol,renderer:sample.renderer,outerDataAuthoring:'PASS',outerProductEditing:'PENDING',localFallbackVisual:'NOT_VERIFIED',ownerUat:'PENDING',conclusion:'DEGRADED renderer; data-authoring independence verified. This diagnostic does not pass sample D product UAT.',clip};
  await fs.mkdir(path.dirname(outputPath),{recursive:true});await fs.writeFile(outputPath,JSON.stringify(result,null,2));
  console.log(JSON.stringify({outputPath,symbol:sample.symbol,renderer:sample.renderer,outerDataAuthoring:result.outerDataAuthoring,outerProductEditing:result.outerProductEditing}));
})().catch(error=>{console.error(error);process.exitCode=1;});
