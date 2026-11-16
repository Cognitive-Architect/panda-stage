/* Bounded production Electron persistence/Preview/MP4 evidence. OWNER UAT remains separate. */
const { app, BrowserWindow, nativeImage, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.join('D:/PandaStage-Acceptance/issue1127', new Date().toISOString().replaceAll(':', '-'));
app.setPath('userData', path.join(root, 'profile'));
process.env.PANDA_STAGE_ISSUE816_ACCEPTANCE = '1';
process.env.PANDA_STAGE_ISSUE762_PROFILE = '1';
let window, failed = false;
const errors = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const page = code => window.webContents.executeJavaScript(code, true);
async function wait(code, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await page(code)) return; await pause(100); }
  throw new Error(`Timed out: ${code}`);
}
async function click(selector) {
  await wait(`document.querySelector(${JSON.stringify(selector)})`);
  await page(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function screenshot(name) { await fs.writeFile(path.join(root, name + '.png'), (await window.webContents.capturePage()).toPNG()); }
async function actions() {
  await page(`(() => { const d=document.querySelector('[data-testid="quick-action-drawer"]'); if(d?.dataset.expanded!=='true') d?.querySelector('[data-testid="quick-action-drawer-handle"]')?.click(); })()`);
}
async function seek(time) {
  // Existing Timeline handler and store own seek; this merely supplies its pointer position.
  await page(`(() => { const el=document.querySelector('[data-testid="timeline-ruler-track"]'); const key=Object.keys(el).find(k=>k.startsWith('__reactProps$')); const rect=el.getBoundingClientRect(); const lane=Number(document.querySelector('[data-testid="timeline-dock"]').dataset.laneLabelWidth); el[key].onPointerDown({button:0,pointerId:1,clientX:rect.left+${time}*(rect.width-lane)/Number(el.dataset.duration),currentTarget:{setPointerCapture(){}},preventDefault(){}}); })()`);
  await wait(`Number(document.querySelector('[data-testid="timeline-timecode"]')?.dataset.currentTime) === ${time}`);
  await pause(200);
}
async function makeProject(fixture, directory) {
  const project = fixture.project;
  await fs.mkdir(directory, { recursive: true });
  for (const [index, asset] of project.assets.entries()) {
    const width = asset.width, height = asset.height;
    const bitmap = Buffer.alloc(width * height * 4);
    for (let y=0;y<height;y++) for(let x=0;x<width;x++) {
      const offset=(y*width+x)*4;
      const ink = index !== 0 && (x < width*.25 || y > height*.65);
      bitmap[offset]=ink ? (index%2 ? 220 : 60) : 245;
      bitmap[offset+1]=ink ? 100 : 245;
      bitmap[offset+2]=ink ? (index%2 ? 40 : 220) : 245;
      bitmap[offset+3]=255;
    }
    const svg = asset.mimeType === 'image/svg+xml';
    const bytes = svg ? Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#eee"/><path d="M0 0H20V50H${width}V${height}H0Z" fill="${index%2?'#e64b20':'#286bdd'}"/></svg>`) : nativeImage.createFromBitmap(bitmap, { width, height }).toPNG();
    asset.relativePath = `assets/${asset.id}.${svg?'svg':'png'}`;
    asset.sha256=createHash('sha256').update(bytes).digest('hex');
    await fs.mkdir(path.join(directory,'assets'), { recursive:true });
    await fs.writeFile(path.join(directory,asset.relativePath), bytes);
  }
  for(const definition of project.animations) for(const frame of definition.frames ?? []) frame.sha256=project.assets.find(a=>a.id===frame.assetId).sha256;
  await fs.writeFile(path.join(directory,'project.json'), JSON.stringify(project,null,2));
  return project;
}
(async () => {
  await app.whenReady(); await fs.mkdir(root,{recursive:true});
  const { createServer } = await import('vite');
  const server=await createServer({server:{middlewareMode:true}});
  let fixtures;
  try { const module=await server.ssrLoadModule('/tests/helpers/animationV0UatFixture.ts'); fixtures=[module.animationV0UatFixture(),module.animationV0UatFixture(true)]; }
  finally { await server.close(); }
  for(const [i,fixture] of fixtures.entries()) await makeProject(fixture,path.join(root,i?'C-nested.pandastage':'A-B.pandastage'));
  const output=path.join(root,'animation-v0.mp4');
  dialog.showSaveDialog=async()=>({canceled:false,filePath:output});
  require('../dist-electron/main/index.js');
  const deadline=Date.now()+30000;
  while(!window && Date.now()<deadline) { window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('issue816Acceptance')); await pause(100); }
  assert(window,'Production Main window missing');
  window.webContents.on('console-message',event=>{if(event.level==='error'||event.level===3)errors.push(event.message);});
  await wait(`document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input')`);
  const projectRoot=path.join(root,process.argv.includes('--nested')?'C-nested.pandastage':'A-B.pandastage');
  await page(`(() => {const input=document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(projectRoot)}); input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('[data-testid="project-center-screen"] .recovery-open-row button').click();})()`);
  await wait(`window.__pandaStageIssue816Acceptance?.inspect()?.project?.id`);
  await wait(`Number(document.querySelector('[data-testid="project-canvas-viewport"]')?.dataset.displayScale)>0`);
  // Existing acceptance seam makes a normal store edit so formal Save actually writes.
  // Stage gestures are covered by #1126; this script tests persistence of authored clips.
  await page('window.__pandaStageIssue816Acceptance.editUnsavedFixture()');
  const before=await page('window.__pandaStageIssue816Acceptance.inspect()');
  const save=await page('window.__pandaStageIssue816Acceptance.saveCurrentProject()');
  const reopened=await page('window.__pandaStageIssue816Acceptance.reopenSamePath()');
  assert.deepEqual(reopened.project,before.project,'Actual Main/Preload/session save-close-reopen equality');
  assert.notEqual(reopened.openInstanceId,before.openInstanceId,'Reopen creates a fresh session');
  for(const time of [0,250,500]) { await seek(time); await screenshot(`stage-${time}`); }
  await actions(); await click('[data-testid="quick-action-play"]');
  await wait(`document.querySelector('[data-testid="product-preview-overlay"]')?.dataset.previewReadiness==='ready'`);
  if(await page(`document.querySelector('[data-testid="product-preview-overlay"]').dataset.previewPlaying==='true'`)) await click('[data-testid="product-preview-play-pause"]');
  for(const time of [0,250,500]) {
    await page(`(() => {const input=document.querySelector('[data-testid="product-preview-scrubber"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'${time}');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait(`Number(document.querySelector('[data-testid="product-preview-scrubber"]').value)===${time}`);
    await pause(200); await screenshot(`preview-${time}`);
  }
  await click('[data-testid="product-preview-close"]');
  await page(`window.v004Updates=[]; window.pandaStage.export.onUpdate(u=>window.v004Updates.push(u)); void 0`);
  const preparation=await page('window.__pandaStageIssue816Acceptance.prepare()');
  assert.equal(preparation.status,'PREPARATION_READY',JSON.stringify(preparation));
  const started=await page(`window.pandaStage.export.startFormal(${JSON.stringify(preparation.candidate.snapshotId)})`);
  await wait(`window.v004Updates.some(u=>['completed','failed','cancelled'].includes(u.status))`,120000);
  const updates=await page('window.v004Updates');
  assert.equal(updates.at(-1).status,'completed',JSON.stringify(updates.at(-1)));
  const probePath=path.join(path.dirname(require.resolve('@ffprobe-installer/win32-x64/package.json')),'ffprobe.exe');
  const probe=JSON.parse(execFileSync(probePath,['-v','error','-show_streams','-of','json',output],{encoding:'utf8'}));
  const video=probe.streams.find(s=>s.codec_type==='video');
  assert.equal(Number(video.nb_frames),24); assert.equal(video.width,1920); assert.equal(video.height,1080);
  const ffmpeg=path.join(path.dirname(require.resolve('@ffmpeg-installer/win32-x64/package.json')),'ffmpeg.exe');
  for(const time of [0,250,500]) execFileSync(ffmpeg,['-v','error','-ss',String(time/1000),'-i',output,'-frames:v','1',path.join(root,`export-${time}.png`)]);
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(root,'result.json'),JSON.stringify({status:'PASS',humanUat:'PENDING',sampleD:'PENDING_REAL_SOURCE',projectRoot,nestedProject:path.join(root,'C-nested.pandastage'),save,sessionBefore:before.openInstanceId,sessionAfter:reopened.openInstanceId,project:reopened.project,preparation,started,updates,video,errors},null,2));
  console.log(`PASS: ${root}`);
})().catch(async error=>{
  failed=true; console.error(error); await fs.mkdir(root,{recursive:true});
  await fs.writeFile(path.join(root,'failure.json'),JSON.stringify({error:String(error),errors,html:window?await page('document.body.innerHTML').catch(()=>null):null},null,2));
  if(window) await screenshot('failure'); console.error(`Evidence: ${root}`);
}).finally(()=>app.exit(failed?1:0));
