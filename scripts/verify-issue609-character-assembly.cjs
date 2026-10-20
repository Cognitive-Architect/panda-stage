const { app, ipcMain } = require('electron');
const { deflateSync } = require('node:zlib');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { createMainWindow } = require('../dist-electron/main/windows/main-window.js');
const { IPC_CHANNELS } = require('../dist-electron/shared/ipc/channels.js');
const {
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
} = require('../dist-electron/domain/index.js');
const {
  detectSchemaVersion,
  migrateProject,
} = require('../dist-electron/domain/migrations/index.js');
const exampleProject = require('../demo-project/project-v1.example.json');
const issue792Only = process.argv.includes('--issue792-mouth-overflow');
const issue797Only = process.argv.includes('--issue797-head-face-edit');
const issue798Only = process.argv.includes('--issue798-add-to-shot-navigation');
const issue799Only = process.argv.includes('--issue799-layout-reuse');
const focusedCharacterDrawerRun = issue792Only || issue797Only || issue798Only || issue799Only;
const ISSUE683_BASELINE_SHA = 'bed0b353f40238bfd820861c0e5349f0e101e977';

// Bounded S07 proof: use the production Character drawer, Assembly workbench,
// Asset Library drag source, Canvas drop target, and Project Save boundary in
// a real Windows Electron renderer. The Issue #612 Create-drawer contract is
// included; synthetic fixture bytes stay outside the repository, and the
// receipt does not claim human visual acceptance.
const acceptanceRoot = issue799Only
  ? 'D:\\PandaStage-Acceptance\\issue799-layout-reuse'
  : issue797Only
    ? 'D:\\PandaStage-Acceptance\\issue797-head-face-edit'
    : issue798Only
      ? 'D:\\PandaStage-Acceptance\\issue798-add-to-shot-navigation'
      : issue792Only
        ? 'D:\\PandaStage-Acceptance\\issue792-mouth-overflow'
        : 'D:\\PandaStage-Acceptance\\issue609-character-assembly';
const runId = new Date().toISOString().replace(/[:.]/gu, '-');
const runRoot = path.join(acceptanceRoot, `run-${runId}`);
const evidenceRoot = path.join(runRoot, 'evidence');
const userDataRoot = path.join(runRoot, 'electron-user-data');
const projectRoot = path.join(
  runRoot,
  'projects',
  issue799Only
    ? 'issue799-layout-reuse.pandastage'
    : issue797Only
      ? 'issue797-head-face-edit.pandastage'
      : issue798Only
        ? 'issue798-add-to-shot-navigation.pandastage'
        : issue792Only
          ? 'issue792-mouth-overflow.pandastage'
          : 'issue609-assembly.pandastage',
);
const resultPath = path.join(runRoot, 'results.json');
const assetDragMime = 'application/x-panda-stage-asset';

const IDS = Object.freeze({
  project: 'a0609000-0000-4000-8000-000000000001',
  body: 'a0609000-0000-4000-8000-000000000002',
  bodyAlt: 'a0609000-0000-4000-8000-000000000003',
  face: 'a0609000-0000-4000-8000-000000000004',
  mouth: 'a0609000-0000-4000-8000-000000000005',
  shot: 'a0609000-0000-4000-8000-000000000006',
  legacyCharacter: 'a0609000-0000-4000-8000-000000000007',
  legacyNormalExpression: 'a0609000-0000-4000-8000-000000000008',
  legacyAngryExpression: 'a0609000-0000-4000-8000-000000000009',
  legacyVoiceProfile: 'a0609000-0000-4000-8000-00000000000a',
  issue792Head: 'a0609000-0000-4000-8000-00000000000b',
  issue792Character: 'a0609000-0000-4000-8000-00000000000c',
  issue792Expression: 'a0609000-0000-4000-8000-00000000000d',
  issue792VoiceProfile: 'a0609000-0000-4000-8000-00000000000e',
  issue797HeadlessCharacter: 'a0609000-0000-4000-8000-00000000000f',
  issue797HeadlessExpression: 'a0609000-0000-4000-8000-000000000010',
  issue797HeadlessVoiceProfile: 'a0609000-0000-4000-8000-000000000011',
  issue799SourceCharacter: 'a0609000-0000-4000-8000-000000000012',
  issue799TargetCharacter: 'a0609000-0000-4000-8000-000000000013',
  issue799HeadlessCharacter: 'a0609000-0000-4000-8000-000000000014',
  issue799RatioCharacter: 'a0609000-0000-4000-8000-000000000015',
  issue799MissingCharacter: 'a0609000-0000-4000-8000-000000000016',
  issue799SourceVoice: 'a0609000-0000-4000-8000-000000000017',
  issue799TargetVoice: 'a0609000-0000-4000-8000-000000000018',
  issue799HeadlessVoice: 'a0609000-0000-4000-8000-000000000019',
  issue799RatioVoice: 'a0609000-0000-4000-8000-00000000001a',
  issue799MissingVoice: 'a0609000-0000-4000-8000-00000000001b',
  issue799SourceExpression: 'a0609000-0000-4000-8000-00000000001c',
  issue799TargetExpression: 'a0609000-0000-4000-8000-00000000001d',
  issue799TargetAngryExpression: 'a0609000-0000-4000-8000-00000000001e',
  issue799HeadlessExpression: 'a0609000-0000-4000-8000-00000000001f',
  issue799RatioExpression: 'a0609000-0000-4000-8000-000000000020',
  issue799MissingExpression: 'a0609000-0000-4000-8000-000000000021',
  issue799TargetHead: 'a0609000-0000-4000-8000-000000000022',
  issue799MissingHead: 'a0609000-0000-4000-8000-000000000023',
  issue799RatioBody: 'a0609000-0000-4000-8000-000000000024',
  issue799TargetFace: 'a0609000-0000-4000-8000-000000000025',
  issue799TargetMouth: 'a0609000-0000-4000-8000-000000000026',
  issue799TargetAngryFace: 'a0609000-0000-4000-8000-000000000027',
});

const COLORS = new Map([
  [IDS.body, [62, 132, 76]],
  [IDS.bodyAlt, [94, 104, 162]],
  [IDS.face, [231, 194, 112]],
  [IDS.mouth, [184, 90, 78]],
  [IDS.issue799TargetHead, [143, 108, 180]],
  [IDS.issue799MissingHead, [143, 108, 180]],
  [IDS.issue799RatioBody, [112, 96, 130]],
  [IDS.issue799TargetFace, [232, 200, 132]],
  [IDS.issue799TargetMouth, [188, 92, 84]],
  [IDS.issue799TargetAngryFace, [202, 134, 96]],
]);

const channels = [];
const canvasReadEvidence = [];
const thumbnailReadEvidence = [];
let activeProject = null;
let savedProject = null;
let windowRef = null;
let inProgressEvidence = {};

app.on('window-all-closed', () => {});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function browserWait(expression, message, timeout = 20_000) {
  return `(async () => {
    const deadline = Date.now() + ${timeout};
    while (Date.now() < deadline) {
      try {
        if (${expression}) return true;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(${JSON.stringify(message)});
  })()`;
}

async function waitForDom(window, expression, message, timeout) {
  await window.webContents.executeJavaScript(
    browserWait(expression, message, timeout),
  );
}

async function click(window, selector, label = selector) {
  await waitForDom(
    window,
    `document.querySelector(${JSON.stringify(selector)})`,
    `${label} did not appear.`,
  );
  await window.webContents.executeJavaScript(
    `document.querySelector(${JSON.stringify(selector)}).click()`,
  );
}

async function setConfirmResponse(window, response) {
  await window.webContents.executeJavaScript(
    `window.__issue610ConfirmResponse = ${JSON.stringify(response)}`,
  );
}

async function readConfirmCalls(window) {
  return window.webContents.executeJavaScript(
    'window.__issue610ConfirmCalls ?? []',
  );
}

async function capture(window, fileName) {
  const image = await window.webContents.capturePage();
  const target = path.join(evidenceRoot, fileName);
  writeFileSync(target, image.toPNG());
  return path.relative(runRoot, target).replaceAll('\\', '/');
}

async function waitForPaint(window) {
  await window.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  await wait(60);
}

async function waitForCharacterDetailScreenshot(window, label) {
  await waitForDom(
    window,
    `(() => {
      const dock = document.querySelector('[data-testid="resource-activity-dock"]');
      const drawer = document.querySelector('[data-testid="resource-activity-drawer"]');
      const detail = document.querySelector('[data-testid="character-detail-view"]');
      const workspace = detail?.querySelector('[data-testid="character-expression-workspace"]');
      const expressionCards = [...(workspace?.querySelectorAll('[data-expression-id]') ?? [])];
      const drawerBounds = drawer?.getBoundingClientRect();
      const drawerStyle = drawer ? getComputedStyle(drawer) : undefined;
      return dock?.dataset.activeActivity === 'characters'
        && dock.dataset.resourceDrawerOpen === 'true'
        && drawerBounds?.right > 240
        && drawerStyle?.visibility === 'visible'
        && Number(drawerStyle.opacity) >= 0.99
        && detail?.getBoundingClientRect().width > 0
        && expressionCards.length === 2
        && expressionCards.every((card) => {
          const thumbnail = card.querySelector('.expression-card-preview');
          const image = thumbnail?.querySelector('img');
          return thumbnail?.dataset.thumbnailStatus === 'ready'
            && image?.complete
            && image.naturalWidth > 0;
        });
    })()`,
    `${label} screenshot state did not become fully visible with loaded Expression thumbnails.`,
  );
  await wait(200);
}

function hashFor(id) {
  return `${id.replace(/-/gu, '')}00000000000000000000000000000000`.slice(0, 64);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, bytes) {
  const typeBytes = Buffer.from(type, 'ascii');
  const payload = Buffer.concat([typeBytes, bytes]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(payload), 0);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length, 0);
  return Buffer.concat([length, payload, checksum]);
}

function solidPng(width, height, color) {
  const row = Buffer.alloc(width * 4 + 1);
  row[0] = 0;
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 4] = color[0];
    row[2 + x * 4] = color[1];
    row[3 + x * 4] = color[2];
    row[4 + x * 4] = 255;
  }
  const raw = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y += 1) row.copy(raw, y * row.length);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function imageAsset(id, name, width, height) {
  return {
    id,
    kind: 'image',
    name,
    relativePath: `assets/${name}.png`,
    mimeType: 'image/png',
    width,
    height,
    sha256: hashFor(id),
  };
}

function createFixture() {
  const base = migrateProject(exampleProject);
  const shot = base.shots[0];
  const legacyCharacter = {
    id: IDS.legacyCharacter,
    mode: 'single-image',
    name: 'Existing Single-image Panda',
    baseAssetId: IDS.face,
    defaultVoiceProfileId: IDS.legacyVoiceProfile,
    expressions: [
      {
        id: IDS.legacyNormalExpression,
        name: 'normal',
        assetId: IDS.face,
      },
      {
        id: IDS.legacyAngryExpression,
        name: 'angry',
        assetId: IDS.mouth,
      },
    ],
    defaultExpressionId: IDS.legacyNormalExpression,
    defaultScale: 1,
    defaultFlipX: false,
  };
  const issue792Character = {
    id: IDS.issue792Character,
    mode: 'composite',
    name: issue798Only
      ? '角色详情导航长名称验收熊猫'
      : issue797Only
        ? 'Issue 797 Head and Face Panda'
        : 'Issue 792 Composite Panda',
    baseAssetId: IDS.face,
    defaultVoiceProfileId: IDS.issue792VoiceProfile,
    expressions: [
      {
        id: IDS.issue792Expression,
        name: 'Neutral',
        assetId: IDS.face,
      },
    ],
    defaultExpressionId: IDS.issue792Expression,
    defaultScale: 1,
    defaultFlipX: false,
    bodyAssetId: IDS.body,
    facePlacement: { offsetX: 0, offsetY: issue797Only ? 220 : 0, scale: 1 },
    head: {
      assetId: IDS.issue792Head,
      placement: { offsetX: 0, offsetY: issue797Only ? -160 : 0, scale: 1 },
      pivot: { x: 360, y: 460 },
    },
    mouthOpenAssetId: IDS.mouth,
  };
  const issue797HeadlessCharacter = {
    id: IDS.issue797HeadlessCharacter,
    mode: 'composite',
    name: 'Issue 797 Headless Composite Panda',
    baseAssetId: IDS.face,
    defaultVoiceProfileId: IDS.issue797HeadlessVoiceProfile,
    expressions: [
      {
        id: IDS.issue797HeadlessExpression,
        name: 'Neutral',
        assetId: IDS.face,
      },
    ],
    defaultExpressionId: IDS.issue797HeadlessExpression,
    defaultScale: 1,
    defaultFlipX: false,
    bodyAssetId: IDS.body,
    facePlacement: { offsetX: 0, offsetY: 220, scale: 1 },
  };
  const issue799SourceCharacter = {
    id: IDS.issue799SourceCharacter,
    mode: 'composite',
    name: 'Issue 799 Saved Layout Source',
    baseAssetId: IDS.face,
    defaultVoiceProfileId: IDS.issue799SourceVoice,
    expressions: [
      { id: IDS.issue799SourceExpression, name: 'Source Neutral', assetId: IDS.face },
    ],
    defaultExpressionId: IDS.issue799SourceExpression,
    defaultScale: 1.25,
    defaultFlipX: true,
    bodyAssetId: IDS.body,
    facePlacement: { offsetX: 46, offsetY: 190, scale: 0.92 },
    head: {
      assetId: IDS.issue792Head,
      placement: { offsetX: 6, offsetY: -132, scale: 0.88 },
      pivot: { x: 358, y: 452 },
    },
    mouthOpenAssetId: IDS.mouth,
  };
  const issue799TargetCharacter = {
    id: IDS.issue799TargetCharacter,
    mode: 'composite',
    name: 'Issue 799 Target Panda',
    baseAssetId: IDS.issue799TargetFace,
    defaultVoiceProfileId: IDS.issue799TargetVoice,
    expressions: [
      { id: IDS.issue799TargetExpression, name: 'Target Neutral', assetId: IDS.issue799TargetFace },
      { id: IDS.issue799TargetAngryExpression, name: 'Target Angry', assetId: IDS.issue799TargetAngryFace },
    ],
    defaultExpressionId: IDS.issue799TargetExpression,
    defaultScale: 0.78,
    defaultFlipX: false,
    bodyAssetId: IDS.bodyAlt,
    facePlacement: { offsetX: -22, offsetY: 64, scale: 1.2 },
    head: {
      assetId: IDS.issue799TargetHead,
      placement: { offsetX: -18, offsetY: -60, scale: 1.1 },
      pivot: { x: 280, y: 385 },
    },
    mouthOpenAssetId: IDS.issue799TargetMouth,
  };
  const issue799HeadlessCharacter = {
    id: IDS.issue799HeadlessCharacter,
    mode: 'composite',
    name: 'Issue 799 Source Without Head',
    baseAssetId: IDS.face,
    defaultVoiceProfileId: IDS.issue799HeadlessVoice,
    expressions: [
      { id: IDS.issue799HeadlessExpression, name: 'Headless Neutral', assetId: IDS.face },
    ],
    defaultExpressionId: IDS.issue799HeadlessExpression,
    defaultScale: 1,
    defaultFlipX: false,
    bodyAssetId: IDS.body,
    facePlacement: { offsetX: -80, offsetY: 99, scale: 1 },
  };
  const issue799RatioCharacter = {
    id: IDS.issue799RatioCharacter,
    mode: 'composite',
    name: 'Issue 799 Different Body Ratio',
    baseAssetId: IDS.face,
    defaultVoiceProfileId: IDS.issue799RatioVoice,
    expressions: [
      { id: IDS.issue799RatioExpression, name: 'Ratio Neutral', assetId: IDS.face },
    ],
    defaultExpressionId: IDS.issue799RatioExpression,
    defaultScale: 1,
    defaultFlipX: false,
    bodyAssetId: IDS.issue799RatioBody,
    facePlacement: { offsetX: 72, offsetY: 144, scale: 1 },
    head: {
      assetId: IDS.issue792Head,
      placement: { offsetX: 14, offsetY: -148, scale: 0.95 },
      pivot: { x: 380, y: 440 },
    },
  };
  const issue799MissingCharacter = {
    id: IDS.issue799MissingCharacter,
    mode: 'composite',
    name: 'Issue 799 Unreadable Source Asset',
    baseAssetId: IDS.face,
    defaultVoiceProfileId: IDS.issue799MissingVoice,
    expressions: [
      { id: IDS.issue799MissingExpression, name: 'Missing Neutral', assetId: IDS.face },
    ],
    defaultExpressionId: IDS.issue799MissingExpression,
    defaultScale: 1,
    defaultFlipX: false,
    bodyAssetId: IDS.body,
    facePlacement: { offsetX: 20, offsetY: 170, scale: 1 },
    head: {
      assetId: IDS.issue799MissingHead,
      placement: { offsetX: 4, offsetY: -120, scale: 0.9 },
      pivot: { x: 350, y: 450 },
    },
  };
  return ProjectSchema.parse({
    ...base,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: IDS.project,
    name: 'Issue 609 Composite Character Assembly Proof',
    assets: [
      imageAsset(IDS.body, 'Assembly Body', 720, 920),
      imageAsset(IDS.bodyAlt, 'Assembly Body Alternate', 720, 920),
      imageAsset(IDS.face, 'Assembly Default Face', 320, 280),
      imageAsset(IDS.mouth, 'Assembly Mouth', 320, 280),
      ...(focusedCharacterDrawerRun
        ? [imageAsset(IDS.issue792Head, 'Assembly Head', 720, 920)]
        : []),
      ...(issue799Only
        ? [
            imageAsset(IDS.issue799TargetHead, 'Issue 799 Target Head', 640, 800),
            imageAsset(IDS.issue799MissingHead, 'Issue 799 Missing Head', 720, 920),
            imageAsset(IDS.issue799RatioBody, 'Issue 799 Different Ratio Body', 800, 920),
            imageAsset(IDS.issue799TargetFace, 'Issue 799 Target Face', 320, 280),
            imageAsset(IDS.issue799TargetMouth, 'Issue 799 Target Mouth', 320, 280),
            imageAsset(IDS.issue799TargetAngryFace, 'Issue 799 Target Angry Face', 320, 280),
          ]
        : []),
    ],
    characters: issue799Only
      ? [
          legacyCharacter,
          issue799SourceCharacter,
          issue799TargetCharacter,
          issue799HeadlessCharacter,
          issue799RatioCharacter,
          issue799MissingCharacter,
        ]
      : issue792Only || issue797Only || issue798Only
        ? [
            legacyCharacter,
            issue792Character,
            ...(issue797Only ? [issue797HeadlessCharacter] : []),
          ]
        : [legacyCharacter],
    voiceProfiles: [
      {
        id: IDS.legacyVoiceProfile,
        name: 'Existing Single-image Panda voice',
        characterId: IDS.legacyCharacter,
        locale: 'zh-CN',
        rate: 1,
        pitch: 0,
      },
      ...(issue792Only || issue797Only || issue798Only
        ? [{
            id: IDS.issue792VoiceProfile,
            name: 'Issue 792 Panda voice',
            characterId: IDS.issue792Character,
            locale: 'zh-CN',
            rate: 1,
            pitch: 0,
          }]
        : []),
      ...(issue797Only
        ? [{
            id: IDS.issue797HeadlessVoiceProfile,
            name: 'Issue 797 Headless Panda voice',
            characterId: IDS.issue797HeadlessCharacter,
            locale: 'zh-CN',
            rate: 1,
            pitch: 0,
          }]
        : []),
      ...(issue799Only
        ? [
            [IDS.issue799SourceVoice, IDS.issue799SourceCharacter, 'Issue 799 source voice'],
            [IDS.issue799TargetVoice, IDS.issue799TargetCharacter, 'Issue 799 target voice'],
            [IDS.issue799HeadlessVoice, IDS.issue799HeadlessCharacter, 'Issue 799 headless voice'],
            [IDS.issue799RatioVoice, IDS.issue799RatioCharacter, 'Issue 799 ratio voice'],
            [IDS.issue799MissingVoice, IDS.issue799MissingCharacter, 'Issue 799 missing-asset voice'],
          ].map(([id, characterId, name]) => ({
            id,
            name,
            characterId,
            locale: 'zh-CN',
            rate: 1,
            pitch: 0,
          }))
        : []),
    ],
    shots: [
      {
        ...shot,
        id: IDS.shot,
        name: 'Assembly acceptance Shot',
        backgroundLayerId: null,
        dialogues: [],
        audioClips: [],
        timelineEvents: [],
        layers: [],
      },
    ],
  });
}

function readIssue683BaselineClipPath() {
  const childProcess = require('node:child_process');
  const css = childProcess.execFileSync(
    'git',
    ['show', `${ISSUE683_BASELINE_SHA}:src/renderer/styles/features/characters/assembly/s17-01--character-assembly-workbench.css`],
    { encoding: 'utf8' },
  );
  const editor = childProcess.execFileSync(
    'git',
    ['show', `${ISSUE683_BASELINE_SHA}:src/renderer/features/characters/CharacterEditor.tsx`],
    { encoding: 'utf8' },
  );
  const surfaceRule = css.match(
    /\.character-assembly-drawer-panel \.image-asset-picker-selected-row--surface\s*\{[^}]*\}/u,
  )?.[0] ?? '';
  const menuRule = css.match(
    /\.character-assembly-mouth-overflow-menu\s*\{[^}]*\}/u,
  )?.[0] ?? '';
  const menuMarkup = editor.match(
    /<details className="character-assembly-mouth-overflow">[\s\S]*?<\/details>/u,
  )?.[0] ?? '';
  return {
    commit: ISSUE683_BASELINE_SHA,
    rowOverflowHidden: /overflow:\s*hidden/u.test(surfaceRule),
    menuPositionedAbsolute: /position:\s*absolute/u.test(menuRule),
    menuOpensBelowRow: /top:\s*calc\(100%\s*\+\s*4px\)/u.test(menuRule),
    menuIsDescendantOfDetails: /<div className="character-assembly-mouth-overflow-menu">/u.test(menuMarkup),
    surfaceRule,
    menuRule,
  };
}

function documentFor(root, project) {
  return {
    projectRoot: root,
    projectFilePath: path.join(root, 'project.json'),
    project,
    migrated: false,
    sourceVersion: detectSchemaVersion(project),
  };
}

function register(channel, handler) {
  ipcMain.handle(channel, handler);
  channels.push(channel);
}

function projectForRoot(root) {
  if (path.resolve(root).toLowerCase() !== path.resolve(projectRoot).toLowerCase()) {
    return null;
  }
  if (issue799Only) {
    return ProjectSchema.parse(
      JSON.parse(readFileSync(path.join(projectRoot, 'project.json'), 'utf8')),
    );
  }
  return activeProject;
}

function currentImageAsset(assetId, root) {
  return projectForRoot(root)?.assets.find(
    (asset) => asset.id === assetId && asset.kind === 'image',
  ) ?? null;
}

function registerAcceptanceHandlers() {
  const assetBytes = new Map();
  register(IPC_CHANNELS.PROJECT_CHOOSE_DIRECTORY, () => ({
    ok: true,
    status: 'cancelled',
  }));
  register(IPC_CHANNELS.PROJECT_OPEN, (_event, request) => {
    const project = projectForRoot(request.projectRoot);
    return project
      ? { ok: true, value: documentFor(request.projectRoot, project) }
      : {
          ok: false,
          error: {
            code: 'PROJECT_NOT_FOUND',
            message: 'Issue #609 synthetic project was not found.',
            projectRoot: request.projectRoot,
          },
        };
  });
  register(IPC_CHANNELS.PROJECT_SAVE, (_event, request) => {
    savedProject = request.project;
    activeProject = request.project;
    if (issue799Only) {
      writeFileSync(
        path.join(projectRoot, 'project.json'),
        `${JSON.stringify(request.project, null, 2)}\n`,
        'utf8',
      );
    }
    return { ok: true, value: documentFor(request.projectRoot, request.project) };
  });
  register(IPC_CHANNELS.PROJECT_CONFIRM_SWITCH, () => ({ outcome: 'saved' }));
  register(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({ ok: true, entries: [] }));
  register(IPC_CHANNELS.RECENT_PROJECTS_OPEN, (_event, request) => {
    const project = projectForRoot(request.projectRoot);
    return project
      ? { ok: true, document: documentFor(request.projectRoot, project) }
      : {
          ok: false,
          error: {
            code: 'RECENT_PROJECT_NOT_FOUND',
            message: 'Issue #609 synthetic project was not found.',
            projectRoot: request.projectRoot,
          },
        };
  });
  register(IPC_CHANNELS.AUTOSAVE_TRACK, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_UPDATE, () => ({ ok: true }));
  register(IPC_CHANNELS.AUTOSAVE_STOP, () => ({ ok: true }));
  register(IPC_CHANNELS.RECOVERY_DETECT, () => ({ ok: true, candidate: null }));
  register(IPC_CHANNELS.RECOVERY_IGNORE, () => ({ ok: true, retained: true }));
  register(IPC_CHANNELS.ASSET_THUMBNAIL_READ, (_event, request) => {
    const asset = currentImageAsset(request.assetId, request.projectRoot);
    if (!asset || asset.sha256 !== request.sha256) {
      return {
        ok: false,
        error: {
          code: asset ? 'ASSET_THUMBNAIL_HASH_MISMATCH' : 'ASSET_THUMBNAIL_ASSET_NOT_FOUND',
          message: 'Issue #609 thumbnail fixture could not be read.',
          assetId: request.assetId,
          ...(asset ? { relativePath: asset.relativePath } : {}),
        },
      };
    }
    const bytes = assetBytes.get(asset.id) ?? solidPng(
      asset.width,
      asset.height,
      COLORS.get(asset.id) ?? [128, 128, 128],
    );
    assetBytes.set(asset.id, bytes);
    thumbnailReadEvidence.push({ assetId: asset.id, status: 'ready' });
    return {
      ok: true,
      status: 'ready',
      assetId: asset.id,
      dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
    };
  });
  register(IPC_CHANNELS.ASSET_CANVAS_IMAGE_READ, (_event, request) => {
    const asset = currentImageAsset(request.assetId, request.projectRoot);
    if (issue799Only && request.assetId === IDS.issue799MissingHead) {
      return {
        ok: false,
        error: {
          code: 'ASSET_CANVAS_IMAGE_ASSET_NOT_FOUND',
          message: 'Issue #799 deliberately unreadable source Head fixture.',
          assetId: request.assetId,
        },
      };
    }
    if (!asset || asset.sha256 !== request.sha256) {
      return {
        ok: false,
        error: {
          code: asset ? 'ASSET_CANVAS_IMAGE_HASH_MISMATCH' : 'ASSET_CANVAS_IMAGE_ASSET_NOT_FOUND',
          message: 'Issue #609 Canvas fixture could not be read.',
          assetId: request.assetId,
        },
      };
    }
    const bytes = assetBytes.get(asset.id) ?? solidPng(
      asset.width,
      asset.height,
      COLORS.get(asset.id) ?? [128, 128, 128],
    );
    assetBytes.set(asset.id, bytes);
    canvasReadEvidence.push({ assetId: asset.id, sha256: request.sha256 });
    return {
      ok: true,
      status: 'ready',
      assetId: asset.id,
      mimeType: 'image/png',
      width: asset.width,
      height: asset.height,
      byteLength: bytes.byteLength,
      bytes: new Uint8Array(bytes),
    };
  });
}

function configureElectronPaths() {
  for (const [name, directory] of [
    ['userData', userDataRoot],
    ['sessionData', path.join(userDataRoot, 'session-data')],
    ['temp', path.join(runRoot, 'temp')],
    ['logs', path.join(runRoot, 'logs')],
    ['crashDumps', path.join(runRoot, 'crash-dumps')],
  ]) {
    mkdirSync(directory, { recursive: true });
    try {
      app.setPath(name, directory);
    } catch {
      // Some Electron paths become immutable after readiness.
    }
  }
}

async function openProject(window) {
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input')`,
    'Project Center did not render its project path input.',
  );
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('[data-testid="project-center-screen"] .recovery-open-row input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(projectRoot)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('[data-testid="project-center-screen"] .recovery-open-row button').click();
  })()`);
  await waitForDom(
    window,
    `document.querySelector('[data-testid="editor-layout"]')?.dataset.shellMode === 'landscape'`,
    'Synthetic project did not open in the landscape production editor.',
  );
  await waitForDom(
    window,
    `Number(document.querySelector('[data-testid="project-canvas-viewport"]')?.dataset.displayScale) > 0`,
    'Initial Canvas viewport did not receive its measured display scale.',
  );
  const characterDrawerIsOpen = await window.webContents.executeJavaScript(`(() => {
    const dock = document.querySelector('[data-testid="resource-activity-dock"]');
    return dock?.dataset.activeActivity === 'characters'
      && dock.dataset.resourceDrawerOpen === 'true';
  })()`);
  if (!characterDrawerIsOpen) {
    await click(window, '[data-testid="resource-activity-rail-characters"]', 'Characters activity');
  }
  try {
    await waitForDom(
      window,
      `(() => {
        const dock = document.querySelector('[data-testid="resource-activity-dock"]');
        const drawer = document.querySelector('[data-testid="resource-activity-drawer"]');
        const bounds = drawer?.getBoundingClientRect();
        const style = drawer ? getComputedStyle(drawer) : undefined;
        return dock?.dataset.activeActivity === 'characters'
          && dock.dataset.resourceDrawerOpen === 'true'
          && document.querySelector('[data-testid="character-list-view"]')
          && bounds?.right > 240
          && style?.visibility === 'visible'
          && Number(style.opacity) >= 0.99;
      })()`,
      'Character list did not become visible in the production resource drawer.',
    );
  } catch (error) {
    inProgressEvidence.initialCharacterDrawerFailure = await window.webContents.executeJavaScript(`(() => {
      const dock = document.querySelector('[data-testid="resource-activity-dock"]');
      const drawer = document.querySelector('[data-testid="resource-activity-drawer"]');
      const bounds = drawer?.getBoundingClientRect();
      const style = drawer ? getComputedStyle(drawer) : undefined;
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        shellMode: document.querySelector('[data-testid="editor-layout"]')?.dataset.shellMode,
        activeActivity: dock?.dataset.activeActivity,
        drawerOpen: dock?.dataset.resourceDrawerOpen,
        resourceMode: dock?.dataset.resourceMode,
        drawerBounds: bounds && { left: bounds.left, right: bounds.right, width: bounds.width, height: bounds.height },
        drawerStyle: style && { visibility: style.visibility, opacity: style.opacity, transform: style.transform },
        characterListMounted: Boolean(document.querySelector('[data-testid="character-list-view"]')),
        characterCreateMounted: Boolean(document.querySelector('[data-testid="character-create-view"]')),
        panelActivity: document.querySelector('.resource-activity-panel')?.getAttribute('data-active-activity'),
        rail: [...document.querySelectorAll('[data-testid^="resource-activity-rail-"]')].map((button) => ({
          testId: button.getAttribute('data-testid'),
          pressed: button.getAttribute('aria-pressed'),
        })),
      };
    })()`);
    inProgressEvidence.initialCharacterDrawerFailureScreenshot = await capture(
      window,
      'initial-character-drawer-failure.png',
    );
    throw error;
  }
  await wait(200);
}

async function openCreate(window) {
  await click(window, '[data-testid="resource-primary-action"]', 'New Character action');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-create-view"]')`,
    'Character creation form did not open.',
  );
}

async function chooseImage(window, pickerTestId, assetId) {
  await click(window, `[data-testid="${pickerTestId}-selected"]`, `${pickerTestId} picker`);
  const candidates = `[data-testid="${pickerTestId}-candidates"] [data-asset-id="${assetId}"]`;
  await click(window, candidates, `${pickerTestId} asset ${assetId}`);
}

async function setCharacterName(window, value) {
  const selector = '[data-testid="character-create-view"] form input:not([type="radio"])';
  await waitForDom(window, `document.querySelector(${JSON.stringify(selector)})`, 'Character name field did not appear.');
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function dragFaceWithNativeInput(window) {
  await waitForDom(
    window,
    `(() => {
      const target = document.querySelector('[data-testid="character-assembly-face-drag-target"]');
      const images = [...document.querySelectorAll('.character-assembly-part')];
      return target && target.getBoundingClientRect().width > 24 && images.length === 2 && images.every((image) => image.complete && image.naturalWidth > 0);
    })()`,
    'The Body + Face assembly preview did not become drawable.',
  );
  const point = await window.webContents.executeJavaScript(`(() => {
    const rect = document.querySelector('[data-testid="character-assembly-face-drag-target"]').getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  window.webContents.sendInputEvent({
    type: 'mouseMove',
    x: point.x + 32,
    y: point.y + 18,
    button: 'left',
  });
  await wait(80);
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    x: point.x + 32,
    y: point.y + 18,
    button: 'left',
    clickCount: 1,
  });
  await waitForDom(
    window,
    `Number(document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.faceOffsetX) !== 0 && Number(document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.faceOffsetY) !== 0`,
    'Native pointer input did not adjust the temporary Face Placement.',
  );
  return window.webContents.executeJavaScript(`(() => {
    const workbench = document.querySelector('[data-testid="character-assembly-workbench"]');
    const backgroundWarnings = [...document.querySelectorAll('[data-testid="canvas-background-warning"]')].map((warning) => {
      const bounds = warning.getBoundingClientRect();
      return {
        inShotCanvasOwner: Boolean(warning.closest('.character-assembly-canvas-owner')),
        visibility: getComputedStyle(warning).visibility,
        display: getComputedStyle(warning).display,
        opacity: getComputedStyle(warning).opacity,
        bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      };
    });
    const preview = document.querySelector('[data-testid="character-assembly-preview"]');
    const stage = preview?.querySelector('.character-assembly-preview-stage');
    const previewBounds = preview?.getBoundingClientRect();
    const stageBounds = stage?.getBoundingClientRect();
    const previewParts = [...document.querySelectorAll('.character-assembly-part')].map((part) => {
      const bounds = part.getBoundingClientRect();
      const style = getComputedStyle(part);
      return {
        assetId: part.dataset.assetId ?? '',
        className: part.className,
        complete: part.complete,
        naturalWidth: part.naturalWidth,
        naturalHeight: part.naturalHeight,
        bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        style: {
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          zIndex: style.zIndex,
          objectFit: style.objectFit,
        },
      };
    });
    return {
      bodyAssetId: workbench.dataset.bodyAssetId,
      faceAssetId: workbench.dataset.previewFaceAssetId,
      faceOffsetX: Number(workbench.dataset.faceOffsetX),
      faceOffsetY: Number(workbench.dataset.faceOffsetY),
      faceScale: Number(workbench.dataset.faceScale),
      history: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? '',
      revision: document.querySelector('[data-testid="character-manager"] [data-project-revision]')?.dataset.projectRevision ?? '',
      rightInactive: document.querySelector('[data-workspace-owner="properties"]')?.dataset.characterAssemblyInactive ?? '',
      timelineInactive: document.querySelector('[data-testid="bottom-workspace"]')?.dataset.characterAssemblyInactive ?? '',
      canvasOwners: document.querySelectorAll('[data-workspace-owner="canvas"]').length,
      canvasBackgroundWarnings: backgroundWarnings,
      canvasOwnerVisibility: getComputedStyle(document.querySelector('.character-assembly-canvas-owner')).visibility,
      previewViewportBounds: previewBounds
        ? { x: previewBounds.x, y: previewBounds.y, width: previewBounds.width, height: previewBounds.height }
        : null,
      previewStageBounds: stageBounds
        ? { x: stageBounds.x, y: stageBounds.y, width: stageBounds.width, height: stageBounds.height }
        : null,
      previewParts,
    };
  })()`);
}

async function dispatchAssetDrop(window, sourceSelector, sourceContext) {
  await waitForDom(
    window,
    `Number(document.querySelector('[data-testid="project-canvas-viewport"]')?.dataset.displayScale) > 0`,
    'Canvas viewport did not recover a valid scale after leaving Assembly.',
  );
  const setup = await window.webContents.executeJavaScript(`(() => {
    const candidates = [...document.querySelectorAll(${JSON.stringify(sourceSelector)})];
    const source = ${JSON.stringify(sourceContext)}
      ? candidates.find((candidate) => candidate.querySelector('.asset-card-context')?.textContent.includes(${JSON.stringify(sourceContext)}))
      : candidates[0];
    const target = document.querySelector('[data-testid="project-canvas-viewport"]');
    const stage = target?.querySelector('[data-testid="canvas-logical-stage"]');
    if (!source || !target || !stage) throw new Error('Asset card or Canvas drop target is missing.');
    const rect = target.getBoundingClientRect();
    const scale = Number(target.dataset.displayScale);
    const logicalX = Number(target.dataset.logicalWidth) / 2;
    const logicalY = Number(target.dataset.logicalHeight) / 2;
    const x = rect.left + Number(target.dataset.offsetX) + logicalX * scale - target.scrollLeft;
    const y = rect.top + Number(target.dataset.offsetY) + logicalY * scale - target.scrollTop;
    const dataTransfer = new DataTransfer();
    const event = (type) => new DragEvent(type, {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX: x,
      clientY: y,
    });
    source.dispatchEvent(event('dragstart'));
    target.dispatchEvent(event('dragenter'));
    target.dispatchEvent(event('dragover'));
    window.__issue609AssetDrop = { source, target, dataTransfer, x, y };
    return {
      x,
      y,
      types: [...dataTransfer.types],
      payload: dataTransfer.getData(${JSON.stringify(assetDragMime)}),
      dropDisabled: target.dataset.dropDisabled ?? '',
      viewport: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      transform: {
        scale,
        offsetX: target.dataset.offsetX,
        offsetY: target.dataset.offsetY,
        logicalWidth: target.dataset.logicalWidth,
        logicalHeight: target.dataset.logicalHeight,
        scrollLeft: target.scrollLeft,
        scrollTop: target.scrollTop,
      },
    };
  })()`);
  const diagnostics = () => window.webContents.executeJavaScript(`(() => {
    const state = window.__issue609AssetDrop;
    const stage = document.querySelector('[data-testid="project-canvas-stage"]');
    return {
      dragTypes: state ? [...state.dataTransfer.types] : [],
      dragPayload: state?.dataTransfer.getData(${JSON.stringify(assetDragMime)}) ?? '',
      canvasDropDisabled: state?.target.dataset.dropDisabled ?? '',
      canvasClass: state?.target.className ?? '',
      ghost: document.querySelector('[data-testid="canvas-drop-ghost"]')?.textContent?.trim() ?? '',
      interactionStatus: stage?.dataset.interactionStatus ?? '',
      layers: JSON.parse(stage?.dataset.layerJson ?? '[]').length,
      shellMode: document.querySelector('[data-testid="editor-layout"]')?.dataset.shellMode ?? '',
    };
  })()`);
  try {
    await waitForDom(
      window,
      `document.querySelector('[data-testid="canvas-drop-ghost"]')`,
      'Canvas did not produce its production Drop Preview.',
    );
  } catch (error) {
    const state = await diagnostics();
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; drag=${JSON.stringify(setup)}; state=${JSON.stringify(state)}`,
      { cause: error },
    );
  }
  const preview = await diagnostics();
  await window.webContents.executeJavaScript(`(() => {
    const state = window.__issue609AssetDrop;
    if (!state) throw new Error('Asset drag state was lost before drop.');
    const options = {
      bubbles: true,
      cancelable: true,
      dataTransfer: state.dataTransfer,
      clientX: state.x,
      clientY: state.y,
    };
    state.target.dispatchEvent(new DragEvent('drop', options));
    state.source.dispatchEvent(new DragEvent('dragend', {
      bubbles: true,
      dataTransfer: state.dataTransfer,
    }));
  })()`);
  await wait(250);
  const afterDrop = await diagnostics();
  await window.webContents.executeJavaScript('delete window.__issue609AssetDrop');
  return { ...setup, preview, afterDrop };
}

async function readCanvasLayerState(window) {
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-canvas-stage"]')`,
    'Canvas Stage did not render the placed visual.',
  );
  return window.webContents.executeJavaScript(`(() => {
    const stage = document.querySelector('[data-testid="project-canvas-stage"]');
    const layers = JSON.parse(stage.dataset.layerJson ?? '[]');
    return {
      revision: Number(stage.dataset.projectRevision),
      layers,
      renderedAssetIds: JSON.parse(stage.dataset.renderedAssetIds ?? '[]'),
      incompleteVisualLayerIds: JSON.parse(stage.dataset.incompleteVisualLayerIds ?? '[]'),
      failureWarning: Boolean(document.querySelector('[data-testid="canvas-visual-failure-warning"]')),
    };
  })()`);
}

async function expandProjectActions(window) {
  await window.webContents.executeJavaScript(`(() => {
    const drawer = document.querySelector('[data-testid="quick-action-drawer"]');
    if (drawer?.dataset.expanded !== 'true') {
      drawer?.querySelector('[data-testid="quick-action-drawer-handle"]')?.click();
    }
  })()`);
  await waitForDom(window, `document.querySelector('[data-testid="quick-action-drawer"]')?.dataset.expanded === 'true'`, 'Project actions drawer did not expand.');
}

async function sendPointerClick(window, x, y) {
  const point = { x: Math.round(x), y: Math.round(y) };
  window.webContents.sendInputEvent({ type: 'mouseMove', ...point });
  window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
  window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
}

async function clickWithNativeInput(window, selector, label = selector) {
  await waitForDom(
    window,
    `document.querySelector(${JSON.stringify(selector)})`,
    `${label} did not appear.`,
  );
  const point = await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const hitSamples = [
      [0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75],
      [0.1, 0.5], [0.9, 0.5], [0.5, 0.1], [0.5, 0.9],
      [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75],
    ].map(([xRatio, yRatio]) => {
      const x = Math.round(rect.left + rect.width * xRatio);
      const y = Math.round(rect.top + rect.height * yRatio);
      const hit = document.elementFromPoint(x, y);
      return {
        x,
        y,
        hitTarget: hit === element || element.contains(hit),
        hitTestId: hit?.getAttribute('data-testid') ?? '',
      };
    });
    const point = hitSamples.find((sample) => sample.hitTarget) ?? hitSamples[0];
    return {
      ...point,
      width: rect.width,
      height: rect.height,
      disabled: element.disabled ?? false,
      visible: rect.width > 0 && rect.height > 0 && style.visibility === 'visible' && style.display !== 'none',
      hitSamples: hitSamples.map(({ x: sampleX, y: sampleY, hitTarget, hitTestId }) => ({
        x: sampleX,
        y: sampleY,
        hitTarget,
        hitTestId,
      })),
    };
  })()`);
  assert(point.visible, `${label} is not visible in the current viewport.`);
  assert(!point.disabled, `${label} is disabled.`);
  assert(
    point.hitTarget,
    `${label} has no pointer-accessible point within its visible bounds; sampled hit targets: ${JSON.stringify(point.hitSamples)}.`,
  );
  await sendPointerClick(window, point.x, point.y);
  await wait(80);
  return point;
}

async function pressFocusedControl(
  window,
  selector,
  keyCode,
  label = selector,
  { tabFromSelector } = {},
) {
  await waitForDom(
    window,
    `document.querySelector(${JSON.stringify(selector)})`,
    `${label} did not appear.`,
  );
  const focus = await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(tabFromSelector ?? selector)});
    element.focus();
    return {
      active: document.activeElement === element,
      visibleFocus: element.matches(':focus-visible'),
      bounds: (() => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      })(),
    };
  })()`);
  assert(focus.active, `${label} did not receive keyboard focus.`);
  let tabFocus = null;
  if (tabFromSelector) {
    await sendKeyStroke(window, 'TAB');
    tabFocus = await window.webContents.executeJavaScript(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      window.__issue797KeyboardEvents = [];
      for (const type of ['keydown', 'keyup', 'click']) {
        element.addEventListener(type, (event) => {
          window.__issue797KeyboardEvents.push({
            type,
            key: event.key ?? '',
            code: event.code ?? '',
            defaultPrevented: event.defaultPrevented,
            focused: document.activeElement === element,
          });
        }, { capture: true });
      }
      return {
        active: document.activeElement === element,
        visibleFocus: element.matches(':focus-visible'),
        activeTestId: document.activeElement?.getAttribute('data-testid') ?? '',
      };
    })()`);
    assert(
      tabFocus.active,
      `${label} was not reached from ${tabFromSelector} by native Tab input (active: ${tabFocus.activeTestId || 'unknown'}).`,
    );
  }
  await sendKeyStroke(window, keyCode);
  await wait(80);
  const afterActivation = await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    return {
      active: document.activeElement === element,
      visibleFocus: element.matches(':focus-visible'),
      keyboardEvents: window.__issue797KeyboardEvents ?? [],
      editTarget: document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.editTarget ?? '',
    };
  })()`);
  return { ...focus, tabFocus, afterActivation };
}

async function dragWithNativeInput(window, sourceSelector, destinationSelector, label) {
  await waitForDom(
    window,
    `document.querySelector(${JSON.stringify(sourceSelector)}) && document.querySelector(${JSON.stringify(destinationSelector)})`,
    `${label} did not expose both pointer locations.`,
  );
  const geometry = await window.webContents.executeJavaScript(`(() => {
    const source = document.querySelector(${JSON.stringify(sourceSelector)});
    const destination = document.querySelector(${JSON.stringify(destinationSelector)});
    source.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const sourceRect = source.getBoundingClientRect();
    const destinationRect = destination.getBoundingClientRect();
    const start = {
      x: Math.round(sourceRect.left + sourceRect.width / 2),
      y: Math.round(sourceRect.top + sourceRect.height / 2),
    };
    const end = {
      x: Math.round(destinationRect.left + destinationRect.width / 2),
      y: Math.round(destinationRect.top + destinationRect.height / 2),
    };
    const hit = document.elementFromPoint(start.x, start.y);
    const style = getComputedStyle(source);
    return {
      start,
      end,
      sourceBounds: { x: sourceRect.x, y: sourceRect.y, width: sourceRect.width, height: sourceRect.height },
      destinationBounds: { x: destinationRect.x, y: destinationRect.y, width: destinationRect.width, height: destinationRect.height },
      sourceVisible: sourceRect.width > 0 && sourceRect.height > 0 && style.visibility === 'visible',
      sourceHit: hit === source || source.contains(hit),
      hitTestId: hit?.getAttribute('data-testid') ?? '',
    };
  })()`);
  assert(geometry.sourceVisible, `${label} source is not visible.`);
  assert(geometry.sourceHit, `${label} source is covered at its visible center by ${geometry.hitTestId || 'another element'}.`);
  window.webContents.sendInputEvent({
    type: 'mouseMove',
    x: geometry.start.x,
    y: geometry.start.y,
  });
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    x: geometry.start.x,
    y: geometry.start.y,
    button: 'left',
    clickCount: 1,
  });
  window.webContents.sendInputEvent({
    type: 'mouseMove',
    x: geometry.end.x,
    y: geometry.end.y,
    button: 'left',
  });
  await wait(100);
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    x: geometry.end.x,
    y: geometry.end.y,
    button: 'left',
    clickCount: 1,
  });
  await wait(80);
  return geometry;
}

async function sendKeyStroke(window, keyCode) {
  const electronKeyCode = {
    ARROWDOWN: 'Down',
    ARROWUP: 'Up',
    ESC: 'Escape',
    ENTER: 'Return',
    TAB: 'Tab',
    SPACE: 'Space',
  }[keyCode] ?? keyCode;
  window.focus();
  window.webContents.focus();
  await wait(40);
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: electronKeyCode });
  await wait(40);
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: electronKeyCode });
}

function sendWindowsKeyStroke(window, key) {
  const sendKeysValue = key === 'ENTER' ? '{ENTER}' : key === 'SPACE' ? ' ' : null;
  assert(sendKeysValue !== null, `Unsupported Windows keyboard key ${key}.`);
  const command = `$targetPid = ${process.pid}; $shell = New-Object -ComObject WScript.Shell; if (-not $shell.AppActivate($targetPid)) { throw 'Could not activate the Electron verifier window.' }; Start-Sleep -Milliseconds 80; $shell.SendKeys('${sendKeysValue}')`;
  require('node:child_process').execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    { encoding: 'utf8', timeout: 5000, windowsHide: true },
  );
  window.focus();
  window.webContents.focus();
}

async function readIssue792MenuGeometry(window) {
  return window.webContents.executeJavaScript(`(() => {
    const trigger = document.querySelector('[data-testid="character-assembly-mouth-overflow-trigger"]');
    const picker = document.querySelector('[data-testid="character-assembly-mouth-picker-selected"]');
    const menu = document.querySelector('[data-testid="character-assembly-mouth-overflow-menu"]');
    const clear = menu?.querySelector('[data-testid="character-assembly-mouth-clear"]');
    const row = trigger?.closest('.image-asset-picker-selected-row--surface');
    const rect = (element) => {
      const bounds = element?.getBoundingClientRect();
      return bounds && {
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height,
      };
    };
    const viewport = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
    const menuBounds = menu?.getBoundingClientRect();
    const clearBounds = clear?.getBoundingClientRect();
    const centerX = clearBounds ? clearBounds.left + clearBounds.width / 2 : 0;
    const centerY = clearBounds ? clearBounds.top + clearBounds.height / 2 : 0;
    const hit = clear ? document.elementFromPoint(centerX, centerY) : null;
    const hitButton = hit?.closest('button');
    const clipAncestors = [];
    for (let ancestor = row; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (/(hidden|clip|auto|scroll)/u.test(style.overflowX + ' ' + style.overflowY)) {
        clipAncestors.push({
          className: typeof ancestor.className === 'string' ? ancestor.className : '',
          overflowX: style.overflowX,
          overflowY: style.overflowY,
        });
      }
    }
    return {
      viewport,
      trigger: rect(trigger),
      picker: rect(picker),
      row: rect(row),
      menu: rect(menu),
      clear: rect(clear),
      open: Boolean(menu?.matches(':popover-open')),
      visible: Boolean(menu && getComputedStyle(menu).display !== 'none' && getComputedStyle(menu).visibility === 'visible' && menu.getClientRects().length),
      position: menu ? getComputedStyle(menu).position : '',
      placement: menu?.dataset.placement ?? '',
      menuInsideViewport: Boolean(menuBounds
        && menuBounds.left >= 0
        && menuBounds.top >= 0
        && menuBounds.right <= viewport.width + 1
        && menuBounds.bottom <= viewport.height + 1),
      clearIsActualHitTarget: Boolean(clear && hit && (hit === clear || clear.contains(hit)) && hitButton === clear),
      hitTarget: hit ? {
        tagName: hit.tagName,
        className: typeof hit.className === 'string' ? hit.className : '',
        testId: hit.getAttribute('data-testid') ?? '',
      } : null,
      pickerAndOverflowAreSeparate: Boolean(rect(picker) && rect(trigger) && picker.getBoundingClientRect().right <= trigger.getBoundingClientRect().left + 1),
      clipAncestors,
      selectedMouthAssetId: document.querySelector('[data-testid="character-assembly-mouth-picker"]')?.dataset.selectedAssetId ?? '',
      ariaExpanded: trigger?.getAttribute('aria-expanded') ?? '',
      clearDisabled: clear?.disabled ?? null,
      pending: Boolean(document.querySelector('[data-testid="character-assembly-pending"]')),
      revision: document.querySelector('[data-testid="character-manager"] [data-project-revision]')?.dataset.projectRevision ?? '',
      undoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? '',
      focusVisible: document.activeElement instanceof HTMLElement && document.activeElement.matches(':focus-visible'),
      activeTestId: document.activeElement?.getAttribute('data-testid') ?? '',
    };
  })()`);
}

async function openIssue792MenuWithPointer(window) {
  const triggerRect = await window.webContents.executeJavaScript(`(() => {
    const trigger = document.querySelector('[data-testid="character-assembly-mouth-overflow-trigger"]');
    if (!trigger) throw new Error('Configured Mouth overflow trigger is missing.');
    const bounds = trigger.getBoundingClientRect();
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  })()`);
  await sendPointerClick(window, triggerRect.x, triggerRect.y);
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-mouth-overflow-menu"]')?.matches(':popover-open') && document.querySelector('[data-testid="character-assembly-mouth-overflow-trigger"]')?.getAttribute('aria-expanded') === 'true'`,
    'Mouth overflow popover did not open and update its trigger state after a real Electron pointer click.',
  );
  await wait(120);
}

async function verifyIssue812HeadMotionToggle(window, screenshots, readSelection, evidence) {
  const selector = '[data-testid="character-assembly-test-head-motion"]';
  const receipt = { profiles: [], screenshots: [] };
  evidence.headMotionToggle = receipt;
  const saveScreenshot = async (fileName) => {
    const screenshot = await capture(window, fileName);
    screenshots.push(screenshot);
    receipt.screenshots.push(screenshot);
  };

  const readLayout = () => window.webContents.executeJavaScript(`(() => {
    const rect = (element) => {
      const bounds = element?.getBoundingClientRect();
      return bounds && {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        right: bounds.right,
        bottom: bounds.bottom,
      };
    };
    const button = document.querySelector(${JSON.stringify(selector)});
    const workbench = document.querySelector('[data-testid="character-assembly-workbench"]');
    const actions = document.querySelector('.character-assembly-assembly-actions');
    const pending = document.querySelector('[data-testid="character-assembly-pending"]');
    const headGroup = document.querySelector('.character-assembly-head-group');
    const body = document.querySelector('.character-assembly-part-body');
    const pivot = document.querySelector('[data-testid="character-assembly-pivot-mode-toggle"]');
    const fineTune = document.querySelector('[data-testid="character-assembly-fine-tune-toggle"]');
    const layoutReuse = document.querySelector('[data-testid="character-assembly-layout-reuse-toggle"]');
    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        shellMode: document.querySelector('[data-testid="editor-layout"]')?.dataset.shellMode ?? '',
      },
      running: workbench?.dataset.headMotionTestRunning ?? '',
      pressed: button?.getAttribute('aria-pressed') ?? '',
      pivotDisabled: Boolean(pivot?.disabled),
      fineTuneDisabled: Boolean(fineTune?.disabled),
      layoutReuseDisabled: Boolean(layoutReuse?.disabled),
      label: button?.textContent?.trim() ?? '',
      accessibleName: button?.getAttribute('aria-label') ?? button?.innerText?.trim() ?? '',
      cueCount: document.querySelectorAll('[data-testid="character-assembly-motion-test-cue"]').length,
      headAnimationName: headGroup ? getComputedStyle(headGroup).animationName : '',
      headAnimationDuration: headGroup ? getComputedStyle(headGroup).animationDuration : '',
      bodyAnimationName: body ? getComputedStyle(body).animationName : '',
      focused: document.activeElement === button,
      visibleFocus: Boolean(button?.matches(':focus-visible')),
      order: [...(actions?.children ?? [])].map((element) =>
        element.dataset.testid ?? element.classList[0] ?? element.tagName.toLowerCase(),
      ),
      controls: {
        actions: rect(actions),
        pivot: rect(document.querySelector('[data-testid="character-assembly-pivot-mode-toggle"]')),
        fineTune: rect(document.querySelector('[data-testid="character-assembly-fine-tune-toggle"]')),
        layoutReuse: rect(document.querySelector('[data-testid="character-assembly-layout-reuse-toggle"]')),
        toggle: rect(button),
        pending: rect(pending),
        restore: rect(pending?.querySelector('button:first-child')),
        apply: rect(pending?.querySelector('button:last-child')),
      },
    };
  })()`);

  const assertState = (state, running, label) => {
    const expected = running ? '■ 停止测试' : '▶ 测试摇头';
    assert(state.running === String(running), `${label} did not expose the expected head-motion state.`);
    assert(state.pressed === String(running), `${label} lost the toggle's aria-pressed state.`);
    assert(state.label === expected && state.accessibleName === expected, `${label} lost its dynamic accessible button name.`);
    assert(state.cueCount === 0, `${label} inserted the removed motion explanation or an empty cue slot.`);
    if (running) {
      assert(state.headAnimationName === 'character-assembly-head-motion-test', `${label} did not run the existing Head motion animation.`);
      assert(state.headAnimationDuration === '0.9s', `${label} changed the existing 900 ms motion duration.`);
      assert(state.bodyAnimationName === 'none', `${label} animated the Body along with the Head group.`);
      assert(state.pivotDisabled && state.fineTuneDisabled && state.layoutReuseDisabled, `${label} did not keep pivot and layout editing mutually exclusive with motion testing.`);
    } else {
      assert(state.headAnimationName === 'none', `${label} did not stop and reset the Head motion animation.`);
      assert(!state.pivotDisabled && !state.fineTuneDisabled && !state.layoutReuseDisabled, `${label} left pivot or layout editing disabled after the motion test stopped.`);
    }
  };

  const compareGeometry = (baseline, state, profile, label) => {
    const keys = ['actions', 'pivot', 'fineTune', 'layoutReuse', 'toggle', 'pending', 'restore', 'apply'];
    const deltas = [];
    for (const key of keys) {
      const before = baseline.controls[key];
      const after = state.controls[key];
      assert(before && after, `${profile}/${label} is missing the ${key} control needed for the layout check.`);
      for (const dimension of ['x', 'y', 'width', 'height']) {
        const delta = Number((after[dimension] - before[dimension]).toFixed(3));
        deltas.push({ control: key, dimension, delta });
      }
    }
    const largest = Math.max(...deltas.map((entry) => Math.abs(entry.delta)));
    const result = { from: label, maximumDeltaCssPx: largest, deltas };
    receipt.profiles.find((entry) => entry.name === profile)?.geometryComparisons.push(result);
    assert(
      largest <= 2,
      `${profile}/${label} moved or resized an assembly action by ${largest.toFixed(2)} CSS px (limit 2): ${JSON.stringify(deltas.filter((entry) => Math.abs(entry.delta) > 2))}`,
    );
    assert(JSON.stringify(state.order) === JSON.stringify(baseline.order), `${profile}/${label} reordered or wrapped assembly actions.`);
  };

  const verifySamePointHit = async (point, zoomFactor, profile, cycle, running) => {
    const hit = await window.webContents.executeJavaScript(`(() => {
      const button = document.querySelector(${JSON.stringify(selector)});
      const target = document.elementFromPoint(${point.x / zoomFactor}, ${point.y / zoomFactor});
      return Boolean(button && target && (target === button || button.contains(target)));
    })()`);
    assert(hit, `${profile} cycle ${cycle} original pointer coordinate stopped hitting the same toggle (running=${running}).`);
  };

  const configurations = [
    { name: 'standard', width: 1660, height: 1100, zoomFactor: 1 },
    { name: 'narrow', width: 800, height: 560, zoomFactor: 1 },
    { name: 'zoom125', width: 1660, height: 1100, zoomFactor: 1.25 },
  ];
  const originalSize = window.getSize();
  const originalZoomFactor = window.webContents.getZoomFactor();
  const beforeProjectState = await readSelection();

  try {
    for (const configuration of configurations) {
      window.webContents.setZoomFactor(configuration.zoomFactor);
      window.setSize(configuration.width, configuration.height);
      if (configuration.name === 'narrow') {
        await waitForDom(window, 'window.innerWidth <= 840 && window.innerWidth >= 760', 'The #812 narrow-window viewport did not resize.');
      } else {
        await wait(160);
      }
      await window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'nearest', inline: 'nearest' })`);
      await waitForPaint(window);

      const profile = {
        name: configuration.name,
        zoomFactor: configuration.zoomFactor,
        windowSize: configuration.name === 'narrow' ? { width: 800, height: 560 } : { width: 1660, height: 1100 },
        states: [],
        geometryComparisons: [],
        samePointerCycles: [],
      };
      receipt.profiles.push(profile);
      const initial = await readLayout();
      profile.states.push({ name: 'initial', ...initial });
      assertState(initial, false, `${configuration.name}/initial`);
      assert(initial.viewport.width > 0 && initial.viewport.height > 0, `${configuration.name} did not expose a measurable viewport.`);
      assert(initial.controls.toggle && initial.controls.pivot && initial.controls.fineTune && initial.controls.layoutReuse, `${configuration.name} is missing one of the fixed assembly actions.`);
      assert(initial.controls.pending && initial.controls.restore && initial.controls.apply, `${configuration.name} lost the dirty-draft Restore/Apply controls.`);
      assert(initial.controls.toggle.x >= 0 && initial.controls.toggle.y >= 0 && initial.controls.toggle.right <= initial.viewport.width + 1 && initial.controls.toggle.bottom <= initial.viewport.height + 1, `${configuration.name} motion toggle is outside the visible viewport.`);
      assert(initial.controls.toggle.width > 0 && initial.controls.toggle.height > 0, `${configuration.name} motion toggle has an empty hitbox.`);
      profile.initial = initial;
      const cssAnchor = {
        x: initial.controls.toggle.x + initial.controls.toggle.width / 2,
        y: initial.controls.toggle.y + initial.controls.toggle.height / 2,
      };
      const anchor = {
        x: Math.round(cssAnchor.x * configuration.zoomFactor),
        y: Math.round(cssAnchor.y * configuration.zoomFactor),
      };
      profile.samePointerCycles.push({ inputX: anchor.x, inputY: anchor.y, cssX: cssAnchor.x, cssY: cssAnchor.y, cycles: 3 });
      if (configuration.name === 'standard') {
        await saveScreenshot('head-motion-toggle-standard-initial.png');
      } else if (configuration.name === 'narrow') {
        await saveScreenshot('head-motion-toggle-narrow.png');
      } else {
        await saveScreenshot('head-motion-toggle-zoom-125.png');
      }

      let previous = initial;
      for (let cycle = 1; cycle <= 3; cycle += 1) {
        await verifySamePointHit(anchor, configuration.zoomFactor, configuration.name, cycle, false);
        await sendPointerClick(window, anchor.x, anchor.y);
        await waitForDom(window, `document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.headMotionTestRunning === 'true'`, `${configuration.name} same-point cycle ${cycle} did not start.`);
        await waitForPaint(window);
        const playing = await readLayout();
        profile.states.push({ name: `play-${cycle}`, ...playing });
        if (configuration.name === 'standard' && cycle <= 2) {
          await saveScreenshot(`head-motion-toggle-standard-play-${cycle}.png`);
        } else if (cycle === 1) {
          await saveScreenshot(`head-motion-toggle-${configuration.name}-play.png`);
        }
        compareGeometry(initial, playing, configuration.name, `play-${cycle}`);
        assertState(playing, true, `${configuration.name}/play-${cycle}`);

        await verifySamePointHit(anchor, configuration.zoomFactor, configuration.name, cycle, true);
        await sendPointerClick(window, anchor.x, anchor.y);
        await waitForDom(window, `document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.headMotionTestRunning === 'false'`, `${configuration.name} same-point cycle ${cycle} did not stop.`);
        await waitForPaint(window);
        const stopped = await readLayout();
        profile.states.push({ name: `stop-${cycle}`, ...stopped });
        compareGeometry(initial, stopped, configuration.name, `stop-${cycle}`);
        assertState(stopped, false, `${configuration.name}/stop-${cycle}`);
        if (configuration.name === 'standard' && cycle <= 2) {
          await saveScreenshot(`head-motion-toggle-standard-stop-${cycle}.png`);
        } else if (cycle === 1) {
          await saveScreenshot(`head-motion-toggle-${configuration.name}-stop.png`);
        }
        previous = stopped;
      }
      assert(initial.controls.toggle.width >= 100 && initial.controls.toggle.height >= 44, `${configuration.name} motion toggle hitbox is below the 100×44 CSS px target.`);
      assert(previous.running === 'false', `${configuration.name} did not finish with the test stopped.`);
    }

    window.focus();
    window.webContents.focus();
    await window.webContents.executeJavaScript(`(() => {
      const button = document.querySelector(${JSON.stringify(selector)});
      window.__issue812KeyboardEvents = [];
      for (const type of ['keydown', 'keyup', 'click']) {
        button?.addEventListener(type, (event) => {
          window.__issue812KeyboardEvents.push({
            type,
            key: event.key ?? '',
            code: event.code ?? '',
            defaultPrevented: event.defaultPrevented,
            focused: document.activeElement === button,
            trusted: event.isTrusted,
          });
        }, { capture: true });
      }
      document.querySelector('[data-testid="character-assembly-layout-reuse-toggle"]')?.focus();
    })()`);
    await sendKeyStroke(window, 'TAB');
    const tabFocus = await window.webContents.executeJavaScript(`(() => {
      const button = document.querySelector(${JSON.stringify(selector)});
      return {
        focused: document.activeElement === button,
        visibleFocus: Boolean(button?.matches(':focus-visible')),
        activeTestId: document.activeElement?.getAttribute('data-testid') ?? '',
      };
    })()`);
    assert(tabFocus.focused && tabFocus.visibleFocus, `Native Tab did not move focus to the Head motion toggle with visible focus (active: ${tabFocus.activeTestId || 'unknown'}).`);

    for (const [key, running, expectedName] of [
      ['ENTER', true, 'enter-start'],
      ['SPACE', false, 'space-stop'],
    ]) {
      const eventStart = await window.webContents.executeJavaScript('window.__issue812KeyboardEvents.length');
      sendWindowsKeyStroke(window, key);
      try {
        await waitForDom(window, `document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.headMotionTestRunning === ${JSON.stringify(String(running))}`, `Keyboard ${key} did not ${running ? 'start' : 'stop'} the Head motion test.`);
      } catch (error) {
        const diagnostics = await window.webContents.executeJavaScript(`({
          activeTestId: document.activeElement?.getAttribute('data-testid') ?? '',
          events: (window.__issue812KeyboardEvents ?? []).slice(${eventStart}),
          state: document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.headMotionTestRunning ?? '',
        })`);
        throw new Error(`${error instanceof Error ? error.message : String(error)}; keyboard=${JSON.stringify(diagnostics)}`, { cause: error });
      }
      await waitForPaint(window);
      const state = await readLayout();
      const events = await window.webContents.executeJavaScript(`(window.__issue812KeyboardEvents ?? []).slice(${eventStart})`);
      const profile = receipt.profiles.find((entry) => entry.name === 'zoom125');
      profile.states.push({ name: expectedName, ...state });
      compareGeometry(profile.initial, state, 'zoom125', expectedName);
      assertState(state, running, `keyboard/${expectedName}`);
      assert(state.focused && state.visibleFocus, `Keyboard ${key} lost button focus or its visible focus indication.`);
      assert(events.some((event) => event.type === 'keydown' && event.key === inputKeyName(key) && event.trusted), `Native Windows keyboard ${key} did not reach the focused button.`);
      assert(events.some((event) => event.type === 'click' && event.trusted), `Native Windows keyboard ${key} did not activate the focused button.`);
      (profile.keyboard ??= []).push({ key, events });
    }

    const afterProjectState = await readSelection();
    assert(afterProjectState.revision === beforeProjectState.revision && afterProjectState.undoCount === beforeProjectState.undoCount, 'Testing Head motion wrote a Project revision or History entry.');
    assert(afterProjectState.headOffsetX === beforeProjectState.headOffsetX && afterProjectState.headOffsetY === beforeProjectState.headOffsetY && afterProjectState.headScale === beforeProjectState.headScale && afterProjectState.faceOffsetX === beforeProjectState.faceOffsetX && afterProjectState.faceOffsetY === beforeProjectState.faceOffsetY && afterProjectState.faceScale === beforeProjectState.faceScale && afterProjectState.pivotX === beforeProjectState.pivotX && afterProjectState.pivotY === beforeProjectState.pivotY, 'Testing Head motion changed Head, Face, or pivot draft data.');
    receipt.projectState = { before: beforeProjectState, after: afterProjectState };
    return receipt;
  } finally {
    window.webContents.setZoomFactor(originalZoomFactor);
    window.setSize(originalSize[0], originalSize[1]);
    await wait(120);
  }
}

function inputKeyName(key) {
  return key === 'SPACE' ? ' ' : key === 'ENTER' ? 'Enter' : key;
}

async function verifyIssue797HeadFaceEditTargets(window) {
  const screenshots = [];
  const evidence = {};
  inProgressEvidence = evidence;
  await window.webContents.executeJavaScript(`(() => {
    window.__issue610ConfirmCalls = [];
    window.__issue610ConfirmResponse = false;
    window.confirm = (message) => {
      window.__issue610ConfirmCalls.push(String(message));
      return Boolean(window.__issue610ConfirmResponse);
    };
  })()`);

  await clickWithNativeInput(
    window,
    `[data-testid="character-list-view"] [data-character-id="${IDS.issue792Character}"]`,
    'Head + Face Character card',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-detail-view"]')?.dataset.characterEditorId === ${JSON.stringify(IDS.issue792Character)}`,
    'Head + Face Character detail did not open.',
  );
  await clickWithNativeInput(
    window,
    '[data-testid="character-workspace-assembly-tab"]',
    'Assembly workspace tab',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-workbench"][data-session-kind="edit"]')`,
    'Head + Face Character did not enter the Assembly Workbench.',
  );

  const readSelection = () => window.webContents.executeJavaScript(`(() => {
    const workbench = document.querySelector('[data-testid="character-assembly-workbench"]');
    const head = document.querySelector('[data-testid="character-assembly-head-asset-selected"]');
    const face = document.querySelector('[data-testid="character-assembly-default-face-select"]');
    const headAction = document.querySelector('[data-testid="character-assembly-head-asset-change-action"]');
    const faceManage = document.querySelector('[data-testid="character-assembly-go-expressions"]');
    const rect = (element) => {
      const bounds = element?.getBoundingClientRect();
      return bounds && { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    };
    return {
      target: workbench?.dataset.editTarget ?? '',
      faceOffsetX: Number(workbench?.dataset.faceOffsetX),
      faceOffsetY: Number(workbench?.dataset.faceOffsetY),
      faceScale: Number(workbench?.dataset.faceScale),
      headAssetId: workbench?.dataset.headAssetId ?? '',
      headOffsetX: Number(workbench?.dataset.headOffsetX),
      headOffsetY: Number(workbench?.dataset.headOffsetY),
      headScale: Number(workbench?.dataset.headScale),
      pivotX: Number(workbench?.dataset.headPivotX),
      pivotY: Number(workbench?.dataset.headPivotY),
      headCardPressed: head?.getAttribute('aria-pressed') ?? '',
      faceCardPressed: face?.getAttribute('aria-pressed') ?? '',
      headCardBounds: rect(head),
      faceCardBounds: rect(face),
      headActionBounds: rect(headAction),
      faceManageBounds: rect(faceManage),
      headActionSibling: Boolean(head && document.querySelector('[data-testid="character-assembly-head-asset-change-action"]')?.parentElement === head.parentElement),
      faceManageSibling: Boolean(face && document.querySelector('[data-testid="character-assembly-go-expressions"]')?.parentElement === face.parentElement),
      headActionNested: Boolean(head?.querySelector('[data-testid="character-assembly-head-asset-change-action"]')),
      faceManageNested: Boolean(face?.querySelector('[data-testid="character-assembly-go-expressions"]')),
      revision: document.querySelector('[data-testid="character-manager"] [data-project-revision]')?.dataset.projectRevision ?? '',
      undoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? '',
      faceTargetPresent: Boolean(document.querySelector('[data-testid="character-assembly-face-drag-target"]')),
      headTargetPresent: Boolean(document.querySelector('[data-testid="character-assembly-head-drag-target"]')),
      pivotEditing: workbench?.dataset.neckPivotEditing ?? '',
      headMotionRunning: workbench?.dataset.headMotionTestRunning ?? '',
      editCardSurface: face?.parentElement ? getComputedStyle(face.parentElement).borderColor : '',
      headSurfaceBorder: head?.parentElement ? getComputedStyle(head.parentElement).borderColor : '',
      headSurfaceBackground: head?.parentElement ? getComputedStyle(head.parentElement).backgroundColor : '',
      faceSurfaceBorder: face?.parentElement ? getComputedStyle(face.parentElement).borderColor : '',
      faceSurfaceBackground: face?.parentElement ? getComputedStyle(face.parentElement).backgroundColor : '',
      headEditTargetStatus: head?.querySelector('.image-asset-picker-selected-action')?.textContent?.trim() ?? '',
      faceEditTargetStatus: face?.querySelector('.image-asset-picker-selected-action')?.textContent?.trim() ?? '',
      headOptionalLabel: head?.closest('.image-asset-picker')?.querySelector('.image-asset-picker-heading small')?.textContent?.trim() ?? '',
    };
  })()`);

  const before = await readSelection();
  assert(before.target === 'head' && before.headCardPressed === 'true' && before.faceCardPressed === 'false', 'Initial Head selection is not synchronized across the left card and Workbench.');
  assert(before.headActionSibling && before.faceManageSibling && !before.headActionNested && !before.faceManageNested, 'Head Change and Face Manage are not separate sibling actions.');
  assert(before.headCardBounds?.height >= 44 && before.faceCardBounds?.height >= 44, 'Head/Face selection cards lost usable keyboard and touch target sizes.');
  assert(before.headActionBounds?.height >= 44 && before.headActionBounds?.height <= 52 && before.faceManageBounds?.height >= 44 && before.faceManageBounds?.height <= 52, 'Head Change and Face Manage are not compact 44px actions.');
  assert(!before.headEditTargetStatus && !before.faceEditTargetStatus && !before.headOptionalLabel, 'Assembly still displays the redundant Head optional or Head/Face edit badge.');
  assert(before.headSurfaceBorder !== before.faceSurfaceBorder && before.headSurfaceBackground !== before.faceSurfaceBackground, 'The selected Head surface is not visually distinct from the Face surface.');
  assert(before.headTargetPresent && !before.faceTargetPresent, 'The initial Head target did not expose only its own drag handle.');
  await waitForPaint(window);
  const beforeShot = await capture(window, 'head-face-before.png');
  screenshots.push(beforeShot);

  const faceMouseClick = await clickWithNativeInput(
    window,
    '[data-testid="character-assembly-default-face-select"]',
    'Default Face card body',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.editTarget === 'face'`,
    'Clicking the Face card body did not select the Face placement target.',
  );
  const faceSelected = await readSelection();
  assert(faceSelected.faceCardPressed === 'true' && faceSelected.headCardPressed === 'false', 'Face selection state did not synchronize back to the left cards.');
  assert(faceSelected.faceSurfaceBorder === before.headSurfaceBorder && faceSelected.faceSurfaceBackground === before.headSurfaceBackground, 'Selecting Face did not move the full-card highlight to the Face surface.');
  assert(faceSelected.headSurfaceBorder === before.faceSurfaceBorder && faceSelected.headSurfaceBackground === before.faceSurfaceBackground, 'Selecting Face left the Head surface highlighted.');
  assert(faceSelected.faceTargetPresent && !faceSelected.headTargetPresent, 'Selecting Face did not expose only the Face drag handle.');
  assert(faceSelected.revision === before.revision && faceSelected.undoCount === before.undoCount, 'Selecting an edit target wrote the Project or History.');

  const faceDragGeometry = await dragWithNativeInput(
    window,
    '[data-testid="character-assembly-face-drag-target"]',
    '.character-assembly-part-head',
    'Face placement drag to the Head position',
  );
  await waitForDom(
    window,
    `(() => {
      const workbench = document.querySelector('[data-testid="character-assembly-workbench"]');
      return Math.abs(Number(workbench?.dataset.faceOffsetY) - Number(workbench?.dataset.headOffsetY)) < 12;
    })()`,
    'Native Face drag did not move Face into the Head position.',
  );
  const faceDragged = await readSelection();
  assert(faceDragged.target === 'face', 'Face drag lost the Face edit target.');
  assert(faceDragged.headOffsetX === before.headOffsetX && faceDragged.headOffsetY === before.headOffsetY && faceDragged.headScale === before.headScale && faceDragged.pivotX === before.pivotX && faceDragged.pivotY === before.pivotY, 'Face drag changed Head placement or pivot.');
  assert(faceDragged.faceOffsetY !== before.faceOffsetY, 'Face drag did not update facePlacement.');
  assert(faceDragged.faceOffsetX === before.faceOffsetX && faceDragged.faceScale === before.faceScale, 'Face drag changed placement values outside the dragged axis.');
  assert(faceDragged.revision === before.revision && faceDragged.undoCount === before.undoCount, 'Unapplied Face drag wrote the Project or History.');
  await waitForPaint(window);
  const afterFaceShot = await capture(window, 'head-face-face-selected-dragged.png');
  screenshots.push(afterFaceShot);

  const faceKeyboardFocus = await pressFocusedControl(
    window,
    '[data-testid="character-assembly-head-asset-selected"]',
    'SPACE',
    'Head card body keyboard activation',
    { tabFromSelector: '[data-testid="character-assembly-body-picker-selected"]' },
  );
  try {
    await waitForDom(
      window,
      `document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.editTarget === 'head'`,
      'Keyboard activation did not select Head.',
    );
  } catch (error) {
    const keyboardEvidence = await window.webContents.executeJavaScript(
      'window.__issue797KeyboardEvents ?? []',
    );
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message} Keyboard input evidence: ${JSON.stringify(keyboardEvidence)}`,
      { cause: error },
    );
  }
  const headSelectedByKeyboard = await readSelection();
  assert(headSelectedByKeyboard.headCardPressed === 'true' && headSelectedByKeyboard.faceCardPressed === 'false', 'Keyboard Head selection did not synchronize the cards.');
  assert(faceKeyboardFocus.afterActivation.visibleFocus, 'Keyboard activation did not preserve a visible focus indication.');
  assert(headSelectedByKeyboard.faceOffsetY === faceDragged.faceOffsetY, 'Switching to Head changed the Face placement.');

  const headDragGeometry = await dragWithNativeInput(
    window,
    '[data-testid="character-assembly-head-drag-target"]',
    '.character-assembly-part-body',
    'Head placement drag',
  );
  await waitForDom(
    window,
    `Number(document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.headOffsetY) !== ${JSON.stringify(before.headOffsetY)}`,
    'Native Head drag did not update Head placement.',
  );
  const headDragged = await readSelection();
  assert(headDragged.target === 'head', 'Head drag lost the Head edit target.');
  assert(headDragged.faceOffsetX === faceDragged.faceOffsetX && headDragged.faceOffsetY === faceDragged.faceOffsetY && headDragged.faceScale === faceDragged.faceScale, 'Head drag changed Face Placement.');
  assert(headDragged.revision === before.revision && headDragged.undoCount === before.undoCount, 'Unapplied Head drag wrote the Project or History.');

  await clickWithNativeInput(window, '[data-testid="character-assembly-pivot-mode-toggle"]', 'Neck pivot mode');
  await waitForDom(window, `document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.neckPivotEditing === 'true'`, 'Neck pivot mode did not activate.');
  await clickWithNativeInput(window, '[data-testid="character-assembly-default-face-select"]', 'Face card while editing the neck pivot');
  await waitForDom(window, `document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.editTarget === 'face' && document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.neckPivotEditing === 'false'`, 'Switching to Face did not safely exit neck pivot editing.');
  const afterPivotSwitch = await readSelection();
  assert(afterPivotSwitch.pivotX === before.pivotX && afterPivotSwitch.pivotY === before.pivotY, 'Switching edit target during pivot mode changed the pivot draft.');

  await clickWithNativeInput(window, '[data-testid="character-assembly-test-head-motion"]', 'Test Head Motion');
  await waitForDom(window, `document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.headMotionTestRunning === 'true'`, 'Head motion test did not start.');
  await clickWithNativeInput(window, '[data-testid="character-assembly-head-asset-selected"]', 'Head card during Head motion test');
  await waitForDom(window, `document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.editTarget === 'head' && document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.headMotionTestRunning === 'false'`, 'Switching to Head did not safely stop the Head motion test.');
  const afterMotionSwitch = await readSelection();
  assert(afterMotionSwitch.headOffsetX === headDragged.headOffsetX && afterMotionSwitch.headOffsetY === headDragged.headOffsetY && afterMotionSwitch.pivotX === before.pivotX && afterMotionSwitch.pivotY === before.pivotY, 'Switching out of Head motion test changed Head placement or pivot.');

  const headMotionToggle = await verifyIssue812HeadMotionToggle(window, screenshots, readSelection, evidence);

  await clickWithNativeInput(window, '[data-testid="character-assembly-default-face-select"]', 'Select Face before changing the Head asset');
  await waitForDom(window, `document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.editTarget === 'face'`, 'Face target did not activate before Head asset replacement.');
  await clickWithNativeInput(window, '[data-testid="character-assembly-head-asset-change-action"]', 'Head Change action');
  await waitForDom(window, `document.querySelector('[data-testid="character-assembly-head-asset-candidates"]')`, 'Head Change did not open the asset picker.');
  await clickWithNativeInput(
    window,
    `[data-testid="character-assembly-head-asset-candidates"] [data-asset-id="${IDS.bodyAlt}"]`,
    'Choose replacement Head asset',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.headAssetId === ${JSON.stringify(IDS.bodyAlt)} && document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.editTarget === 'face'`,
    'Head Change did not replace only the asset while preserving the Face edit target.',
  );
  const afterChangeAction = await readSelection();
  assert(afterChangeAction.faceCardPressed === 'true' && afterChangeAction.headCardPressed === 'false', 'Head Change caused an extra Head card selection side effect.');
  assert(afterChangeAction.faceOffsetY === faceDragged.faceOffsetY, 'Changing the Head asset changed the Face draft.');

  await clickWithNativeInput(window, '[data-testid="character-assembly-pending"] button:first-of-type', 'Revert assembly draft');
  await waitForDom(
    window,
    `!document.querySelector('[data-testid="character-assembly-pending"]') && document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.editTarget === 'head' && document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.headAssetId === ${JSON.stringify(IDS.issue792Head)}`,
    'Revert did not restore the stored Head/Face placements and default Head selection.',
  );
  const reverted = await readSelection();
  assert(reverted.faceOffsetY === before.faceOffsetY && reverted.headOffsetY === before.headOffsetY && reverted.headCardPressed === 'true' && reverted.faceCardPressed === 'false', 'Revert did not restore placements and synchronized selection state.');
  assert(reverted.revision === before.revision && reverted.undoCount === before.undoCount, 'Revert wrote the Project or History.');

  await clickWithNativeInput(window, '[data-testid="character-assembly-go-expressions"]', 'Manage default Face action');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-workspace-expressions-tab"]')?.getAttribute('aria-pressed') === 'true' && !document.querySelector('[data-testid="character-assembly-workbench"]')`,
    'Manage did not open Expressions independently of the Face card body.',
  );
  const afterManage = await window.webContents.executeJavaScript(`({
    expressionWorkspace: document.querySelector('[data-testid="character-workspace-expressions-tab"]')?.getAttribute('aria-pressed') ?? '',
    assemblyWorkbench: Boolean(document.querySelector('[data-testid="character-assembly-workbench"]')),
    revision: document.querySelector('[data-testid="character-manager"] [data-project-revision]')?.dataset.projectRevision ?? '',
    undoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? '',
  })`);
  assert(afterManage.expressionWorkspace === 'true' && !afterManage.assemblyWorkbench, 'Manage performed an action other than opening Expressions.');
  assert(afterManage.revision === before.revision && afterManage.undoCount === before.undoCount, 'Manage wrote the Project or History.');

  await clickWithNativeInput(window, '[data-testid="character-workspace-assembly-tab"]', 'Reopen Assembly after Manage');
  await waitForDom(window, `document.querySelector('[data-testid="character-assembly-workbench"][data-edit-target="head"]')`, 'A new Assembly session did not start on Head.');
  await clickWithNativeInput(window, '[data-testid="character-detail-back"]', 'Return to Character list');
  await waitForDom(window, `document.querySelector('[data-testid="character-list-view"] [data-character-id="${IDS.issue797HeadlessCharacter}"]')`, 'Headless composite Character did not appear in the list.');
  await clickWithNativeInput(
    window,
    `[data-testid="character-list-view"] [data-character-id="${IDS.issue797HeadlessCharacter}"]`,
    'Headless composite Character card',
  );
  await waitForDom(window, `document.querySelector('[data-testid="character-detail-view"]')?.dataset.characterEditorId === ${JSON.stringify(IDS.issue797HeadlessCharacter)}`, 'Headless composite Character detail did not open.');
  await clickWithNativeInput(window, '[data-testid="character-workspace-assembly-tab"]', 'Headless Assembly workspace tab');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-workbench"][data-edit-target="face"]') && document.querySelector('[data-testid="character-assembly-face-drag-target"]') && !document.querySelector('[data-testid="character-assembly-edit-head"]')`,
    'A Headless Character did not expose Face editing without a Head target.',
  );
  const headlessBefore = await readSelection();
  assert(headlessBefore.target === 'face' && headlessBefore.faceCardPressed === 'true', 'The Headless Character did not select Face by default.');
  const headlessDrag = await dragWithNativeInput(
    window,
    '[data-testid="character-assembly-face-drag-target"]',
    '.character-assembly-part-body',
    'Headless Character Face placement drag',
  );
  await waitForDom(
    window,
    `Number(document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.faceOffsetY) !== ${JSON.stringify(headlessBefore.faceOffsetY)}`,
    'The Headless Character Face could not be dragged.',
  );
  const headlessAfter = await readSelection();
  assert(headlessAfter.target === 'face' && headlessAfter.faceTargetPresent && !headlessAfter.headTargetPresent, 'The Headless Character exposed the wrong placement target.');
  assert(headlessAfter.revision === before.revision && headlessAfter.undoCount === before.undoCount, 'Headless Face drag wrote the Project or History.');
  await waitForPaint(window);
  screenshots.push(await capture(window, 'head-face-headless-face-dragged.png'));

  evidence.headCharacter = {
    initial: before,
    cardMouseInput: faceMouseClick,
    faceSelection: faceSelected,
    faceDrag: { geometry: faceDragGeometry, after: faceDragged },
    keyboard: { focus: faceKeyboardFocus, selection: headSelectedByKeyboard },
    headDrag: { geometry: headDragGeometry, after: headDragged },
    pivotSafeSwitch: afterPivotSwitch,
    motionTestSafeSwitch: afterMotionSwitch,
    motionToggleStability: headMotionToggle,
    independentChangeAction: afterChangeAction,
    revert: reverted,
    independentManageAction: afterManage,
  };
  evidence.headlessCharacter = {
    before: headlessBefore,
    drag: { geometry: headlessDrag, after: headlessAfter },
  };
  return {
    issue: 797,
    passed: true,
    commit: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    verificationGate: 'verify:issue797-head-face-edit',
    projectRoot,
    syntheticInput: true,
    humanAcceptance: false,
    evidenceKind: 'real-electron-production-ui-native-mouse-keyboard-input-isolated-placement-targets-and-live-hit-tests',
    preflightAcknowledgement: {
      issueBody: true,
      draftPrAndIssueRoute: true,
      designMdAndCurrentCharacterUiInspected: true,
    },
    evidence,
    screenshots,
  };
}

async function readIssue798PlacementNavigation(window) {
  return window.webContents.executeJavaScript(`(() => {
    const detail = document.querySelector('[data-testid="character-detail-view"]');
    const navigation = detail?.querySelector('.character-detail-navigation-detail');
    const placement = detail?.querySelector('[data-testid="character-detail-place-current-shot"]');
    const back = detail?.querySelector('[data-testid="character-detail-back"]');
    const close = detail?.querySelector('[data-testid="resource-activity-close"]');
    const identity = detail?.querySelector('.character-detail-identity');
    const name = identity?.querySelector('.character-detail-identity-title-row h3');
    const quickActionDrawer = document.querySelector('[data-testid="quick-action-drawer"]');
    const quickActionHandle = quickActionDrawer?.querySelector('.quick-action-drawer-handle');
    const bounds = (element) => {
      const rect = element?.getBoundingClientRect();
      return rect && {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const placementBounds = placement?.getBoundingClientRect();
    const quickActionHandleBounds = quickActionHandle?.getBoundingClientRect();
    const hit = placementBounds
      ? document.elementFromPoint(
          placementBounds.left + placementBounds.width / 2,
          placementBounds.top + placementBounds.height / 2,
        )
      : null;
    const quickActionHandleHit = quickActionHandleBounds
      ? document.elementFromPoint(
          quickActionHandleBounds.left + quickActionHandleBounds.width / 2,
          quickActionHandleBounds.top + quickActionHandleBounds.height / 2,
        )
      : null;
    const workspaceTabs = [...(detail?.querySelectorAll('[data-testid="character-workspace-switcher"] button') ?? [])];
    return {
      viewport: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
      shellMode: document.querySelector('[data-testid="editor-layout"]')?.dataset.shellMode ?? '',
      presentation: detail?.dataset.characterEditorPresentation ?? '',
      navigation: bounds(navigation),
      navigationPosition: navigation ? getComputedStyle(navigation).position : '',
      navigationDisplay: navigation ? getComputedStyle(navigation).display : '',
      navigationGridTemplateColumns: navigation ? getComputedStyle(navigation).gridTemplateColumns : '',
      navigationInFlowChildCount: [...(navigation?.children ?? [])].filter((child) => {
        const position = getComputedStyle(child).position;
        return position !== 'absolute' && position !== 'fixed';
      }).length,
      navigationChildren: [...(navigation?.children ?? [])].map((child) => {
        const style = getComputedStyle(child);
        return {
          testId: child.getAttribute('data-testid') ?? '',
          className: child.className?.baseVal ?? child.className ?? '',
          position: style.position,
          gridColumn: style.gridColumn,
          width: child.getBoundingClientRect().width,
          height: child.getBoundingClientRect().height,
        };
      }),
      navigationBackgroundColor: navigation ? getComputedStyle(navigation).backgroundColor : '',
      quickActionDrawer: quickActionDrawer ? {
        bounds: bounds(quickActionDrawer),
        expanded: quickActionDrawer.dataset.expanded ?? '',
        zIndex: getComputedStyle(quickActionDrawer).zIndex,
        pointerEvents: getComputedStyle(quickActionDrawer).pointerEvents,
        handle: bounds(quickActionHandle),
        handleHitTarget: Boolean(quickActionHandle && quickActionHandleHit
          && (quickActionHandleHit === quickActionHandle || quickActionHandle.contains(quickActionHandleHit))),
      } : null,
      back: bounds(back),
      placement: bounds(placement),
      placementFlex: placement ? getComputedStyle(placement).flex : '',
      placementMarginLeft: placement ? getComputedStyle(placement).marginLeft : '',
      close: bounds(close),
      placementCount: detail?.querySelectorAll('[data-testid="character-detail-place-current-shot"]').length ?? 0,
      placementInIdentity: Boolean(identity?.contains(placement)),
      placementBeforeClose: Boolean(navigation && placement && close
        && [...navigation.children].indexOf(placement) < [...navigation.children].indexOf(close)),
      placementHitTarget: Boolean(placement && hit && (hit === placement || placement.contains(hit))),
      placementHitTestId: hit?.getAttribute('data-testid') ?? '',
      placementDisabled: placement?.disabled ?? null,
      placementTitle: placement?.getAttribute('title') ?? '',
      placementLabel: placement?.getAttribute('aria-label') ?? '',
      placementType: placement?.getAttribute('type') ?? '',
      placementText: placement?.textContent?.trim() ?? '',
      name: name?.textContent?.trim() ?? '',
      nameBounds: bounds(name),
      nameClientWidth: name?.clientWidth ?? 0,
      nameScrollWidth: name?.scrollWidth ?? 0,
      expressionActionInIdentity: Boolean(identity?.querySelector('[data-testid="expression-add-trigger"]')),
      workspaceTabs: workspaceTabs.map((button) => ({
        label: button.textContent?.trim() ?? '',
        pressed: button.getAttribute('aria-pressed') ?? '',
      })),
      activeWorkspace: workspaceTabs.find((button) => button.getAttribute('aria-pressed') === 'true')?.getAttribute('data-testid') ?? '',
      revision: document.querySelector('[data-testid="character-manager"] [data-project-revision]')?.dataset.projectRevision ?? '',
      undoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? '',
      redoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.redoCount ?? '',
    };
  })()`);
}

async function readIssue798PlacementState(window) {
  return window.webContents.executeJavaScript(`(() => {
    const stage = document.querySelector('[data-testid="project-canvas-stage"]');
    return {
      revision: document.querySelector('[data-testid="character-manager"] [data-project-revision]')?.dataset.projectRevision ?? '',
      undoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? '',
      redoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.redoCount ?? '',
      layers: JSON.parse(stage?.dataset.layerJson ?? '[]'),
    };
  })()`);
}

function assertCompactPlacementNavigation(geometry, label) {
  assert(geometry.navigationDisplay === 'flex', `${label} navigation is not laid out against its visible Flex children.`);
  assert(geometry.navigationInFlowChildCount === 3, `${label} navigation does not have exactly the in-flow Back/Add/Close controls.`);
  assert(geometry.placement?.width <= 120, `${label} Add to Shot grew wider than its label (${geometry.placement?.width}px).`);
  assert(geometry.placementFlex === '0 0 auto', `${label} Add to Shot can still grow to fill the navigation.`);
  assert(Math.abs(geometry.navigation.right - geometry.close.right) < 1, `${label} Close is not anchored to the far-right edge.`);
  assert(geometry.back.right <= geometry.placement.left + 1 && geometry.placement.right <= geometry.close.left + 1, `${label} Back, Add to Shot, and Close overlap or are out of order.`);
  assert(geometry.placement?.width >= 44 && geometry.placement?.height >= 44, `${label} Add to Shot is below the 44px touch target size.`);
  assert(geometry.back?.width >= 44 && geometry.back?.height >= 44 && geometry.close?.width >= 44 && geometry.close?.height >= 44, `${label} Back or Close is below the 44px touch target size.`);
  assert(geometry.placementHitTarget, `${label} Add to Shot center is not an actionable hit target.`);
  const handle = geometry.quickActionDrawer?.handle;
  if (handle) {
    const overlapsNavigation = handle.left < geometry.navigation.right
      && handle.right > geometry.navigation.left
      && handle.top < geometry.navigation.bottom
      && handle.bottom > geometry.navigation.top;
    assert(!overlapsNavigation, `${label} Quick Actions handle overlaps the Character navigation hit targets.`);
    assert(geometry.quickActionDrawer.handleHitTarget, `${label} Quick Actions handle is no longer reachable.`);
  }
}

async function verifyIssue798AddToShotNavigation(window) {
  const screenshots = [];
  const evidence = {};
  inProgressEvidence.issue798 = evidence;
  await window.webContents.executeJavaScript(`(() => {
    window.__issue610ConfirmCalls = [];
    window.__issue610ConfirmResponse = false;
    window.confirm = (message) => {
      window.__issue610ConfirmCalls.push(String(message));
      return Boolean(window.__issue610ConfirmResponse);
    };
  })()`);

  await clickWithNativeInput(
    window,
    `[data-testid="character-list-view"] [data-character-id="${IDS.issue792Character}"]`,
    'Issue #798 long-name composite Character card',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-detail-view"]')?.dataset.characterEditorId === ${JSON.stringify(IDS.issue792Character)}`,
    'Issue #798 composite Character detail did not open.',
  );

  const expectedName = '角色详情导航长名称验收熊猫';
  const wide = await readIssue798PlacementNavigation(window);
  evidence.wide = wide;
  assert(wide.shellMode === 'landscape' && wide.presentation === 'landscape', 'Issue #798 did not open the Cloud Touch landscape Character drawer.');
  assert(wide.workspaceTabs.length === 3, 'The composite Character did not expose Assembly, Expressions, and Settings.');
  assert(wide.name === expectedName, 'The long Character name was altered in the identity region.');
  assert(wide.placementCount === 1 && !wide.placementInIdentity, 'Add to Shot is missing, duplicated, or still inside the avatar identity region.');
  assert(wide.placementBeforeClose, 'Add to Shot is not immediately before Close in the shared detail navigation.');
  assert(wide.placementType === 'button' && wide.placementLabel === '加入当前镜头' && wide.placementText === '＋ 加入镜头', 'Add to Shot lost its native button semantics or clear accessible name.');
  assert(wide.placementTitle === '加入当前镜头' && !wide.placementDisabled, 'The enabled Add to Shot action lost its tooltip or became unavailable.');
  assertCompactPlacementNavigation(wide, 'Wide');
  await waitForPaint(window);
  screenshots.push(await capture(window, 'character-detail-add-to-shot-wide.png'));

  const originalZoomFactor = window.webContents.getZoomFactor();
  window.webContents.setZoomFactor(1.25);
  await waitForPaint(window);
  const zoomed = await readIssue798PlacementNavigation(window);
  evidence.zoomed = zoomed;
  assertCompactPlacementNavigation(zoomed, '125% zoom');
  await waitForPaint(window);
  screenshots.push(await capture(window, 'character-detail-add-to-shot-zoom-125.png'));
  window.webContents.setZoomFactor(originalZoomFactor);
  await waitForPaint(window);

  const workspaceEvidence = [];
  evidence.workspaceNavigation = workspaceEvidence;
  let sharedBounds = wide.placement;
  for (const [testId, label, expectedExpressionAction] of [
    ['character-workspace-assembly-tab', 'Assembly', false],
    ['character-workspace-expressions-tab', 'Expressions', true],
    ['character-workspace-settings-tab', 'Settings', false],
  ]) {
    await clickWithNativeInput(window, `[data-testid="${testId}"]`, `${label} workspace tab`);
    await waitForDom(
      window,
      `document.querySelector('[data-testid="${testId}"]')?.getAttribute('aria-pressed') === 'true'`,
      `${label} workspace did not activate.`,
    );
    const current = await readIssue798PlacementNavigation(window);
    const sameBounds = current.placement && sharedBounds
      && Math.abs(current.placement.left - sharedBounds.left) < 1
      && Math.abs(current.placement.top - sharedBounds.top) < 1
      && Math.abs(current.placement.width - sharedBounds.width) < 1
      && Math.abs(current.placement.height - sharedBounds.height) < 1;
    workspaceEvidence.push({
      workspace: label,
      activeWorkspace: current.activeWorkspace,
      bounds: current.placement,
      expressionActionInIdentity: current.expressionActionInIdentity,
      nameClientWidth: current.nameClientWidth,
      nameScrollWidth: current.nameScrollWidth,
    });
    assertCompactPlacementNavigation(current, `${label} workspace`);
    if (label === 'Settings') {
      await waitForPaint(window);
      screenshots.push(await capture(window, 'character-detail-add-to-shot-settings.png'));
    }
    assert(current.placementCount === 1 && !current.placementInIdentity && current.placementBeforeClose, `${label} moved or duplicated Add to Shot.`);
    assert(current.expressionActionInIdentity === expectedExpressionAction, `${label} showed the Add Expression action in the wrong workspace.`);
    assert(sameBounds, `${label} changed Add to Shot geometry; the nav action is not in a shared location.`);
    assert(current.placementHitTarget, `${label} made Add to Shot miss its native pointer hit target.`);
    if (label === 'Settings') {
      assert(current.nameScrollWidth <= current.nameClientWidth + 1, 'The long Character name is visually truncated in Settings with Add to Shot moved out of identity.');
    }
  }

  await clickWithNativeInput(window, '[data-testid="character-workspace-settings-tab"]', 'Settings before pending-transform guard');
  await clickWithNativeInput(window, 'button[aria-label="增大初始角色大小"]', 'Increase default Character size');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-default-pending"]') && document.querySelector('[data-testid="character-detail-place-current-shot"]')?.disabled === true`,
    'A pending default transform did not disable Add to Shot.',
  );
  const pendingTransform = await readIssue798PlacementNavigation(window);
  evidence.pendingTransform = pendingTransform;
  assert(pendingTransform.placementTitle === '先应用角色大小设置' && pendingTransform.revision === '0' && pendingTransform.undoCount === '0', 'Disabled Add to Shot did not preserve its guard tooltip and no-write behavior.');
  await clickWithNativeInput(window, '[data-testid="character-default-revert"]', 'Revert pending default Character size');
  await waitForDom(
    window,
    `!document.querySelector('[data-testid="character-default-pending"]') && document.querySelector('[data-testid="character-detail-place-current-shot"]')?.disabled === false`,
    'Reverting the default transform did not re-enable Add to Shot.',
  );
  evidence.transformReverted = await readIssue798PlacementNavigation(window);

  await clickWithNativeInput(window, '[data-testid="character-workspace-assembly-tab"]', 'Assembly before dirty-draft placement guard');
  await chooseImage(window, 'character-assembly-body-picker', IDS.bodyAlt);
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-pending"]') && document.querySelector('[data-testid="character-assembly-body-picker"]')?.dataset.selectedAssetId === ${JSON.stringify(IDS.bodyAlt)}`,
    'The dirty Assembly fixture was not prepared.',
  );
  const beforeDeclinedPlacement = await readIssue798PlacementState(window);
  const declinedPointer = await clickWithNativeInput(
    window,
    '[data-testid="character-detail-place-current-shot"]',
    'Add to Shot while Assembly changes are pending',
  );
  await waitForDom(
    window,
    'window.__issue610ConfirmCalls?.length === 1',
    'Add to Shot did not ask before abandoning the dirty Assembly draft.',
  );
  const declinedPlacement = await readIssue798PlacementState(window);
  assert(declinedPointer.hitTarget && declinedPlacement.layers.length === 0, 'Declining the Assembly confirmation still placed a Character Layer.');
  assert(declinedPlacement.revision === beforeDeclinedPlacement.revision && declinedPlacement.undoCount === beforeDeclinedPlacement.undoCount, 'Declining dirty Assembly placement wrote Project or History.');
  assert(await window.webContents.executeJavaScript(`Boolean(document.querySelector('[data-testid="character-assembly-pending"]'))`), 'Declining placement discarded the dirty Assembly draft.');
  evidence.declinedDirtyAssemblyPlacement = {
    nativePointer: declinedPointer,
    confirmCalls: await readConfirmCalls(window),
    before: beforeDeclinedPlacement,
    after: declinedPlacement,
  };
  await clickWithNativeInput(window, '[data-testid="character-assembly-pending"] button:first-of-type', 'Revert dirty Assembly draft');
  await waitForDom(
    window,
    `!document.querySelector('[data-testid="character-assembly-pending"]') && document.querySelector('[data-testid="character-workspace-assembly-tab"]')?.getAttribute('aria-pressed') === 'true'`,
    'Reverting the canceled Assembly draft did not clear its pending changes.',
  );
  const revertedAssemblyDraft = await readIssue798PlacementState(window);
  assert(revertedAssemblyDraft.revision === beforeDeclinedPlacement.revision && revertedAssemblyDraft.undoCount === beforeDeclinedPlacement.undoCount && revertedAssemblyDraft.layers.length === 0, 'Reverting the canceled Assembly draft wrote Project or History.');
  evidence.revertedAssemblyDraft = revertedAssemblyDraft;
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-workspace-assembly-tab"]')?.getAttribute('aria-pressed') === 'true' && !document.querySelector('[data-testid="character-assembly-pending"]')`,
    'The reverted Assembly draft was not clean before the narrow-window check.',
  );

  window.setSize(800, 560);
  await waitForDom(window, 'window.innerWidth <= 840 && window.innerWidth >= 760', 'The Issue #798 narrow-window viewport did not resize.');
  await waitForDom(window, `document.querySelector('[data-testid="character-workspace-assembly-tab"]')?.getAttribute('aria-pressed') === 'true'`, 'The Character detail left Assembly after viewport resize.');
  await wait(120);
  const narrow = await readIssue798PlacementNavigation(window);
  evidence.narrow = narrow;
  await waitForPaint(window);
  screenshots.push(await capture(window, 'character-detail-add-to-shot-narrow.png'));
  assert(narrow.placement && narrow.placement.left >= 0 && narrow.placement.right <= narrow.viewport.width + 1, 'Add to Shot overflowed the narrow viewport.');
  assert(narrow.placement.bottom <= narrow.viewport.height && narrow.navigationPosition === 'sticky', 'The shared navigation is clipped or not sticky in the narrow viewport.');
  assert(narrow.quickActionDrawer?.expanded === 'false' && narrow.quickActionDrawer.pointerEvents === 'none' && narrow.quickActionDrawer.handleHitTarget, 'The collapsed Quick Actions overlay intercepted navigation input or disabled its handle in the narrow viewport.');
  assert(narrow.placementHitTarget && narrow.placement?.width >= 44 && narrow.placement?.height >= 44, 'The narrow Add to Shot target is obscured or below 44px.');
  assert(narrow.back?.right <= narrow.placement.left + 1 && narrow.placement.right <= narrow.close.left + 1, 'Back, Add to Shot, and Close collide in the narrow viewport.');

  const scrollEvidence = await window.webContents.executeJavaScript(`(() => {
    const navigation = document.querySelector('.character-detail-navigation-detail');
    const placement = document.querySelector('[data-testid="character-detail-place-current-shot"]');
    const ancestors = [];
    for (let element = navigation?.parentElement; element && element !== document.body; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (element.scrollHeight > element.clientHeight + 1 && /(auto|scroll)/u.test(style.overflowY)) ancestors.push(element);
    }
    const scrollable = ancestors[0] ?? document.scrollingElement;
    const before = scrollable?.scrollTop ?? 0;
    if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
    const navigationRect = navigation?.getBoundingClientRect();
    const placementRect = placement?.getBoundingClientRect();
    return {
      viewportHeight: document.documentElement.clientHeight,
      scrollableClassName: scrollable && typeof scrollable.className === 'string' ? scrollable.className : '',
      scrollTopBefore: before,
      scrollTopAfter: scrollable?.scrollTop ?? 0,
      scrollHeight: scrollable?.scrollHeight ?? 0,
      clientHeight: scrollable?.clientHeight ?? 0,
      navigation: navigationRect && { top: navigationRect.top, bottom: navigationRect.bottom, height: navigationRect.height },
      navigationBackgroundColor: navigation ? getComputedStyle(navigation).backgroundColor : '',
      placement: placementRect && { left: placementRect.left, top: placementRect.top, right: placementRect.right, bottom: placementRect.bottom, width: placementRect.width, height: placementRect.height },
      placementHitTarget: Boolean(placementRect && (() => {
        const hit = document.elementFromPoint(placementRect.left + placementRect.width / 2, placementRect.top + placementRect.height / 2);
        return hit === placement || placement.contains(hit);
      })()),
      scrolled: Boolean(scrollable && scrollable.scrollHeight > scrollable.clientHeight + 1 && scrollable.scrollTop > before),
    };
  })()`);
  evidence.narrowScroll = scrollEvidence;
  assert(scrollEvidence.scrolled, 'The narrow viewport did not scroll a containing Character detail area.');
  assert(scrollEvidence.navigation?.top >= 0 && scrollEvidence.placement?.bottom <= scrollEvidence.viewportHeight, 'The sticky navigation action disappeared while scrolling.');
  assert(scrollEvidence.navigationBackgroundColor !== 'rgba(0, 0, 0, 0)', 'Scrolled Character content remained visible through the sticky navigation.');
  assert(scrollEvidence.placementHitTarget, 'Scrolling caused Add to Shot to lose its pointer hit target.');
  await waitForPaint(window);
  screenshots.push(await capture(window, 'character-detail-add-to-shot-narrow-scrolled.png'));

  const keyboardSpace = await pressFocusedControl(
    window,
    '[data-testid="character-detail-place-current-shot"]',
    'SPACE',
    'Add to Shot Space activation after Tab from Back',
    { tabFromSelector: '[data-testid="character-detail-back"]' },
  );
  await waitForDom(
    window,
    `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.layerJson ?? '[]').length === 1 && document.querySelector('[data-testid="character-manager"] [data-project-revision]')?.dataset.projectRevision === '1' && document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount === '1'`,
    'Space on the navigation Add to Shot button did not create exactly one Character Layer and History operation.',
  );
  const spacePlacement = await readIssue798PlacementState(window);
  evidence.keyboardSpacePlacement = { focus: keyboardSpace, state: spacePlacement };
  assert(keyboardSpace.tabFocus?.active && keyboardSpace.tabFocus?.visibleFocus && keyboardSpace.afterActivation.visibleFocus, 'Tab or Space did not leave a visible focus indication on Add to Shot.');
  assert(spacePlacement.layers.length === 1 && spacePlacement.layers[0].source?.kind === 'character' && spacePlacement.layers[0].source?.characterId === IDS.issue792Character, 'Space placement did not create exactly one formal Character Layer.');

  await expandProjectActions(window);
  await clickWithNativeInput(window, '[data-testid="history-controls"] .history-actions button:first-of-type', 'Undo Space placement');
  await waitForDom(
    window,
    `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.layerJson ?? '[]').length === 0 && document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount === '0' && document.querySelector('[data-testid="history-controls"]')?.dataset.redoCount === '1'`,
    'Undo did not remove the single Character Layer created from navigation.',
  );
  await clickWithNativeInput(window, '[data-testid="history-controls"] .history-actions button:last-of-type', 'Redo Space placement');
  await waitForDom(
    window,
    `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.layerJson ?? '[]').length === 1 && document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount === '1' && document.querySelector('[data-testid="history-controls"]')?.dataset.redoCount === '0'`,
    'Redo did not restore the single Character Layer created from navigation.',
  );
  const redonePlacement = await readIssue798PlacementState(window);
  evidence.undoRedo = redonePlacement;

  await clickWithNativeInput(window, '[data-testid="history-controls"] .history-actions button:first-of-type', 'Undo before pointer placement');
  await waitForDom(
    window,
    `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.layerJson ?? '[]').length === 0`,
    'The existing History Undo path did not return the Shot to its initial state.',
  );
  const beforePointerPlacement = await readIssue798PlacementState(window);
  assert(beforePointerPlacement.layers.length === 0 && beforePointerPlacement.undoCount === '0' && beforePointerPlacement.redoCount === '1', 'The native pointer placement did not start from the single Undo state.');
  evidence.beforeNativePointerPlacement = beforePointerPlacement;
  const pointerExpectedRevision = String(Number(beforePointerPlacement.revision) + 1);
  const pointerExpectedUndoCount = String(Number(beforePointerPlacement.undoCount) + 1);
  await window.webContents.executeJavaScript(`(() => {
    const drawer = document.querySelector('[data-testid="quick-action-drawer"]');
    if (drawer?.dataset.expanded === 'true') drawer.querySelector('[data-testid="quick-action-drawer-handle"]')?.click();
  })()`);
  await waitForDom(window, `document.querySelector('[data-testid="quick-action-drawer"]')?.dataset.expanded === 'false'`, 'Quick Actions did not collapse before the native pointer placement check.');
  const pointerPlacement = await clickWithNativeInput(
    window,
    '[data-testid="character-detail-place-current-shot"]',
    'Place Character with native pointer input in the narrow viewport',
  );
  await waitForDom(
    window,
    `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.layerJson ?? '[]').length === 1 && document.querySelector('[data-testid="character-manager"] [data-project-revision]')?.dataset.projectRevision === ${JSON.stringify(pointerExpectedRevision)} && document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount === ${JSON.stringify(pointerExpectedUndoCount)} && document.querySelector('[data-testid="history-controls"]')?.dataset.redoCount === '0'`,
    'A native pointer click did not create exactly one Character Layer from the shared navigation.',
  );
  const finalPlacement = await readIssue798PlacementState(window);
  assert(pointerPlacement.hitTarget && finalPlacement.layers.length === 1 && finalPlacement.revision === pointerExpectedRevision && finalPlacement.undoCount === pointerExpectedUndoCount && finalPlacement.redoCount === '0', 'The native pointer placement was missed, duplicated, or bypassed History.');
  evidence.nativePointerPlacement = { geometry: pointerPlacement, state: finalPlacement };
  await waitForPaint(window);
  screenshots.push(await capture(window, 'character-detail-add-to-shot-after-placement.png'));

  await clickWithNativeInput(window, '[data-testid="character-detail-back"]', 'Back to Character list');
  await waitForDom(window, `document.querySelector('[data-testid="character-list-view"] [data-character-id="${IDS.issue792Character}"]')`, 'The Character Detail Back control did not return to the list.');
  await clickWithNativeInput(window, `[data-testid="character-list-view"] [data-character-id="${IDS.issue792Character}"]`, 'Reopen Character before Close test');
  await waitForDom(window, `document.querySelector('[data-testid="character-detail-view"]')?.dataset.characterEditorId === ${JSON.stringify(IDS.issue792Character)}`, 'The Character Detail did not reopen before testing Close.');
  await clickWithNativeInput(window, '[data-testid="resource-activity-close"]', 'Close Character detail drawer');
  await waitForDom(window, `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen === 'false'`, 'The Character Detail Close control did not close the drawer.');
  evidence.backAndClose = { backReturnedToList: true, closeDrawerClosed: true };

  return {
    issue: 798,
    passed: true,
    commit: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    verificationGate: 'verify:issue798-add-to-shot-navigation',
    projectRoot,
    syntheticInput: true,
    humanAcceptance: false,
    evidenceKind: 'real-electron-production-ui-native-pointer-keyboard-input-and-responsive-geometry',
    preflightAcknowledgement: {
      issueBody: true,
      draftPrAndIssueRoute: true,
      dependency797CommittedAndFocusedCiPassed: true,
      designMdAndCurrentCharacterUiInspected: true,
    },
    evidence,
    screenshots,
  };
}

async function selectIssue799LayoutSource(window, characterId) {
  const selector = '[data-testid="character-assembly-layout-reuse-source"]';
  await waitForDom(
    window,
    `(() => {
      const select = document.querySelector(${JSON.stringify(selector)});
      return select && [...select.options].some((option) => option.value === ${JSON.stringify(characterId)});
    })()`,
    `Issue #799 source ${characterId} was not available in the Assembly picker.`,
  );
  const { currentIndex, targetIndex } = await window.webContents.executeJavaScript(`(() => {
    const select = document.querySelector(${JSON.stringify(selector)});
    return {
      currentIndex: select.selectedIndex,
      targetIndex: [...select.options].findIndex((option) => option.value === ${JSON.stringify(characterId)}),
    };
  })()`);
  await clickWithNativeInput(window, selector, 'Focus the saved layout source picker');
  const direction = targetIndex >= currentIndex ? 'ARROWDOWN' : 'ARROWUP';
  for (let step = 0; step < Math.abs(targetIndex - currentIndex); step += 1) {
    await sendKeyStroke(window, direction);
  }
  await sendKeyStroke(window, 'ENTER');
  try {
    await waitForDom(
      window,
      `document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(characterId)}`,
      `Issue #799 source ${characterId} was not selected in the Assembly picker.`,
    );
  } catch (error) {
    const state = await window.webContents.executeJavaScript(`(() => {
      const select = document.querySelector(${JSON.stringify(selector)});
      const active = document.activeElement;
      const bounds = select?.getBoundingClientRect();
      const hit = bounds ? document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2) : null;
      return {
        value: select?.value ?? null,
        selectedIndex: select?.selectedIndex ?? null,
        targetIndex: [...(select?.options ?? [])].findIndex((option) => option.value === ${JSON.stringify(characterId)}),
        disabled: select?.disabled ?? null,
        activeTag: active?.tagName ?? '',
        activeTestId: active?.dataset.testid ?? '',
        activeIsSelect: active === select,
        hitTag: hit?.tagName ?? '',
        hitTestId: hit?.dataset.testid ?? '',
      };
    })()`);
    throw new Error(`${error instanceof Error ? error.message : String(error)}; picker=${JSON.stringify(state)}`, { cause: error });
  }
}

async function readIssue799LayoutState(window) {
  return window.webContents.executeJavaScript(`(() => {
    const workbench = document.querySelector('[data-testid="character-assembly-workbench"]');
    const stage = document.querySelector('[data-testid="project-canvas-stage"]');
    const history = document.querySelector('[data-testid="history-controls"]');
    const select = document.querySelector('[data-testid="character-assembly-layout-reuse-source"]');
    const compatibility = document.querySelector('[data-testid="character-assembly-layout-reuse-compatibility"]');
    const preview = document.querySelector('[data-testid="character-assembly-layout-reuse-preview"]');
    return {
      characterId: workbench?.dataset.characterId ?? '',
      bodyAssetId: workbench?.dataset.bodyAssetId ?? '',
      previewFaceAssetId: workbench?.dataset.previewFaceAssetId ?? '',
      facePlacement: {
        offsetX: Number(workbench?.dataset.faceOffsetX),
        offsetY: Number(workbench?.dataset.faceOffsetY),
        scale: Number(workbench?.dataset.faceScale),
      },
      head: workbench?.dataset.headAssetId
        ? {
            assetId: workbench.dataset.headAssetId,
            placement: {
              offsetX: Number(workbench.dataset.headOffsetX),
              offsetY: Number(workbench.dataset.headOffsetY),
              scale: Number(workbench.dataset.headScale),
            },
            pivot: {
              x: Number(workbench.dataset.headPivotX),
              y: Number(workbench.dataset.headPivotY),
            },
          }
        : null,
      previewSourceId: workbench?.dataset.layoutPreviewSourceId ?? '',
      selectedSourceId: select?.value ?? '',
      compatibility: compatibility?.textContent?.trim() ?? '',
      activePreview: document.querySelector('[data-testid="character-assembly-layout-reuse-active-preview"]')?.textContent?.trim() ?? '',
      previewDisabled: preview?.disabled ?? true,
      pending: Boolean(document.querySelector('[data-testid="character-assembly-pending"]')),
      revision: stage?.dataset.projectRevision ?? '',
      undoCount: history?.dataset.undoCount ?? '',
      redoCount: history?.dataset.redoCount ?? '',
      selectedFace: workbench?.dataset.selectedFace ?? '',
      images: [...document.querySelectorAll('.character-assembly-part')].map((image) => ({
        assetId: image.dataset.assetId ?? '',
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        complete: image.complete,
      })),
    };
  })()`);
}

async function verifyIssue799LayoutReuse(window) {
  const screenshots = [];
  const evidence = {};
  inProgressEvidence.issue799 = evidence;
  const projectFilePath = path.join(projectRoot, 'project.json');
  const persistedAtOpen = ProjectSchema.parse(
    JSON.parse(readFileSync(projectFilePath, 'utf8')),
  );
  const sourceBefore = structuredClone(
    persistedAtOpen.characters.find((character) => character.id === IDS.issue799SourceCharacter),
  );
  const targetBefore = structuredClone(
    persistedAtOpen.characters.find((character) => character.id === IDS.issue799TargetCharacter),
  );
  assert(sourceBefore?.mode === 'composite', 'Saved layout source A was not loaded from the project file.');
  assert(targetBefore?.mode === 'composite', 'Target B was not loaded from the project file.');
  evidence.savedSourceLoadedFromProjectFile = {
    projectFilePath,
    sourceCharacterId: sourceBefore.id,
    sourceBodyAssetId: sourceBefore.bodyAssetId,
    sourceBodyDimensions: { width: 720, height: 920 },
    sourceFacePlacement: sourceBefore.facePlacement,
    sourceHead: sourceBefore.head,
  };
  const targetIdentity = (character) => ({
    id: character.id,
    mode: character.mode,
    name: character.name,
    baseAssetId: character.baseAssetId,
    defaultVoiceProfileId: character.defaultVoiceProfileId,
    expressions: character.expressions,
    defaultExpressionId: character.defaultExpressionId,
    mouthOpenAssetId: character.mouthOpenAssetId,
    defaultScale: character.defaultScale,
    defaultFlipX: character.defaultFlipX,
    bodyAssetId: character.bodyAssetId,
    headAssetId: character.head?.assetId,
  });
  const initialTargetIdentity = targetIdentity(targetBefore);

  await clickWithNativeInput(
    window,
    `[data-testid="character-list-view"] [data-character-id="${IDS.issue799TargetCharacter}"]`,
    'Open Issue #799 target Character B',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-detail-view"]')?.dataset.characterEditorId === ${JSON.stringify(IDS.issue799TargetCharacter)}`,
    'Issue #799 target Character B did not open.',
  );
  await clickWithNativeInput(
    window,
    '[data-testid="character-workspace-assembly-tab"]',
    'Open target B Assembly workspace',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.characterId === ${JSON.stringify(IDS.issue799TargetCharacter)}`,
    'Target B Assembly workbench did not open.',
  );
  const initial = await readIssue799LayoutState(window);
  evidence.targetBefore = initial;
  assert(initial.bodyAssetId === IDS.bodyAlt, 'Target B did not retain its own Body asset.');
  assert(initial.head?.assetId === IDS.issue799TargetHead, 'Target B did not retain its own Head asset.');
  assert(initial.facePlacement.offsetX === -22 && initial.facePlacement.offsetY === 64, 'Target B fixture placement changed unexpectedly.');
  assert(initial.revision === '0' && initial.undoCount === '0' && initial.redoCount === '0', 'Target B did not begin from a clean Project and History state.');

  await clickWithNativeInput(
    window,
    '[aria-label="预览表情"] button:nth-of-type(2)',
    'Preview target B alternate expression',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.previewFaceAssetId === ${JSON.stringify(IDS.issue799TargetAngryFace)}`,
    'Target B alternate expression preview did not retain its own expression asset.',
  );
  await clickWithNativeInput(
    window,
    '[aria-label="预览表情"] button:nth-of-type(3)',
    'Preview target B Mouth',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.previewFaceAssetId === ${JSON.stringify(IDS.issue799TargetMouth)}`,
    'Target B Mouth preview did not retain its own Mouth asset.',
  );
  await clickWithNativeInput(
    window,
    '[aria-label="预览表情"] button:nth-of-type(1)',
    'Restore target B default expression preview',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.previewFaceAssetId === ${JSON.stringify(IDS.issue799TargetFace)}`,
    'Target B default expression preview did not return.',
  );

  await clickWithNativeInput(
    window,
    '[data-testid="character-assembly-default-face-select"]',
    'Select Face edit target before layout preview',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.editTarget === 'face'`,
    'The Character workspace did not select Face as the edit target.',
  );
  await clickWithNativeInput(
    window,
    '[data-testid="character-assembly-fine-tune-toggle"]',
    'Open Face fine tune before layout preview',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-fine-tune-panel"]')?.getAttribute('aria-label') === '脸部精调'`,
    'Target B Face fine-tune panel did not open.',
  );
  await clickWithNativeInput(window, '[data-testid="character-assembly-right-step"]', 'Adjust target B Face draft once');
  await clickWithNativeInput(window, '[data-testid="character-assembly-right-step"]', 'Adjust target B Face draft a second time');
  const targetDraftBeforePreview = await readIssue799LayoutState(window);
  assert(targetDraftBeforePreview.facePlacement.offsetX === -20, 'The pre-existing target B local draft was not prepared.');
  assert(targetDraftBeforePreview.revision === '0' && targetDraftBeforePreview.undoCount === '0', 'Local Face tuning wrote Project or History before Apply.');
  evidence.targetDraftBeforePreview = targetDraftBeforePreview;

  await clickWithNativeInput(
    window,
    '[data-testid="character-assembly-layout-reuse-toggle"]',
    'Open Apply Layout panel',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-layout-reuse-panel"]')`,
    'Apply Layout panel did not open inside Assembly.',
  );
  const sourceSelector = '[data-testid="character-assembly-layout-reuse-source"]';
  const availableSourceIds = await window.webContents.executeJavaScript(`[
    ...document.querySelector(${JSON.stringify(sourceSelector)}).options,
  ].map((option) => option.value).filter(Boolean)`);
  evidence.availableSources = availableSourceIds;
  assert(availableSourceIds.includes(IDS.issue799SourceCharacter), 'Saved Character A was missing from the layout source list.');
  assert(!availableSourceIds.includes(IDS.issue799TargetCharacter), 'Target B was offered as its own saved layout source.');
  await selectIssue799LayoutSource(window, IDS.issue799SourceCharacter);
  await waitForDom(
    window,
    `(() => {
      const button = document.querySelector('[data-testid="character-assembly-layout-reuse-preview"]');
      const status = document.querySelector('[data-testid="character-assembly-layout-reuse-compatibility"]')?.textContent ?? '';
      return button && !button.disabled && status.trim() === '';
    })()`,
    'Compatible saved source A left redundant helper text or did not enable Preview.',
  );
  evidence.compatibleState = await readIssue799LayoutState(window);
  assert(evidence.compatibleState.compatibility === '', 'Compatible source state retained permanent helper text.');
  await clickWithNativeInput(
    window,
    '[data-testid="character-assembly-layout-reuse-preview"]',
    'Preview saved layout from A on target B',
  );
  await waitForDom(
    window,
    `(() => {
      const workbench = document.querySelector('[data-testid="character-assembly-workbench"]');
      return workbench?.dataset.layoutPreviewSourceId === ${JSON.stringify(IDS.issue799SourceCharacter)}
        && Number(workbench.dataset.faceOffsetX) === 46
        && Number(workbench.dataset.faceOffsetY) === 190
        && Number(workbench.dataset.headOffsetX) === 6
        && Number(workbench.dataset.headPivotX) === 358;
    })()`,
    'Preview did not copy the saved Face and Head layout values into B.',
  );
  const previewA = await readIssue799LayoutState(window);
  evidence.previewA = previewA;
  assert(previewA.activePreview === '预览中' && previewA.compatibility === '', 'Layout preview did not reduce its live status to the concise preview state.');
  assert(previewA.bodyAssetId === IDS.bodyAlt && previewA.head?.assetId === IDS.issue799TargetHead, 'Preview replaced target B Body or Head asset IDs.');
  assert(previewA.previewFaceAssetId === IDS.issue799TargetFace, 'Preview replaced target B expression selection.');
  assert(previewA.facePlacement.offsetX === 46 && previewA.facePlacement.offsetY === 190 && previewA.facePlacement.scale === 0.92, 'Preview did not copy the mapped Face placement values.');
  assert(previewA.head?.placement.offsetX === 6 && previewA.head.placement.offsetY === -132 && previewA.head.placement.scale === 0.88 && previewA.head.pivot.x === 358 && previewA.head.pivot.y === 452, 'Preview did not copy the mapped Head placement and pivot values.');
  assert(previewA.revision === '0' && previewA.undoCount === '0' && previewA.pending, 'Preview changed Project or History instead of only the Assembly draft.');
  await waitForPaint(window);
  screenshots.push(await capture(window, 'layout-reuse-preview-from-saved-source.png'));

  const rejectedSources = [
    [IDS.issue799HeadlessCharacter, '头部结构不同', 'head-structure-mismatch'],
    [IDS.issue799RatioCharacter, '身体尺寸不同', 'body-dimensions-mismatch'],
    [IDS.issue799MissingCharacter, '素材不可用', 'resource-missing'],
  ];
  const rejectionEvidence = [];
  for (const [characterId, expectedText, rejectionKind] of rejectedSources) {
    await selectIssue799LayoutSource(window, characterId);
    await waitForDom(
      window,
      `(() => {
        const status = document.querySelector('[data-testid="character-assembly-layout-reuse-compatibility"]')?.textContent ?? '';
        const button = document.querySelector('[data-testid="character-assembly-layout-reuse-preview"]');
        return status.includes(${JSON.stringify(expectedText)}) && button?.disabled === true;
      })()`,
      `Issue #799 rejected source ${characterId} was not blocked with a clear ${rejectionKind} message.`,
    );
    const rejected = await readIssue799LayoutState(window);
    assert(rejected.facePlacement.offsetX === 46 && rejected.head?.placement.offsetX === 6, `Selecting rejected source ${characterId} changed the staged B layout.`);
    assert(rejected.revision === '0' && rejected.undoCount === '0', `Selecting rejected source ${characterId} wrote Project or History.`);
    rejectionEvidence.push({ characterId, rejectionKind, state: rejected });
    if (rejectionKind === 'resource-missing') {
      await waitForPaint(window);
      screenshots.push(await capture(window, 'layout-reuse-rejected-unreadable-source.png'));
    }
  }
  evidence.rejectedSources = rejectionEvidence;

  await selectIssue799LayoutSource(window, IDS.issue799SourceCharacter);
  await waitForDom(
    window,
    `!document.querySelector('[data-testid="character-assembly-layout-reuse-preview"]')?.disabled`,
    'Saved source A did not become compatible again after switching back from rejected sources.',
  );
  await clickWithNativeInput(
    window,
    '[data-testid="character-assembly-layout-reuse-cancel"]',
    'Cancel template preview and restore target B draft',
  );
  await waitForDom(
    window,
    `(() => {
      const workbench = document.querySelector('[data-testid="character-assembly-workbench"]');
      return workbench?.dataset.layoutPreviewSourceId === ''
        && Number(workbench.dataset.faceOffsetX) === -20
        && Number(workbench.dataset.headOffsetX) === -18;
    })()`,
    'Cancel Preview did not restore the target B draft that existed before preview.',
  );
  const cancelledPreview = await readIssue799LayoutState(window);
  evidence.cancelledPreview = cancelledPreview;
  assert(cancelledPreview.revision === '0' && cancelledPreview.undoCount === '0', 'Cancel Preview wrote Project or History.');
  await clickWithNativeInput(
    window,
    '[data-testid="character-assembly-pending"] button:first-child',
    'Revert target B local Assembly draft',
  );
  await waitForDom(
    window,
    `(() => {
      const workbench = document.querySelector('[data-testid="character-assembly-workbench"]');
      return workbench?.dataset.layoutPreviewSourceId === ''
        && Number(workbench.dataset.faceOffsetX) === -22
        && Number(workbench.dataset.headOffsetX) === -18
        && !document.querySelector('[data-testid="character-assembly-pending"]');
    })()`,
    'Assembly Revert did not restore target B persisted values after preview cancellation.',
  );
  const revertedPreview = await readIssue799LayoutState(window);
  evidence.revertedPreview = revertedPreview;
  assert(revertedPreview.revision === '0' && revertedPreview.undoCount === '0', 'Assembly Revert wrote Project or History.');

  await clickWithNativeInput(
    window,
    '[data-testid="character-assembly-layout-reuse-toggle"]',
    'Reopen Apply Layout panel for final Apply',
  );
  await selectIssue799LayoutSource(window, IDS.issue799SourceCharacter);
  await waitForDom(
    window,
    `!document.querySelector('[data-testid="character-assembly-layout-reuse-preview"]')?.disabled`,
    'Saved source A was not ready for the final preview.',
  );
  await clickWithNativeInput(
    window,
    '[data-testid="character-assembly-layout-reuse-preview"]',
    'Preview saved layout from A for final Apply',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.layoutPreviewSourceId === ${JSON.stringify(IDS.issue799SourceCharacter)}`,
    'The final layout preview did not activate.',
  );
  await clickWithNativeInput(
    window,
    '[data-testid="character-assembly-head-asset-selected"]',
    'Select Head for fine tune from its Assembly asset card',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.editTarget === 'head'`,
    'The Character workspace did not select Head as the edit target.',
  );
  const fineTuneExpanded = await window.webContents.executeJavaScript(
    `document.querySelector('[data-testid="character-assembly-fine-tune-toggle"]')?.getAttribute('aria-expanded') === 'true'`,
  );
  if (!fineTuneExpanded) {
    await clickWithNativeInput(
      window,
      '[data-testid="character-assembly-fine-tune-toggle"]',
      'Open Head fine tune',
    );
  }
  await clickWithNativeInput(window, '[data-testid="character-assembly-head-right-step"]', 'Fine tune target B Head after preview');
  await clickWithNativeInput(
    window,
    '[data-testid="character-assembly-default-face-select"]',
    'Select Face for fine tune from its Assembly asset card',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.editTarget === 'face'`,
    'The Character workspace did not return to Face as the edit target.',
  );
  await clickWithNativeInput(window, '[data-testid="character-assembly-right-step"]', 'Fine tune target B Face after preview');
  const tunedPreview = await readIssue799LayoutState(window);
  evidence.tunedPreview = tunedPreview;
  assert(tunedPreview.facePlacement.offsetX === 47 && tunedPreview.head?.placement.offsetX === 7, 'Target B could not fine tune the copied Face and Head layout values.');
  assert(tunedPreview.revision === '0' && tunedPreview.undoCount === '0' && tunedPreview.pending, 'Fine tuning the preview wrote Project or History before Apply.');
  await waitForPaint(window);
  screenshots.push(await capture(window, 'layout-reuse-preview-fine-tuned.png'));

  await clickWithNativeInput(
    window,
    '[data-testid="character-assembly-pending"] button:last-child',
    'Apply the fine-tuned layout once',
  );
  await waitForDom(
    window,
    `(() => {
      const workbench = document.querySelector('[data-testid="character-assembly-workbench"]');
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      const history = document.querySelector('[data-testid="history-controls"]');
      return !document.querySelector('[data-testid="character-assembly-pending"]')
        && Number(workbench?.dataset.faceOffsetX) === 47
        && Number(workbench?.dataset.headOffsetX) === 7
        && stage?.dataset.projectRevision === '1'
        && history?.dataset.undoCount === '1'
        && history?.dataset.redoCount === '0';
    })()`,
    'Apply did not commit the tuned layout as exactly one Project/History operation.',
  );
  const applied = await readIssue799LayoutState(window);
  evidence.applied = applied;
  assert(applied.bodyAssetId === IDS.bodyAlt && applied.head?.assetId === IDS.issue799TargetHead, 'Apply changed target B asset references.');
  assert(JSON.stringify(activeProject.characters.find((character) => character.id === IDS.issue799SourceCharacter)) === JSON.stringify(sourceBefore), 'Source Character A changed before Project Save.');
  assert(JSON.stringify(activeProject.characters.find((character) => character.id === IDS.issue799TargetCharacter)) === JSON.stringify(targetBefore), 'Apply changed Main-owned Project before its existing save boundary.');
  evidence.sourceUnchangedBeforeSave = true;
  await waitForPaint(window);
  screenshots.push(await capture(window, 'layout-reuse-applied-to-target.png'));

  await clickWithNativeInput(
    window,
    '[data-testid="character-workspace-expressions-tab"]',
    'Close clean Assembly session before Undo',
  );
  await waitForDom(
    window,
    `!document.querySelector('[data-testid="character-assembly-workbench"]')`,
    'Clean Assembly session did not close before Undo.',
  );
  await expandProjectActions(window);
  await clickWithNativeInput(
    window,
    '[data-testid="history-controls"] .history-actions button:first-of-type',
    'Undo applied target B layout',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount === '0' && document.querySelector('[data-testid="history-controls"]')?.dataset.redoCount === '1'`,
    'Undo did not reverse the one layout Apply operation.',
  );
  await clickWithNativeInput(window, '[data-testid="character-workspace-assembly-tab"]', 'Reopen Assembly after Undo');
  const afterUndo = await readIssue799LayoutState(window);
  evidence.afterUndo = afterUndo;
  assert(afterUndo.facePlacement.offsetX === -22 && afterUndo.head?.placement.offsetX === -18, 'Undo did not restore target B original layout values.');
  assert(afterUndo.head?.assetId === IDS.issue799TargetHead && afterUndo.bodyAssetId === IDS.bodyAlt, 'Undo changed target B asset references.');

  await clickWithNativeInput(window, '[data-testid="character-workspace-expressions-tab"]', 'Close clean Assembly before Redo');
  await waitForDom(window, `!document.querySelector('[data-testid="character-assembly-workbench"]')`, 'Assembly did not close before Redo.');
  await clickWithNativeInput(
    window,
    '[data-testid="history-controls"] .history-actions button:last-of-type',
    'Redo applied target B layout',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount === '1' && document.querySelector('[data-testid="history-controls"]')?.dataset.redoCount === '0'`,
    'Redo did not restore the one layout Apply operation.',
  );
  await clickWithNativeInput(window, '[data-testid="character-workspace-assembly-tab"]', 'Reopen Assembly after Redo');
  const afterRedo = await readIssue799LayoutState(window);
  evidence.afterRedo = afterRedo;
  assert(afterRedo.facePlacement.offsetX === 47 && afterRedo.head?.placement.offsetX === 7, 'Redo did not restore the fine-tuned target B layout.');

  await expandProjectActions(window);
  await clickWithNativeInput(window, '[data-testid="quick-action-save"]', 'Save the applied target B layout');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="quick-action-save"]')?.dataset.saveState === 'saved'`,
    'Project Save did not finish after Apply and Redo.',
  );
  const diskProjectAfterSave = ProjectSchema.parse(
    JSON.parse(readFileSync(projectFilePath, 'utf8')),
  );
  const savedSource = diskProjectAfterSave.characters.find((character) => character.id === IDS.issue799SourceCharacter);
  const savedTarget = diskProjectAfterSave.characters.find((character) => character.id === IDS.issue799TargetCharacter);
  assert(savedSource?.mode === 'composite' && JSON.stringify(savedSource) === JSON.stringify(sourceBefore), 'Saving B changed saved source A.');
  assert(savedTarget?.mode === 'composite', 'Saved target B disappeared from project.json.');
  assert(savedTarget.facePlacement.offsetX === 47 && savedTarget.facePlacement.offsetY === 190 && savedTarget.facePlacement.scale === 0.92, 'Saved target B Face placement differs from the applied layout.');
  assert(savedTarget.head?.assetId === IDS.issue799TargetHead && savedTarget.head.placement.offsetX === 7 && savedTarget.head.placement.offsetY === -132 && savedTarget.head.placement.scale === 0.88 && savedTarget.head.pivot.x === 358 && savedTarget.head.pivot.y === 452, 'Saved target B Head layout or own Head asset reference differs from Apply.');
  assert(JSON.stringify(targetIdentity(savedTarget)) === JSON.stringify(initialTargetIdentity), 'Saving the layout changed target B identity, Body, expressions, Mouth, voice, scale, flip, or Head asset reference.');
  evidence.savedProject = {
    sourceUnchanged: true,
    targetFacePlacement: savedTarget.facePlacement,
    targetHead: savedTarget.head,
    targetIdentityPreserved: true,
    projectFilePath,
  };

  await clickWithNativeInput(window, '[data-testid="quick-action-close"]', 'Close saved project for disk reopen');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="project-center-screen"]') && !document.querySelector('[data-testid="editor-layout"]')`,
    'Saved project did not close to Project Center for a disk reopen.',
  );
  await openProject(window);
  await clickWithNativeInput(
    window,
    `[data-testid="character-list-view"] [data-character-id="${IDS.issue799TargetCharacter}"]`,
    'Reopen target B after Project Save',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-detail-view"]')?.dataset.characterEditorId === ${JSON.stringify(IDS.issue799TargetCharacter)}`,
    'Target B did not reopen after loading project.json.',
  );
  await clickWithNativeInput(window, '[data-testid="character-workspace-assembly-tab"]', 'Open persisted target B Assembly after reopen');
  await waitForDom(
    window,
    `(() => {
      const workbench = document.querySelector('[data-testid="character-assembly-workbench"]');
      return Number(workbench?.dataset.faceOffsetX) === 47
        && Number(workbench?.dataset.faceOffsetY) === 190
        && Number(workbench?.dataset.headOffsetX) === 7
        && workbench?.dataset.headAssetId === ${JSON.stringify(IDS.issue799TargetHead)};
    })()`,
    'Target B layout or own asset references did not persist after a project disk reopen.',
  );
  const reopened = await readIssue799LayoutState(window);
  evidence.reopenedFromProjectFile = reopened;
  assert(reopened.bodyAssetId === IDS.bodyAlt && reopened.head?.assetId === IDS.issue799TargetHead, 'Reopened target B did not keep its own Body/Head references.');
  assert(reopened.revision === '0' && reopened.undoCount === '0' && reopened.redoCount === '0', 'Reopened project did not start with a clean session and History.');
  await waitForPaint(window);
  screenshots.push(await capture(window, 'layout-reuse-save-reopen.png'));

  return {
    issue: 799,
    passed: true,
    commit: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    verificationGate: 'verify:issue799-layout-reuse',
    projectRoot,
    syntheticInput: true,
    humanAcceptance: false,
    evidenceKind: 'real-electron-production-assembly-ui-native-pointer-preview-cancel-fine-tune-apply-history-save-disk-reopen',
    sourceAndTarget: {
      source: { id: sourceBefore.id, bodyAssetId: sourceBefore.bodyAssetId, bodyDimensions: { width: 720, height: 920 }, facePlacement: sourceBefore.facePlacement, head: sourceBefore.head },
      target: { id: targetBefore.id, bodyAssetId: targetBefore.bodyAssetId, bodyDimensions: { width: 720, height: 920 }, originalFacePlacement: targetBefore.facePlacement, originalHead: targetBefore.head },
    },
    evidence,
    screenshots,
  };
}

async function verifyIssue792MouthOverflow(window) {
  const screenshots = [];
  const baselineRootCause = readIssue683BaselineClipPath();
  const evidence = { baselineRootCause };
  inProgressEvidence.issue792 = evidence;
  assert(
    baselineRootCause.rowOverflowHidden &&
      baselineRootCause.menuPositionedAbsolute &&
      baselineRootCause.menuOpensBelowRow &&
      baselineRootCause.menuIsDescendantOfDetails,
    'The #683 baseline no longer contains the issue #792 overflow-clipping path at its recorded commit.',
  );
  await click(
    window,
    `[data-testid="character-list-view"] [data-character-id="${IDS.issue792Character}"]`,
    'Open the composite Character with configured Mouth',
  );
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-detail-view"]')?.dataset.characterEditorId === ${JSON.stringify(IDS.issue792Character)}`,
    'Issue #792 composite Character did not open in Character detail.',
  );
  await click(window, '[data-testid="character-workspace-assembly-tab"]', 'Open Assembly workspace');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-workbench"][data-session-kind="edit"]') && document.querySelector('[data-testid="character-assembly-mouth-overflow-trigger"]')`,
    'Configured Mouth did not expose its Assembly overflow action.',
  );

  const initial = await readIssue792MenuGeometry(window);
  evidence.initial = initial;
  assert(initial.selectedMouthAssetId === IDS.mouth, 'Fixture did not start with a configured Mouth asset.');
  assert(initial.trigger.width >= 44 && initial.trigger.height >= 44, 'Mouth overflow trigger is below the 44px target size.');
  assert(initial.pickerAndOverflowAreSeparate, 'Mouth overflow overlaps the main picker action.');

  await openIssue792MenuWithPointer(window);
  const normal = await readIssue792MenuGeometry(window);
  evidence.normal = normal;
  assert(normal.open && normal.visible, 'Mouth menu did not become visible in the normal viewport.');
  assert(normal.ariaExpanded === 'true', 'Opening the Mouth menu did not update the overflow trigger expanded state.');
  assert(normal.menuInsideViewport && normal.clearIsActualHitTarget, 'Normal viewport menu bounds do not receive the expected clear-button hit test.');
  screenshots.push(await capture(window, 'mouth-menu-normal-open.png'));

  const pickerBounds = normal.picker;
  await sendPointerClick(window, pickerBounds.left + pickerBounds.width / 2, pickerBounds.top + pickerBounds.height / 2);
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-mouth-picker-candidates"]')`,
    'The main Mouth picker did not open independently from the overflow action.',
  );
  const pickerIndependence = await window.webContents.executeJavaScript(`({
    candidatesVisible: Boolean(document.querySelector('[data-testid="character-assembly-mouth-picker-candidates"]')),
    overflowOpen: Boolean(document.querySelector('[data-testid="character-assembly-mouth-overflow-menu"]')?.matches(':popover-open')),
    selectedAssetId: document.querySelector('[data-testid="character-assembly-mouth-picker"]')?.dataset.selectedAssetId ?? '',
  })`);
  evidence.pickerIndependence = pickerIndependence;
  assert(pickerIndependence.candidatesVisible && !pickerIndependence.overflowOpen, 'Main picker and overflow action were not independently activated.');
  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="character-assembly-mouth-picker-selected"]')?.click()`);
  await waitForDom(
    window,
    `!document.querySelector('[data-testid="character-assembly-mouth-picker-candidates"]')`,
    'The independently opened Mouth picker did not close after toggling its own action.',
  );
  await openIssue792MenuWithPointer(window);
  const pointerClearBefore = await readIssue792MenuGeometry(window);
  evidence.pointerClearBefore = pointerClearBefore;
  assert(pointerClearBefore.clearIsActualHitTarget, 'Pointer clear location is not the browser hit target.');
  await window.webContents.executeJavaScript(`(() => {
    window.__issue792PointerEvents = [];
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      document.addEventListener(type, (event) => {
        const target = event.target;
        window.__issue792PointerEvents.push({
          type: event.type,
          targetTag: target instanceof Element ? target.tagName : '',
          targetTestId: target instanceof Element ? target.getAttribute('data-testid') ?? '' : '',
          targetText: target instanceof Element ? target.textContent?.trim() ?? '' : '',
        });
      }, true);
    }
  })()`);
  screenshots.push(await capture(window, 'mouth-menu-before-pointer-clear.png'));
  await sendPointerClick(
    window,
    pointerClearBefore.clear.left + pointerClearBefore.clear.width / 2,
    pointerClearBefore.clear.top + pointerClearBefore.clear.height / 2,
  );
  await wait(120);
  const pointerClearAttempt = await readIssue792MenuGeometry(window);
  pointerClearAttempt.input = await window.webContents.executeJavaScript(`({
    devicePixelRatio: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    events: window.__issue792PointerEvents ?? [],
  })`);
  evidence.pointerClearAttempt = pointerClearAttempt;
  screenshots.push(await capture(window, 'mouth-menu-after-pointer-clear-draft.png'));
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-mouth-picker"]')?.dataset.selectedAssetId === '' && document.querySelector('[data-testid="character-assembly-pending"]')`,
    'A real pointer click on Mouth Clear did not clear the pending Mouth selection.',
  );
  const pointerClear = await readIssue792MenuGeometry(window);
  evidence.pointerClear = pointerClear;
  assert(!pointerClear.trigger && !pointerClear.open, 'Clearing Mouth left an overflow trigger or open menu behind.');
  assert(pointerClear.revision === initial.revision && pointerClear.undoCount === initial.undoCount, 'Clearing Mouth bypassed the existing Draft/Apply boundary.');
  screenshots.push(await capture(window, 'mouth-menu-pointer-clear-draft.png'));
  await click(window, '[data-testid="character-assembly-pending"] button:first-of-type', 'Revert pointer-cleared Mouth draft');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-mouth-picker"]')?.dataset.selectedAssetId === ${JSON.stringify(IDS.mouth)} && document.querySelector('[data-testid="character-assembly-mouth-overflow-trigger"]')`,
    'Reverting the pointer-cleared Mouth draft did not restore the configured Mouth row.',
  );

  window.setSize(800, 560);
  await waitForDom(window, 'window.innerWidth <= 840 && window.innerWidth >= 760', 'The narrow-window viewport did not resize.');
  await wait(150);
  const narrowScroll = await window.webContents.executeJavaScript(`(() => {
    const trigger = document.querySelector('[data-testid="character-assembly-mouth-overflow-trigger"]');
    const scrolled = [];
    for (let ancestor = trigger?.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (ancestor.scrollHeight > ancestor.clientHeight + 1 && /(auto|scroll)/u.test(style.overflowY)) {
        ancestor.scrollTop = ancestor.scrollHeight;
        const viewport = ancestor.getBoundingClientRect();
        scrolled.push({
          className: typeof ancestor.className === 'string' ? ancestor.className : '',
          scrollTop: ancestor.scrollTop,
          scrollHeight: ancestor.scrollHeight,
          clientHeight: ancestor.clientHeight,
          viewport: {
            top: viewport.top,
            bottom: viewport.bottom,
            left: viewport.left,
            right: viewport.right,
          },
        });
      }
    }
    trigger?.scrollIntoView({ block: 'end', inline: 'nearest' });
    const panel = document.querySelector('.character-assembly-drawer-panel');
    const anchor = trigger?.getBoundingClientRect();
    return {
      scrolled,
      viewportWidth: document.documentElement.clientWidth,
      panel: panel ? {
        scrollTop: panel.scrollTop,
        scrollHeight: panel.scrollHeight,
        clientHeight: panel.clientHeight,
      } : null,
      viewportHeight: document.documentElement.clientHeight,
      anchorTop: anchor?.top ?? null,
      anchorBottom: anchor?.bottom ?? null,
    };
  })()`);
  evidence.narrowScroll = narrowScroll;
  assert(
    narrowScroll.scrolled.some(({ scrollTop }) => scrollTop > 0),
    'The narrow-window setup did not scroll an assembly ancestor before opening the menu.',
  );
  assert(
    narrowScroll.scrolled.some(
      ({ scrollTop, clientHeight, scrollHeight }) =>
        scrollTop + clientHeight >= scrollHeight - 1,
    ),
    'The narrow-window setup did not reach the bottom of its scrollable assembly viewport.',
  );
  const scrollViewport = narrowScroll.scrolled.find(({ viewport }) => viewport)?.viewport;
  assert(
    scrollViewport &&
      narrowScroll.anchorBottom !== null &&
      narrowScroll.anchorBottom <= scrollViewport.bottom + 2 &&
      scrollViewport.bottom - narrowScroll.anchorBottom < 90,
    'The overflow trigger was not positioned near the bottom edge of its scroll viewport.',
  );
  await openIssue792MenuWithPointer(window);
  const narrowBottom = await readIssue792MenuGeometry(window);
  evidence.narrowBottom = narrowBottom;
  assert(narrowBottom.open && narrowBottom.visible, 'Mouth menu did not open in the narrow, bottom-scrolled viewport.');
  assert(narrowBottom.menuInsideViewport && narrowBottom.clearIsActualHitTarget, 'Narrow, bottom-scrolled Mouth menu was clipped or did not hit Clear.');
  assert(
    scrollViewport && narrowBottom.menu.bottom > scrollViewport.bottom,
    'The Mouth popover did not extend past the scroll viewport boundary.',
  );
  screenshots.push(await capture(window, 'mouth-menu-narrow-scroll-bottom.png'));
  await sendKeyStroke(window, 'ESC');
  await waitForDom(
    window,
    `!document.querySelector('[data-testid="character-assembly-mouth-overflow-menu"]')?.matches(':popover-open') && document.querySelector('[data-testid="character-assembly-mouth-overflow-trigger"]')?.getAttribute('aria-expanded') === 'false'`,
    'Escape did not dismiss the Mouth overflow popover and reset its trigger state.',
  );
  const escapeDismissed = await readIssue792MenuGeometry(window);
  evidence.escapeDismissed = escapeDismissed;
  assert(escapeDismissed.ariaExpanded === 'false', 'Escape dismissal did not update the overflow trigger expanded state.');
  assert(escapeDismissed.trigger.width >= 44, 'Escape dismissed the containing Character drawer instead of only the Mouth popover.');

  await window.webContents.executeJavaScript(`document.querySelector('[data-testid="character-assembly-mouth-picker-selected"]')?.focus()`);
  await sendKeyStroke(window, 'TAB');
  const triggerFocus = await readIssue792MenuGeometry(window);
  evidence.triggerFocus = triggerFocus;
  assert(triggerFocus.activeTestId === 'character-assembly-mouth-overflow-trigger' && triggerFocus.focusVisible, 'Tab did not reach a visible keyboard focus state on the overflow trigger.');
  await sendKeyStroke(window, 'SPACE');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-mouth-overflow-menu"]')?.matches(':popover-open') && document.querySelector('[data-testid="character-assembly-mouth-overflow-trigger"]')?.getAttribute('aria-expanded') === 'true'`,
    'Space did not open the Mouth overflow popover and update its trigger state.',
  );
  await sendKeyStroke(window, 'TAB');
  const clearFocus = await readIssue792MenuGeometry(window);
  evidence.clearFocus = clearFocus;
  assert(clearFocus.activeTestId === 'character-assembly-mouth-clear' && clearFocus.focusVisible, 'Tab did not reach the keyboard-visible Clear action inside the popover.');
  await window.webContents.executeJavaScript(`(() => {
    window.__issue792KeyboardEvents = [];
    for (const type of ['keydown', 'keyup', 'click']) {
      document.addEventListener(type, (event) => {
        const target = event.target;
        window.__issue792KeyboardEvents.push({
          type: event.type,
          key: event instanceof KeyboardEvent ? event.key : '',
          targetTag: target instanceof Element ? target.tagName : '',
          targetTestId: target instanceof Element ? target.getAttribute('data-testid') ?? '' : '',
          targetText: target instanceof Element ? target.textContent?.trim() ?? '' : '',
        });
      }, true);
    }
  })()`);
  screenshots.push(await capture(window, 'mouth-menu-before-space-clear.png'));
  await sendKeyStroke(window, 'SPACE');
  await wait(120);
  const keyboardClearAttempt = await readIssue792MenuGeometry(window);
  keyboardClearAttempt.inputEvents = await window.webContents.executeJavaScript(
    'window.__issue792KeyboardEvents ?? []',
  );
  evidence.keyboardClearAttempt = keyboardClearAttempt;
  screenshots.push(await capture(window, 'mouth-menu-after-space-clear.png'));
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-mouth-picker"]')?.dataset.selectedAssetId === '' && document.querySelector('[data-testid="character-assembly-pending"]')`,
    'Space did not activate Clear from the keyboard-opened Mouth popover.',
  );
  const keyboardClear = await readIssue792MenuGeometry(window);
  evidence.keyboardClear = keyboardClear;
  assert(!keyboardClear.trigger && keyboardClear.revision === initial.revision && keyboardClear.undoCount === initial.undoCount, 'Keyboard Clear changed the Draft/Apply boundary or kept an empty Mouth overflow trigger.');
  screenshots.push(await capture(window, 'mouth-menu-keyboard-clear-draft.png'));

  const applyTarget = await window.webContents.executeJavaScript(`(() => {
    const pending = document.querySelector('[data-testid="character-assembly-pending"]');
    const buttons = [...(pending?.querySelectorAll('button') ?? [])].map((button) => ({
      text: button.textContent?.trim() ?? '',
      disabled: button.disabled,
      lastChild: button === pending?.lastElementChild,
    }));
    return { buttons, selectedAssetId: document.querySelector('[data-testid="character-assembly-mouth-picker"]')?.dataset.selectedAssetId ?? null };
  })()`);
  evidence.applyTarget = applyTarget;
  await click(window, '[data-testid="character-assembly-pending"] button:last-child', 'Apply the cleared Mouth draft');
  await wait(160);
  const applyAttempt = await readIssue792MenuGeometry(window);
  applyAttempt.pendingButtons = await window.webContents.executeJavaScript(`({
    pendingText: document.querySelector('[data-testid="character-assembly-pending"]')?.textContent?.trim() ?? '',
    buttons: [...(document.querySelector('[data-testid="character-assembly-pending"]')?.querySelectorAll('button') ?? [])].map((button) => ({
      text: button.textContent?.trim() ?? '',
      disabled: button.disabled,
    })),
    redoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.redoCount ?? '',
  })`);
  evidence.applyAttempt = applyAttempt;
  screenshots.push(await capture(window, 'mouth-menu-after-apply-attempt.png'));
  await waitForDom(
    window,
    `!document.querySelector('[data-testid="character-assembly-pending"]') && document.querySelector('[data-testid="character-manager"] [data-project-revision]')?.dataset.projectRevision === '1' && document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount === '1'`,
    'Applying the Mouth clear did not create exactly one Project and History operation.',
  );
  const appliedClear = await readIssue792MenuGeometry(window);
  evidence.appliedClear = appliedClear;
  assert(
    appliedClear.selectedMouthAssetId === '' &&
      !appliedClear.trigger &&
      !appliedClear.pending &&
      appliedClear.revision === '1' &&
      appliedClear.undoCount === '1',
    'Applying Mouth Clear did not persist an empty Mouth selection in one operation.',
  );

  await click(window, '[data-testid="character-workspace-expressions-tab"]', 'Leave clean Assembly after applying Mouth Clear');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-workspace-expressions-tab"]')?.getAttribute('aria-pressed') === 'true' && !document.querySelector('[data-testid="character-assembly-workbench"]')`,
    'Leaving the clean, applied Assembly draft did not close its session.',
  );
  await click(window, '[data-testid="character-workspace-assembly-tab"]', 'Reopen Assembly to check the applied Mouth state');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-workbench"][data-session-kind="edit"]') && document.querySelector('[data-testid="character-assembly-mouth-picker"]')?.dataset.selectedAssetId === '' && !document.querySelector('[data-testid="character-assembly-mouth-overflow-trigger"]')`,
    'Reopening Assembly did not read the applied empty Mouth state from the Project.',
  );
  const persistedClear = await readIssue792MenuGeometry(window);
  evidence.persistedClear = persistedClear;
  assert(persistedClear.selectedMouthAssetId === '' && !persistedClear.trigger, 'The applied Mouth clear did not survive reopening Assembly.');

  await click(window, '[data-testid="character-workspace-expressions-tab"]', 'Leave clean Assembly before Undo');
  await waitForDom(
    window,
    `!document.querySelector('[data-testid="character-assembly-workbench"]')`,
    'Assembly did not close before the History Undo check.',
  );
  await click(window, '[data-testid="history-controls"] .history-actions button:first-of-type', 'Undo the applied Mouth clear');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount === '0' && document.querySelector('[data-testid="history-controls"]')?.dataset.redoCount === '1'`,
    'Undo did not move the Mouth clear operation to the redo stack.',
  );
  await click(window, '[data-testid="character-workspace-assembly-tab"]', 'Reopen Assembly after Undo');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-workbench"][data-session-kind="edit"]') && document.querySelector('[data-testid="character-assembly-mouth-picker"]')?.dataset.selectedAssetId === ${JSON.stringify(IDS.mouth)} && document.querySelector('[data-testid="character-assembly-mouth-overflow-trigger"]')`,
    'Undo did not restore the configured Mouth in the Project.',
  );
  const undoRestoredMouth = await readIssue792MenuGeometry(window);
  evidence.undoRestoredMouth = undoRestoredMouth;

  await click(window, '[data-testid="character-workspace-expressions-tab"]', 'Leave clean Assembly before Redo');
  await waitForDom(window, `!document.querySelector('[data-testid="character-assembly-workbench"]')`, 'Assembly did not close before the History Redo check.');
  await click(window, '[data-testid="history-controls"] .history-actions button:last-of-type', 'Redo the applied Mouth clear');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount === '1' && document.querySelector('[data-testid="history-controls"]')?.dataset.redoCount === '0'`,
    'Redo did not restore the Mouth clear operation from the redo stack.',
  );
  await click(window, '[data-testid="character-workspace-assembly-tab"]', 'Reopen Assembly after Redo');
  await waitForDom(
    window,
    `document.querySelector('[data-testid="character-assembly-workbench"][data-session-kind="edit"]') && document.querySelector('[data-testid="character-assembly-mouth-picker"]')?.dataset.selectedAssetId === '' && !document.querySelector('[data-testid="character-assembly-mouth-overflow-trigger"]')`,
    'Redo did not restore the cleared Mouth state in the Project.',
  );
  const redoClearedMouth = await readIssue792MenuGeometry(window);
  evidence.redoClearedMouth = redoClearedMouth;

  return {
    issue: 792,
    passed: true,
    commit: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    verificationGate: 'verify:issue792-mouth-overflow',
    projectRoot,
    syntheticInput: true,
    humanAcceptance: false,
    evidenceKind: 'real-electron-production-ui-pointer-input-keyboard-input-viewport-geometry-and-elementFromPoint-hit-test',
    evidence: {
      baselineRootCause,
      normal,
      pickerIndependence,
      pointerClearBefore,
      pointerClear,
      narrowScroll,
      narrowBottom,
      escapeDismissed,
      triggerFocus,
      clearFocus,
      keyboardClear,
      appliedClear,
      persistedClear,
      undoRestoredMouth,
      redoClearedMouth,
    },
    screenshots,
  };
}

async function run() {
  mkdirSync(evidenceRoot, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  activeProject = createFixture();
  if (issue799Only) {
    savedProject = structuredClone(activeProject);
    writeFileSync(
      path.join(projectRoot, 'project.json'),
      `${JSON.stringify(savedProject, null, 2)}\n`,
      'utf8',
    );
  }
  registerAcceptanceHandlers();
  await app.whenReady();
  configureElectronPaths();
  const screenshots = [];
  const evidence = {};
  inProgressEvidence = evidence;
  try {
    windowRef = await createMainWindow({ show: true });
    windowRef.setSize(1660, 1100);
    windowRef.show();
    windowRef.focus();
    windowRef.webContents.focus();
    await openProject(windowRef);
    if (issue799Only) {
      return await verifyIssue799LayoutReuse(windowRef);
    }
    if (issue797Only) {
      return await verifyIssue797HeadFaceEditTargets(windowRef);
    }
    if (issue798Only) {
      return await verifyIssue798AddToShotNavigation(windowRef);
    }
    if (issue792Only) {
      return await verifyIssue792MouthOverflow(windowRef);
    }
    await windowRef.webContents.executeJavaScript(`(() => {
      window.__issue610ConfirmCalls = [];
      window.__issue610ConfirmResponse = false;
      window.confirm = (message) => {
        window.__issue610ConfirmCalls.push(String(message));
        return Boolean(window.__issue610ConfirmResponse);
      };
    })()`);

    await click(
      windowRef,
      `[data-testid="character-list-view"] [data-character-id="${IDS.legacyCharacter}"]`,
      'Existing single-image Character',
    );
    await waitForDom(
      windowRef,
      `document.querySelector('[data-testid="character-detail-view"]')?.dataset.characterEditorId === ${JSON.stringify(IDS.legacyCharacter)}`,
      'The existing single-image Character did not open in Character detail.',
    );
    const existingSingleImage = await windowRef.webContents.executeJavaScript(`(() => {
      const detail = document.querySelector('[data-testid="character-detail-view"]');
      const tabs = [...document.querySelectorAll('[data-testid="character-workspace-switcher"] button')].map((button) => ({
        label: button.textContent.trim(),
        pressed: button.getAttribute('aria-pressed'),
      }));
      return {
        characterId: detail?.dataset.characterEditorId ?? '',
        assemblyTab: Boolean(document.querySelector('[data-testid="character-workspace-assembly-tab"]')),
        expressionCount: document.querySelectorAll('[data-testid="character-expression-workspace"] [data-expression-id]').length,
        tabs,
      };
    })()`);
    assert(existingSingleImage.characterId === IDS.legacyCharacter, 'The existing single-image Character identity changed.');
    assert(!existingSingleImage.assemblyTab, 'An existing single-image Character was incorrectly promoted to composite assembly.');
    assert(existingSingleImage.expressionCount === 2, 'The existing single-image Character lost its Expressions.');
    assert(existingSingleImage.tabs.length === 2 && existingSingleImage.tabs[0].pressed === 'true', 'The existing single-image Character no longer opens in its legacy Expressions workspace.');
    await waitForCharacterDetailScreenshot(windowRef, 'Existing single-image Character');
    evidence.existingSingleImageCharacter = existingSingleImage;
    screenshots.push(await capture(windowRef, 'existing-single-image-character.png'));
    await click(windowRef, '[data-testid="character-detail-back"]', 'Return from existing single-image Character');
    await waitForDom(
      windowRef,
      `document.querySelector('[data-testid="character-list-view"]')`,
      'The existing single-image Character did not return to the Character list.',
    );

    evidence.preflightProjectRevision = await windowRef.webContents.executeJavaScript(
      `document.querySelector('[data-testid="character-manager"] [data-project-revision]')?.dataset.projectRevision ?? ''`,
    );
    await openCreate(windowRef);
    await waitForDom(
      windowRef,
      `(() => {
        const mode = document.querySelector('[data-testid="character-create-mode-switch"]');
        const slot = document.querySelector('[data-testid="character-create-mode-switch-slot"]');
        return Boolean(mode && slot && mode.parentElement === slot);
      })()`,
      'Landscape Create mode selector did not enter the drawer header.',
    );
    const compactCreateNavigation = await windowRef.webContents.executeJavaScript(`(() => {
      const back = document.querySelector('[data-testid="character-create-back"]');
      const topBack = document.querySelector('[data-testid="resource-primary-action"]');
      const mode = document.querySelector('[data-testid="character-create-mode-switch"]');
      const modeSlot = document.querySelector('[data-testid="character-create-mode-switch-slot"]');
      const close = document.querySelector('[data-testid="resource-activity-close"]');
      const actions = back?.parentElement;
      const bounds = (element) => {
        const rect = element?.getBoundingClientRect();
        return rect ? { width: rect.width, height: rect.height } : null;
      };
      return {
        backLabel: back?.getAttribute('aria-label') ?? '',
        backText: back?.textContent.trim() ?? '',
        backBounds: bounds(back),
        backInBottomRow: actions?.classList.contains('character-create-actions') ?? false,
        modeInHeader: Boolean(mode && modeSlot && mode.parentElement === modeSlot),
        topBackPresent: Boolean(topBack),
        closeLabel: close?.getAttribute('aria-label') ?? '',
        closeClass: close?.className ?? '',
        closeBackground: close ? getComputedStyle(close).backgroundColor : '',
        closeBounds: bounds(close),
        singleImageLabels: [...document.querySelectorAll('[data-testid^="character-create-"][data-image-asset-picker] .image-asset-picker-heading strong')].map((label) => label.textContent.trim()),
        singleImageMouthOptional: [...(document.querySelector('[data-testid="character-create-mouth-picker"] .image-asset-picker-heading')?.querySelectorAll('small') ?? [])].some((label) => label.textContent.trim() === '可选'),
        singleImageMouthHelp: document.querySelector('[data-testid="character-create-mouth-picker"]')?.textContent.includes('创建后也可以在角色详情中配置。') ?? false,
        createLayout: document.querySelector('[data-create-layout]')?.dataset.createLayout ?? '',
        duplicateBackCount: document.querySelectorAll('[data-testid="character-create-back"]').length,
      };
    })()`);
    assert(compactCreateNavigation.backLabel === '返回角色列表' && compactCreateNavigation.backText === '返回', 'Landscape Create does not expose a compact, accessibly named Return action.');
    assert(compactCreateNavigation.backInBottomRow, 'Landscape Return is not in the bottom Create action row.');
    assert(compactCreateNavigation.backBounds?.width >= 44 && compactCreateNavigation.backBounds?.height >= 44, 'The compact Return action lost the shared touch-target size.');
    assert(compactCreateNavigation.modeInHeader, 'Landscape mode selection is not in the top drawer row.');
    assert(!compactCreateNavigation.topBackPresent, 'Landscape Create still shows a standalone top back action.');
    assert(compactCreateNavigation.closeLabel === '关闭资源工作区', 'The close X is not a distinct drawer-close action.');
    assert(compactCreateNavigation.closeClass.includes('resource-activity-create-close') && compactCreateNavigation.closeBackground === 'rgba(0, 0, 0, 0)', 'The Create close X is not visually subordinate to the drawer content.');
    assert(compactCreateNavigation.closeBounds?.width >= 44 && compactCreateNavigation.closeBounds?.height >= 44, 'The close X lost the shared touch-target size.');
    assert(compactCreateNavigation.singleImageLabels.join(',') === '普通表情,生气表情,张嘴图', 'Landscape single-image rows do not use the concise labels.');
    assert(!compactCreateNavigation.singleImageMouthOptional && !compactCreateNavigation.singleImageMouthHelp, 'Landscape single-image Mouth still includes redundant optional/help copy.');
    assert(compactCreateNavigation.createLayout === 'compressed-v2', 'Landscape Create is not using the approved compressed-v2 layout.');
    assert(compactCreateNavigation.duplicateBackCount === 1, 'Landscape Create does not render exactly one bottom Return action.');
    await wait(250);
    screenshots.push(await capture(windowRef, 'create-character-single-image-landscape.png'));
    await click(windowRef, '[data-testid="resource-activity-close"]', 'Close Character drawer with X');
    await waitForDom(
      windowRef,
      `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen === 'false'`,
      'Close X did not close the Character drawer.',
    );
    const closeState = await windowRef.webContents.executeJavaScript(`(() => ({
      activeSubview: document.querySelector('[data-testid="resource-activity-panel"]')?.dataset.activeSubview ?? '',
      createMounted: Boolean(document.querySelector('[data-testid="character-create-view"]')),
      drawerOpen: document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen ?? '',
    }))()`);
    assert(closeState.activeSubview === 'create' && closeState.createMounted && closeState.drawerOpen === 'false', 'Close X navigated away instead of only closing the Character drawer.');
    await click(windowRef, '[data-testid="resource-activity-rail-characters"]', 'Reopen Character drawer');
    await waitForDom(
      windowRef,
      `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen === 'true' && document.querySelector('[data-testid="character-create-view"]')`,
      'Reopening the Character drawer did not preserve its Create route.',
    );
    evidence.compactCreateNavigation = { ...compactCreateNavigation, closeState };

    await click(windowRef, '[data-testid="character-create-mode-switch"] input[value="composite"]', 'Composite Character choice');
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-assembly-workbench"][data-session-kind="create"]')`, 'Composite creation did not activate the Assembly workbench.');
    await click(windowRef, '[data-testid="character-create-back"]', 'Back to Character list');
    await waitForDom(
      windowRef,
      `document.querySelector('[data-testid="character-list-view"]') && document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen === 'true'`,
      'Back arrow did not navigate from Create to the open Character list.',
    );
    await waitForDom(windowRef, `document.querySelector('main.editor-shell')?.dataset.characterAssemblyActive === 'false'`, 'Cancel did not exit the non-persisted creation session.');
    const cancelled = await windowRef.webContents.executeJavaScript(`(() => ({
      revision: document.querySelector('[data-testid="character-manager"] [data-project-revision]')?.dataset.projectRevision ?? '',
      undoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? '',
      characterCount: document.querySelector('[data-testid="character-manager"] .character-manager-heading > div:last-child > span')?.textContent ?? '',
    }))()`);
    assert(cancelled.revision === '0', 'Canceling composite creation changed the Project revision.');
    assert(cancelled.undoCount === '0', 'Canceling composite creation created a History entry.');
    evidence.createCancel = cancelled;

    await openCreate(windowRef);
    await click(windowRef, '[data-testid="character-create-mode-switch"] input[value="composite"]', 'Composite Character choice');
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-assembly-workbench"][data-session-kind="create"]')`, 'Composite creation workbench did not reopen.');
    await chooseImage(windowRef, 'character-create-body-picker', IDS.body);
    await chooseImage(windowRef, 'character-create-face-picker', IDS.face);
    const fineTuneDefault = await windowRef.webContents.executeJavaScript(`(() => {
      const toggle = document.querySelector('[data-testid="character-assembly-fine-tune-toggle"]');
      return {
        expanded: toggle?.getAttribute('aria-expanded') ?? '',
        panelVisible: Boolean(document.querySelector('[data-testid="character-assembly-fine-tune-panel"]')),
      };
    })()`);
    assert(fineTuneDefault.expanded === 'false' && !fineTuneDefault.panelVisible, 'Assembly precision controls are not collapsed by default.');
    evidence.fineTuneDisclosureDefault = fineTuneDefault;
    await click(windowRef, '[data-testid="character-assembly-fine-tune-toggle"]', 'Open Assembly precision controls');
    await waitForDom(
      windowRef,
      `document.querySelector('[data-testid="character-assembly-fine-tune-panel"]') && document.querySelector('[data-testid="character-assembly-offset-x"]')`,
      'Opening Fine Tune did not reveal the existing Face Placement controls.',
    );
    const creationSurface = await windowRef.webContents.executeJavaScript(`(() => {
      const createView = document.querySelector('[data-testid="character-create-view"]');
      const form = createView?.querySelector('form.character-create-form');
      const nameRow = form?.querySelector('.character-create-name-row');
      const nameLabel = nameRow?.querySelector('span');
      const name = form?.querySelector('[data-testid="character-create-name"]');
      const mode = document.querySelector('[data-testid="character-create-mode-switch"]');
      const workbench = document.querySelector('[data-testid="character-assembly-workbench"]');
      const createActions = [...document.querySelectorAll('button')]
        .filter((button) => button.textContent.trim() === '创建角色' && button.getClientRects().length > 0);
      const controls = document.querySelector('[data-testid="character-assembly-placement-controls"]');
      const mouth = form?.querySelector('[data-testid="character-create-mouth-picker"]');
      const submit = form?.querySelector('.character-create-submit-compact');
      const submitBounds = submit?.getBoundingClientRect();
      const formBounds = form?.getBoundingClientRect();
      const nameLabelBounds = nameLabel?.getBoundingClientRect();
      const nameBounds = name?.getBoundingClientRect();
      const surface = document.querySelector('[data-testid="resource-activity-drawer"]');
      return {
        modeBeforeName: Boolean(mode && name && (mode.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING)),
        modeInHeader: mode?.parentElement?.dataset.testid === 'character-create-mode-switch-slot',
        nameRowClass: nameRow?.className ?? '',
        nameLabelText: nameLabel?.textContent.trim() ?? '',
        nameAndInputSameRow: Boolean(nameLabelBounds && nameBounds && Math.abs((nameLabelBounds.top + nameLabelBounds.height / 2) - (nameBounds.top + nameBounds.height / 2)) < 3),
        modeLabels: [...(mode?.querySelectorAll('label') ?? [])].map((label) => label.textContent.trim()),
        modeRadioClipPaths: [...(mode?.querySelectorAll('input[type="radio"]') ?? [])].map((input) => getComputedStyle(input).clipPath),
        drawerAssetLabels: [...(form?.querySelectorAll('.image-asset-picker-heading strong') ?? [])].map((label) => label.textContent.trim()),
        drawerAssetLabelStyles: [...(form?.querySelectorAll('.image-asset-picker-heading strong') ?? [])].map((label) => ({
          fontSize: getComputedStyle(label).fontSize,
          fontWeight: getComputedStyle(label).fontWeight,
        })),
        nameLabelStyle: nameLabel ? {
          fontSize: getComputedStyle(nameLabel).fontSize,
          fontWeight: getComputedStyle(nameLabel).fontWeight,
        } : null,
        mouthValue: mouth?.querySelector('.image-asset-picker-selected-copy strong')?.textContent.trim() ?? '',
        mouthAction: mouth?.querySelector('.image-asset-picker-selected-action')?.textContent.trim() ?? '',
        mouthExtraCopy: [...(mouth?.querySelectorAll('small') ?? [])].map((label) => label.textContent.trim()).filter(Boolean),
        mouthOptionalCopyPresent: /可选|可以稍后再配置/u.test(mouth?.textContent ?? ''),
        createActionCount: createActions.length,
        createActionOwnedByDrawer: Boolean(createActions[0]?.closest('[data-testid="character-create-view"]')),
        centralCreateActionCount: [...(workbench?.querySelectorAll('button') ?? [])]
          .filter((button) => button.textContent.trim() === '创建角色').length,
        createButtonCompact: Boolean(submitBounds && formBounds && submitBounds.width < formBounds.width - 40 && submitBounds.right >= formBounds.right - 2),
        createButtonTouchHeight: submitBounds?.height ?? 0,
        createEnabledWithoutMouth: Boolean(submit && !submit.disabled),
        drawerScroll: surface ? { scrollHeight: surface.scrollHeight, clientHeight: surface.clientHeight, needed: surface.scrollHeight > surface.clientHeight + 1 } : null,
        visibleAssemblyHeadingCount: workbench?.querySelectorAll('h1, h2, h3').length ?? -1,
        helperHintCount: workbench?.querySelectorAll('p').length ?? -1,
        precisionLabels: [...(controls?.querySelectorAll('.character-assembly-control-label') ?? [])].map((label) => label.textContent.trim()),
        resetLabel: controls?.querySelector('[data-testid="character-assembly-reset"]')?.textContent.trim() ?? '',
        values: {
          x: controls?.querySelector('[data-testid="character-assembly-offset-x"]')?.textContent.trim() ?? '',
          y: controls?.querySelector('[data-testid="character-assembly-offset-y"]')?.textContent.trim() ?? '',
          scale: controls?.querySelector('[data-testid="character-assembly-scale"]')?.textContent.trim() ?? '',
        },
      };
    })()`);
    assert(creationSurface.modeBeforeName && creationSurface.modeInHeader, 'Landscape mode selection is not the top contextual control before the Create form.');
    assert(creationSurface.nameRowClass === 'character-create-name-row' && creationSurface.nameLabelText === '角色名称' && creationSurface.nameAndInputSameRow, 'Character name label and input are not presented in one usable row.');
    assert(creationSurface.modeLabels.join(',') === '整图,身体+脸', 'Landscape type switch labels do not match the approved compact wording.');
    assert(creationSurface.modeRadioClipPaths.every((clipPath) => clipPath === 'inset(50%)'), 'The compact type switch shows radio-circle indicators.');
    assert(creationSurface.drawerAssetLabels.join(',') === '身体,默认脸,张嘴图', 'Composite asset rows do not use the required short labels.');
    assert(creationSurface.drawerAssetLabelStyles.every((style) => style.fontSize === creationSurface.nameLabelStyle?.fontSize && style.fontWeight === creationSurface.nameLabelStyle?.fontWeight), 'Composite asset labels do not match the Character name form-label hierarchy.');
    assert(creationSurface.mouthValue === '暂不配置' && creationSurface.mouthAction === '选择' && !creationSurface.mouthOptionalCopyPresent, 'The empty Mouth state has duplicate optional/help copy or the wrong action.');
    assert(creationSurface.createEnabledWithoutMouth, 'Composite Mouth became required for Character creation.');
    assert(creationSurface.createButtonCompact && creationSurface.createButtonTouchHeight >= 44, 'Create is not a compact, touch-usable bottom-right primary action.');
    assert(creationSurface.createActionCount === 1 && creationSurface.createActionOwnedByDrawer, 'Composite Create is not owned by exactly one left-drawer primary action.');
    assert(creationSurface.centralCreateActionCount === 0, 'The central Assembly workbench still owns a competing Create action.');
    assert(creationSurface.visibleAssemblyHeadingCount === 0, 'The central Assembly workbench still shows a permanent title block.');
    assert(creationSurface.helperHintCount === 0, 'The central Assembly workbench still shows a permanent helper hint.');
    assert(creationSurface.precisionLabels.join(',') === '左右,上下,大小', 'Face Placement precision controls are missing a labeled axis/size group.');
    assert(creationSurface.resetLabel === '重置', 'Face Placement precision controls do not expose Reset.');
    assert(creationSurface.values.x !== '' && creationSurface.values.y !== '' && creationSurface.values.scale !== '', 'Face Placement X/Y/scale values are not visible.');
    evidence.creationOwnershipAndControls = creationSurface;
    await windowRef.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    await wait(250);
    screenshots.push(await capture(windowRef, 'create-character-composite-landscape.png'));
    await setCharacterName(windowRef, 'S07 Composite Panda');
    await chooseImage(windowRef, 'character-create-mouth-picker', IDS.mouth);
    const dragEvidence = await dragFaceWithNativeInput(windowRef);
    assert(dragEvidence.bodyAssetId === IDS.body, 'Create preview did not use the explicitly selected Body.');
    assert(dragEvidence.faceAssetId === IDS.face, 'Create preview did not use the selected default Face.');
    evidence.createAssemblyAttempt = dragEvidence;
    assert(dragEvidence.revision === '0' && dragEvidence.history === '0', 'Assembly interactions wrote Project or History before Create.');
    assert(dragEvidence.rightInactive === 'true', 'The right Inspector remained active during Assembly.');
    assert(dragEvidence.timelineInactive === 'true', 'The Timeline remained active during Assembly.');
    assert(dragEvidence.canvasOwners === 1, 'Assembly introduced a second Canvas owner.');
    evidence.createAssembly = dragEvidence;
    await click(windowRef, '[data-testid="character-assembly-reset"]', 'Reset Face Placement');
    await waitForDom(windowRef, `(() => {
      const workbench = document.querySelector('[data-testid="character-assembly-workbench"]');
      return Number(workbench?.dataset.faceOffsetX) === 0
        && Number(workbench?.dataset.faceOffsetY) === 0
        && Number(workbench?.dataset.faceScale) === 1;
    })()`, 'Reset did not restore the shared Face Placement draft.');
    await click(windowRef, '[data-testid="character-assembly-right-step"]', 'Nudge Face right');
    await click(windowRef, '[data-testid="character-assembly-down-step"]', 'Nudge Face down');
    await click(windowRef, '[data-testid="character-assembly-scale-up"]', 'Increase Face size');
    await waitForDom(windowRef, `(() => {
      const workbench = document.querySelector('[data-testid="character-assembly-workbench"]');
      return Number(workbench?.dataset.faceOffsetX) === 1
        && Number(workbench?.dataset.faceOffsetY) === 1
        && Math.abs(Number(workbench?.dataset.faceScale) - 1.05) < 0.001;
    })()`, 'Precision controls did not update the same Face Placement draft used by direct dragging.');
    const precisionDraft = await windowRef.webContents.executeJavaScript(`(() => {
      const workbench = document.querySelector('[data-testid="character-assembly-workbench"]');
      const controls = document.querySelector('[data-testid="character-assembly-placement-controls"]');
      return {
        offsetX: Number(workbench.dataset.faceOffsetX),
        offsetY: Number(workbench.dataset.faceOffsetY),
        scale: Number(workbench.dataset.faceScale),
        visibleValues: [
          controls.querySelector('[data-testid="character-assembly-offset-x"]').textContent.trim(),
          controls.querySelector('[data-testid="character-assembly-offset-y"]').textContent.trim(),
          controls.querySelector('[data-testid="character-assembly-scale"]').textContent.trim(),
        ],
      };
    })()`);
    assert(precisionDraft.visibleValues.join(',') === '1.0,1.0,1.05×', 'Precision values did not track Face Placement changes.');
    evidence.createPrecisionDraft = precisionDraft;
    await windowRef.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    await wait(250);
    screenshots.push(await capture(windowRef, 'create-composite-assembly.png'));
    await click(windowRef, '[data-testid="character-create-composite-submit"]', 'Create composite Character');
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-detail-view"]') && document.querySelector('[data-testid="character-assembly-workbench"]') === null`, 'Create did not commit once and open Character detail.');
    const created = await windowRef.webContents.executeJavaScript(`(() => {
      const detail = document.querySelector('[data-testid="character-detail-view"]');
      const managerRevision = document.querySelector('[data-testid="character-manager"] [data-project-revision]');
      const history = document.querySelector('[data-testid="history-controls"]');
      const tabs = [...document.querySelectorAll('[data-testid="character-workspace-switcher"] button')].map((button) => ({
        label: button.textContent.trim(),
        pressed: button.getAttribute('aria-pressed'),
      }));
      return {
        characterId: detail.dataset.characterEditorId,
        revision: managerRevision?.dataset.projectRevision ?? '',
        undoCount: history?.dataset.undoCount ?? '',
        tabs,
        expressionCount: document.querySelectorAll('[data-testid="character-expression-workspace"] [data-expression-id]').length,
      };
    })()`);
    assert(created.characterId, 'Created Character did not reach its existing Detail workflow.');
    assert(created.revision === '1' && created.undoCount === '1', 'Create did not produce exactly one Project/History operation.');
    assert(created.tabs.length === 3 && created.tabs[0].label === '组装', 'Composite detail did not expose Assembly, Expressions, and Settings.');
    assert(created.tabs.find((tab) => tab.label.includes('表情'))?.pressed === 'true', 'Composite detail did not open on Expressions by default.');
    assert(created.expressionCount === 1, 'Composite creation imposed or created extra Expressions.');
    evidence.createdCharacter = created;

    await click(windowRef, '[data-testid="character-workspace-assembly-tab"]', 'Assembly workspace tab');
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-assembly-workbench"][data-session-kind="edit"]')`, 'Existing composite did not enter its Assembly workspace.');
    await chooseImage(windowRef, 'character-assembly-body-picker', IDS.bodyAlt);
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-assembly-pending"]')`, 'Body replacement did not become a pending Assembly draft.');
    await click(windowRef, '[data-testid="character-workspace-settings-tab"]', 'Attempt to leave pending Assembly for Settings');
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-workspace-assembly-tab"]')?.getAttribute('aria-pressed') === 'true' && document.querySelector('[data-testid="character-assembly-pending"]')`, 'Switching to Settings bypassed the pending Assembly guard.');
    const workspacePendingGuard = await windowRef.webContents.executeJavaScript(`({
      assemblyPressed: document.querySelector('[data-testid="character-workspace-assembly-tab"]')?.getAttribute('aria-pressed') ?? '',
      settingsPressed: document.querySelector('[data-testid="character-workspace-settings-tab"]')?.getAttribute('aria-pressed') ?? '',
      pending: Boolean(document.querySelector('[data-testid="character-assembly-pending"]')),
    })`);
    assert(workspacePendingGuard.assemblyPressed === 'true' && workspacePendingGuard.settingsPressed === 'false' && workspacePendingGuard.pending, 'The existing pending guard did not keep the user in Assembly.');
    await setConfirmResponse(windowRef, false);
    await click(windowRef, '[data-testid="resource-activity-rail-assets"]', 'Attempt to leave Characters without discarding');
    await waitForDom(windowRef, `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.activeActivity === 'characters' && document.querySelector('[data-testid="character-assembly-pending"]')`, 'Declining Assembly discard did not keep the Character activity and draft open.');
    const declinedActivityExitCalls = await readConfirmCalls(windowRef);
    assert(declinedActivityExitCalls.length === 1 && declinedActivityExitCalls[0].includes('离开将放弃'), 'Leaving Characters did not require one explicit discard confirmation.');
    await setConfirmResponse(windowRef, true);
    await click(windowRef, '[data-testid="resource-activity-rail-assets"]', 'Confirm discard and leave Characters');
    await waitForDom(windowRef, `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.activeActivity === 'assets' && document.querySelector('[data-testid="asset-library"]') && document.querySelector('main.editor-shell')?.dataset.characterAssemblyActive === 'false'`, 'Confirming discard did not leave Characters and cancel the Assembly session.');
    const acceptedActivityExit = await windowRef.webContents.executeJavaScript(`({
      confirmCalls: window.__issue610ConfirmCalls.length,
      revision: document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.projectRevision ?? '',
      undoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? '',
      workbenchVisible: Boolean(document.querySelector('[data-testid="character-assembly-workbench"]')),
    })`);
    assert(acceptedActivityExit.confirmCalls === 2, 'Activity exit did not use one explicit confirmation for each decision.');
    assert(acceptedActivityExit.undoCount === '1' && !acceptedActivityExit.workbenchVisible, 'Leaving Characters wrote History or kept the edit session alive.');
    evidence.pendingActivityExit = {
      workspaceGuard: workspacePendingGuard,
      declinedConfirm: declinedActivityExitCalls[0],
      accepted: acceptedActivityExit,
    };
    await click(windowRef, '[data-testid="resource-activity-rail-characters"]', 'Return to Characters after discard');
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-detail-view"]')`, 'Character detail did not return after leaving the activity.');
    await click(windowRef, '[data-testid="character-detail-back"]', 'Return to Character list after remount');
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-list-view"]')`, 'Character list did not return after the Character activity remounted.');
    await click(windowRef, `[data-testid="character-list-view"] [data-character-id="${created.characterId}"]`, 'Select the composite Character after remount');
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-detail-view"]')?.dataset.characterEditorId === ${JSON.stringify(created.characterId)}`, 'The composite Character did not reopen after the activity switch.');
    await click(windowRef, '[data-testid="character-workspace-assembly-tab"]', 'Reopen composite Assembly after discard');
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-assembly-workbench"][data-session-kind="edit"]')?.dataset.bodyAssetId === ${JSON.stringify(IDS.body)}`, 'Discarded Assembly did not reopen from the persisted Character state.');
    await chooseImage(windowRef, 'character-assembly-body-picker', IDS.bodyAlt);
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-assembly-pending"]')`, 'Body replacement did not become pending after reopening Assembly.');
    await click(windowRef, '[data-testid="character-assembly-pending"] button:first-of-type', 'Revert Assembly draft');
    await waitForDom(windowRef, `!document.querySelector('[data-testid="character-assembly-pending"]') && document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.bodyAssetId === ${JSON.stringify(IDS.body)}`, 'Revert did not restore the persisted Body without writing.');
    const reverted = await windowRef.webContents.executeJavaScript(`({
      revision: document.querySelector('[data-testid="character-manager"] [data-project-revision]')?.dataset.projectRevision ?? '',
      undoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? '',
    })`);
    assert(reverted.revision === '1' && reverted.undoCount === '1', 'Reverting Assembly changed Project or History.');
    evidence.editCancel = reverted;

    await chooseImage(windowRef, 'character-assembly-body-picker', IDS.bodyAlt);
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-assembly-pending"]')`, 'Second Body replacement did not become pending.');
    await click(windowRef, '[data-testid="character-assembly-pending"] button:last-child', 'Apply Assembly draft');
    await waitForDom(windowRef, `!document.querySelector('[data-testid="character-assembly-pending"]') && document.querySelector('[data-testid="character-assembly-workbench"]')?.dataset.bodyAssetId === ${JSON.stringify(IDS.bodyAlt)}`, 'Apply did not commit the Body replacement.');
    const applied = await windowRef.webContents.executeJavaScript(`({
      revision: document.querySelector('[data-testid="character-manager"] [data-project-revision]')?.dataset.projectRevision ?? '',
      undoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? '',
    })`);
    assert(applied.revision === '2' && applied.undoCount === '2', 'Assembly Apply did not produce exactly one Project/History operation.');
    evidence.editApply = applied;
    await chooseImage(windowRef, 'character-assembly-body-picker', IDS.body);
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-assembly-pending"]')`, 'A discardable Assembly draft was not created for the drawer-close guard.');
    await setConfirmResponse(windowRef, false);
    await click(windowRef, '[data-testid="character-detail-view"] [data-testid="resource-activity-close"]', 'Decline closing Character drawer with a pending Assembly edit');
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-assembly-pending"]') && document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen === 'true'`, 'Declining drawer close did not keep Assembly and its pending draft open.');
    await setConfirmResponse(windowRef, true);
    await click(windowRef, '[data-testid="character-detail-view"] [data-testid="resource-activity-close"]', 'Confirm closing Character drawer and discard Assembly edit');
    await waitForDom(windowRef, `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen === 'false' && document.querySelector('main.editor-shell')?.dataset.characterAssemblyActive === 'false'`, 'Confirmed drawer close did not leave Assembly.');
    const closedDrawer = await windowRef.webContents.executeJavaScript(`({
      confirmCalls: window.__issue610ConfirmCalls.length,
      revision: document.querySelector('[data-testid="character-manager"] [data-project-revision]')?.dataset.projectRevision ?? '',
      undoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? '',
      activeWorkspace: document.querySelector('[data-testid="character-workspace-expressions-tab"]')?.getAttribute('aria-pressed') ?? '',
    })`);
    assert(closedDrawer.confirmCalls === 4, 'Closing the Character drawer did not ask for an explicit discard decision.');
    assert(closedDrawer.revision === '2' && closedDrawer.undoCount === '2', 'Discarding on drawer close wrote Project or History.');
    evidence.pendingDrawerClose = closedDrawer;
    await click(windowRef, '[data-testid="resource-activity-rail-characters"]', 'Reopen Characters after confirmed drawer close');
    await waitForDom(windowRef, `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.resourceDrawerOpen === 'true' && document.querySelector('[data-testid="character-workspace-expressions-tab"]')?.getAttribute('aria-pressed') === 'true'`, 'Reopening Characters did not restore the default Expressions workspace.');
    await click(windowRef, '[data-testid="character-workspace-assembly-tab"]', 'Reopen Assembly after drawer close');
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-assembly-workbench"][data-session-kind="edit"]')?.dataset.bodyAssetId === ${JSON.stringify(IDS.bodyAlt)}`, 'Reopened Assembly did not start from the last applied Body.');
    await click(windowRef, '[data-testid="character-assembly-go-expressions"]', 'Use the Assembly-to-Expressions bridge');
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-workspace-expressions-tab"]')?.getAttribute('aria-pressed') === 'true' && document.querySelector('[data-testid="character-assembly-workbench"]') === null`, 'The default Face summary did not return to the authoritative Expressions workspace.');
    const bridgeConfirmCalls = await readConfirmCalls(windowRef);
    assert(bridgeConfirmCalls.length === 4, 'Leaving a clean Assembly draft unexpectedly required a discard confirmation.');
    evidence.defaultFaceExpressionBridge = {
      confirmCalls: bridgeConfirmCalls.length,
      expressionsPressed: 'true',
      assemblyWorkbenchOpen: false,
    };
    await click(windowRef, '[data-testid="character-workspace-assembly-tab"]', 'Open a clean Assembly draft before leaving Characters');
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-assembly-workbench"][data-session-kind="edit"]') && !document.querySelector('[data-testid="character-assembly-pending"]')`, 'A clean Assembly edit draft did not open.');
    await click(windowRef, '[data-testid="resource-activity-rail-assets"]', 'Leave Characters with a clean Assembly draft');
    await waitForDom(windowRef, `document.querySelector('[data-testid="resource-activity-dock"]')?.dataset.activeActivity === 'assets' && document.querySelector('[data-testid="asset-library"]')`, 'Leaving Characters with a clean Assembly draft was blocked.');
    const cleanActivityExit = await windowRef.webContents.executeJavaScript(`({
      confirmCalls: window.__issue610ConfirmCalls.length,
      revision: document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.projectRevision ?? '',
      undoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? '',
      workbenchVisible: Boolean(document.querySelector('[data-testid="character-assembly-workbench"]')),
    })`);
    assert(cleanActivityExit.confirmCalls === 4, 'Leaving Characters with a clean Assembly draft unexpectedly required confirmation.');
    assert(cleanActivityExit.revision === '2' && cleanActivityExit.undoCount === '2' && !cleanActivityExit.workbenchVisible, 'Leaving Characters with a clean Assembly draft changed Project/History or retained the edit session.');
    evidence.cleanActivityExit = cleanActivityExit;
    await click(windowRef, '[data-testid="resource-activity-rail-characters"]', 'Return to Characters after a clean Assembly exit');
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-detail-view"]')`, 'Character detail did not return after a clean Assembly exit.');
    await click(windowRef, '[data-testid="character-detail-back"]', 'Return to Character list after the clean Assembly exit');
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-list-view"] [data-character-id="${created.characterId}"]')`, 'The composite Character was not available after the clean Assembly exit.');
    await click(windowRef, `[data-testid="character-list-view"] [data-character-id="${created.characterId}"]`, 'Reopen the composite Character after the clean Assembly exit');
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-detail-view"]')?.dataset.characterEditorId === ${JSON.stringify(created.characterId)}`, 'The composite Character detail did not reopen after the clean Assembly exit.');
    await click(windowRef, '[data-testid="character-workspace-expressions-tab"]', 'Expressions workspace tab');
    await click(windowRef, '[data-testid="character-detail-back"]', 'Return to Character list');
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-list-view"] [data-character-id="${created.characterId}"]')`, 'Created Character did not remain in the authoritative Character list.');
    await click(windowRef, `[data-testid="character-list-view"] [data-character-id="${created.characterId}"]`, 'Reopen Character detail');
    await waitForDom(windowRef, `document.querySelector('[data-testid="character-detail-view"]')`, 'Character Detail did not reopen from the resource list.');

    await click(windowRef, '[data-testid="resource-activity-rail-assets"]', 'Asset Library activity');
    await waitForDom(windowRef, `document.querySelector('[data-testid="asset-library"]')`, 'Asset Library did not open.');
    await windowRef.webContents.executeJavaScript(`(() => {
      const button = [...document.querySelectorAll('[aria-label="素材分类"] button')]
        .find((candidate) => candidate.textContent.includes('角色'));
      if (!button) throw new Error('Character category filter was not found.');
      button.click();
    })()`);
    await waitForDom(windowRef, `document.querySelector('.asset-card[data-asset-id="${IDS.bodyAlt}"] .asset-card-context')`, 'Composite Body did not appear in the Character Asset Library category.');
    const bodyEntry = await windowRef.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('.asset-card[data-asset-id="${IDS.bodyAlt}"]');
      return {
        category: card?.dataset.category ?? '',
        context: card?.querySelector('.asset-card-context')?.textContent?.trim() ?? '',
        draggable: card?.draggable ?? false,
      };
    })()`);
    assert(bodyEntry.category === 'character', 'Body asset was not categorized as Character-related.');
    assert(bodyEntry.context === '身体素材 · 作为普通图片放置', 'Body-only Asset Library action inferred formal Character identity.');
    assert(bodyEntry.draggable, 'Body raw-image action was not available.');
    evidence.bodyAssetLibrary = bodyEntry;

    const rawDrop = await dispatchAssetDrop(
      windowRef,
      `.asset-card[data-asset-id="${IDS.bodyAlt}"]`,
    );
    evidence.bodyRawDropAttempt = rawDrop;
    await waitForDom(windowRef, `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.layerJson ?? '[]').length === 1`, 'Raw Body image action did not place one ordinary Image Layer.');
    const rawLayer = await windowRef.webContents.executeJavaScript(`JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]').dataset.layerJson)`);
    assert(rawLayer[0].source.kind === 'asset' && rawLayer[0].source.assetId === IDS.bodyAlt, 'Body drop guessed a formal Character identity instead of using the explicit raw-image action.');
    evidence.bodyRawImageDrop = { drag: rawDrop, source: rawLayer[0].source };

    await expandProjectActions(windowRef);
    await click(windowRef, '[data-testid="quick-action-history"] button[aria-label="撤销"]', 'Undo raw Body image placement');
    await waitForDom(windowRef, `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.layerJson ?? '[]').length === 0`, 'Undo did not remove the raw Body Image Layer.');
    const expressionCardSelector = `.asset-card[data-asset-id="${IDS.face}"]`;
    const formalDrop = await dispatchAssetDrop(
      windowRef,
      expressionCardSelector,
      'S07 Composite Panda',
    );
    await waitForDom(windowRef, `JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.layerJson ?? '[]').length === 1 && JSON.parse(document.querySelector('[data-testid="project-canvas-stage"]').dataset.layerJson)[0].source.kind === 'character'`, 'Formal Expression drop did not place a Character Layer.');
    await waitForDom(windowRef, `(() => {
      const stage = document.querySelector('[data-testid="project-canvas-stage"]');
      const assets = JSON.parse(stage?.dataset.renderedAssetIds ?? '[]');
      const incomplete = JSON.parse(stage?.dataset.incompleteVisualLayerIds ?? '[]');
      return assets.includes(${JSON.stringify(IDS.bodyAlt)}) && assets.includes(${JSON.stringify(IDS.face)}) && incomplete.length === 0;
    })()`, 'The complete Body + Face visual did not render on the Shot Canvas.');
    const canvasState = await readCanvasLayerState(windowRef);
    assert(canvasState.layers.length === 1, 'Formal Character placement produced more than one logical Shot Layer.');
    assert(canvasState.layers[0].source.characterId === created.characterId, 'Formal Shot Layer lost its explicit Character identity.');
    assert(canvasState.layers[0].source.expressionId, 'Formal Shot Layer lost its explicit Expression identity.');
    const formalPayload = JSON.parse(formalDrop.afterDrop.dragPayload);
    assert(formalPayload.type === 'character-expression' && formalPayload.characterId === created.characterId, 'The shared Face asset drop did not carry the explicitly selected composite Character identity.');
    assert(canvasState.layers[0].source.expressionId === formalPayload.expressionId, 'Formal Shot Layer did not retain the explicitly selected Expression identity.');
    assert(canvasState.renderedAssetIds.includes(IDS.bodyAlt) && canvasState.renderedAssetIds.includes(IDS.face), 'Canvas did not render both composite visual parts.');
    assert(canvasState.incompleteVisualLayerIds.length === 0 && !canvasState.failureWarning, 'Canvas displayed an incomplete composite Character.');
    evidence.formalShotPlacement = { drag: formalDrop, canvas: canvasState };
    screenshots.push(await capture(windowRef, 'shot-single-character-layer.png'));

    await click(windowRef, '[data-testid="resource-activity-rail-characters"]', 'Characters activity for legacy creation');
    await windowRef.webContents.executeJavaScript(`(() => {
      document.querySelector('[data-testid="character-detail-back"]')?.click();
    })()`);
    await waitForDom(
      windowRef,
      `document.querySelector('[data-testid="character-list-view"]')`,
      'Character list did not reopen for the legacy single-image creation check.',
    );
    const legacyCreationBase = await windowRef.webContents.executeJavaScript(`({
      revision: document.querySelector('[data-testid="character-manager"] [data-project-revision]')?.dataset.projectRevision ?? '',
      undoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? '',
    })`);
    await openCreate(windowRef);
    await waitForDom(
      windowRef,
      `document.querySelector('form.character-create-form')?.dataset.creationMode === 'single-image'`,
      'The existing Create Character entry did not default to its single-image workflow.',
    );
    await setCharacterName(windowRef, 'S07 Legacy Panda');
    await chooseImage(windowRef, 'character-create-normal-picker', IDS.face);
    await chooseImage(windowRef, 'character-create-angry-picker', IDS.mouth);
    const legacyDraft = await windowRef.webContents.executeJavaScript(`(() => {
      const form = document.querySelector('form.character-create-form');
      return {
        mode: form?.dataset.creationMode ?? '',
        normalAssetId: document.querySelector('[data-testid="character-create-normal-picker"]')?.dataset.selectedAssetId ?? '',
        angryAssetId: document.querySelector('[data-testid="character-create-angry-picker"]')?.dataset.selectedAssetId ?? '',
        mouthAssetId: document.querySelector('[data-testid="character-create-mouth-picker"]')?.dataset.selectedAssetId ?? '',
        createEnabled: !form?.querySelector('button[type="submit"]')?.disabled,
        revision: document.querySelector('[data-testid="character-manager"] [data-project-revision]')?.dataset.projectRevision ?? '',
        undoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? '',
      };
    })()`);
    assert(legacyDraft.mode === 'single-image', 'The legacy creator changed to composite mode without an explicit choice.');
    assert(legacyDraft.normalAssetId === IDS.face && legacyDraft.angryAssetId === IDS.mouth, 'The legacy creator did not retain its two explicitly selected images.');
    assert(legacyDraft.normalAssetId !== legacyDraft.angryAssetId, 'The legacy creator no longer enforces distinct Normal and Angry images.');
    assert(!legacyDraft.mouthAssetId, 'The legacy creator unexpectedly required or selected an optional Mouth image.');
    assert(legacyDraft.createEnabled, 'The valid legacy single-image creation path could not be submitted.');
    assert(legacyDraft.revision === legacyCreationBase.revision, 'Preparing a legacy Character wrote to the Project before Create.');
    assert(legacyDraft.undoCount === legacyCreationBase.undoCount, 'Preparing a legacy Character created a History entry before Create.');
    await click(windowRef, '[data-testid="character-create-view"] button[type="submit"]', 'Create legacy single-image Character');
    await waitForDom(
      windowRef,
      `document.querySelector('[data-testid="character-detail-view"]') && document.querySelector('[data-testid="character-detail-view"]').dataset.characterEditorId !== ${JSON.stringify(IDS.legacyCharacter)}`,
      'The legacy single-image Character did not open in its existing Character detail workflow.',
    );
    const legacyCreated = await windowRef.webContents.executeJavaScript(`(() => {
      const detail = document.querySelector('[data-testid="character-detail-view"]');
      const tabs = [...document.querySelectorAll('[data-testid="character-workspace-switcher"] button')].map((button) => ({
        label: button.textContent.trim(),
        pressed: button.getAttribute('aria-pressed'),
      }));
      return {
        characterId: detail?.dataset.characterEditorId ?? '',
        assemblyTab: Boolean(document.querySelector('[data-testid="character-workspace-assembly-tab"]')),
        expressionCount: document.querySelectorAll('[data-testid="character-expression-workspace"] [data-expression-id]').length,
        tabs,
        revision: document.querySelector('[data-testid="character-manager"] [data-project-revision]')?.dataset.projectRevision ?? '',
        undoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount ?? '',
      };
    })()`);
    assert(legacyCreated.characterId && legacyCreated.characterId !== IDS.legacyCharacter, 'The legacy creator did not create a new Character.');
    assert(!legacyCreated.assemblyTab && legacyCreated.expressionCount === 2, 'The newly created single-image Character did not use the legacy Expression detail.');
    assert(legacyCreated.tabs.length === 2 && legacyCreated.tabs[0].pressed === 'true', 'The single-image Character opened in the wrong Character workspace.');
    assert(Number(legacyCreated.revision) === Number(legacyCreationBase.revision) + 1, 'Legacy Character Create did not produce exactly one Project operation.');
    assert(Number(legacyCreated.undoCount) === Number(legacyCreationBase.undoCount) + 1, 'Legacy Character Create did not produce exactly one History operation.');
    evidence.legacySingleImageCreate = {
      beforeCreate: legacyCreationBase,
      draft: legacyDraft,
      created: legacyCreated,
    };
    await waitForCharacterDetailScreenshot(windowRef, 'New legacy single-image Character');
    screenshots.push(await capture(windowRef, 'legacy-single-image-created.png'));

    await click(windowRef, '[data-testid="quick-action-save"]', 'Save Project');
    await waitForDom(windowRef, `document.querySelector('[data-testid="quick-action-save"]')?.dataset.saveState === 'saved'`, 'Project Save did not complete through the production save action.');
    assert(savedProject, 'Project Save boundary did not receive a Project snapshot.');
    const savedComposite = savedProject.characters.find(
      (character) => character.id === created.characterId,
    );
    const savedExistingSingleImage = savedProject.characters.find(
      (character) => character.id === IDS.legacyCharacter,
    );
    const savedCreatedSingleImage = savedProject.characters.find(
      (character) => character.id === legacyCreated.characterId,
    );
    assert(savedProject.characters.length === 3, 'Saved Project did not preserve both single-image Characters and the new composite Character.');
    assert(savedComposite?.mode === 'composite', 'Saved Character was not composite.');
    assert(savedComposite.bodyAssetId === IDS.bodyAlt, 'Applied Body replacement was not persisted.');
    assert(savedComposite.facePlacement.offsetX === precisionDraft.offsetX && savedComposite.facePlacement.offsetY === precisionDraft.offsetY && savedComposite.facePlacement.scale === precisionDraft.scale, 'The Face Placement adjusted by preview drag and precision controls did not persist unchanged after Create.');
    assert(savedComposite.mouthOpenAssetId === IDS.mouth, 'Optional Mouth was not persisted.');
    assert(savedExistingSingleImage?.mode === 'single-image', 'The pre-existing single-image Character was migrated or changed.');
    assert(savedExistingSingleImage.expressions.map((expression) => expression.id).join(',') === `${IDS.legacyNormalExpression},${IDS.legacyAngryExpression}`, 'The pre-existing single-image Character Expression identities changed.');
    assert(savedCreatedSingleImage?.mode === 'single-image', 'The legacy creation path did not persist a single-image Character.');
    assert(savedCreatedSingleImage.expressions.map((expression) => expression.assetId).join(',') === `${IDS.face},${IDS.mouth}`, 'The legacy creator did not persist its Normal and Angry images.');
    assert(savedProject.shots[0].layers.length === 1, 'Saved Shot did not contain exactly one logical Layer.');
    assert(savedProject.shots[0].layers[0].source.kind === 'character', 'Saved Shot Layer was not a formal Character Layer.');
    assert(savedProject.shots[0].layers[0].source.characterId === created.characterId, 'Saved Shot Layer points at the wrong Character.');

    return {
      issue: 612,
      passed: true,
      commit: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      verificationGate: 'verify:issue609-character-assembly',
      projectRoot,
      syntheticInput: true,
      humanAcceptance: false,
      evidenceKind: 'real-electron-production-ui-pointer-input-and-project-save-boundary',
      preflightAcknowledgement: {
        issueBody: true,
        creationAssemblyDesignComment5790040443: true,
        existingCompositeDetailDesignComment5790470746: true,
        designMdAndCurrentCharacterUiInspected: true,
      },
      evidence,
      savedProject: {
        shotPlacementRevision: canvasState.revision,
        characterId: savedComposite.id,
        characterMode: savedComposite.mode,
        expressionCount: savedComposite.expressions.length,
        facePlacement: savedComposite.facePlacement,
        mouthAssetId: savedComposite.mouthOpenAssetId,
        existingSingleImageCharacterId: savedExistingSingleImage.id,
        createdSingleImageCharacterId: savedCreatedSingleImage.id,
        shotLayerCount: savedProject.shots[0].layers.length,
        shotLayerSource: savedProject.shots[0].layers[0].source,
      },
      imageReadEvidence: canvasReadEvidence,
      thumbnailReadEvidence,
      screenshots,
    };
  } finally {
    if (windowRef && !windowRef.isDestroyed()) windowRef.destroy();
    windowRef = null;
  }
}

async function main() {
  mkdirSync(runRoot, { recursive: true });
  let output;
  try {
    output = await run();
  } catch (error) {
    output = {
      issue: issue799Only ? 799 : issue797Only ? 797 : issue798Only ? 798 : issue792Only ? 792 : 612,
      passed: false,
      commit: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      verificationGate: issue799Only
        ? 'verify:issue799-layout-reuse'
        : issue797Only
          ? 'verify:issue797-head-face-edit'
          : issue798Only
            ? 'verify:issue798-add-to-shot-navigation'
            : issue792Only
              ? 'verify:issue792-mouth-overflow'
              : 'verify:issue609-character-assembly',
      projectRoot,
      syntheticInput: true,
      humanAcceptance: false,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      evidence: { ...inProgressEvidence, savedProject: Boolean(savedProject) },
      imageReadEvidence: canvasReadEvidence,
      thumbnailReadEvidence,
    };
    throw error;
  } finally {
    writeFileSync(resultPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    for (const channel of channels) ipcMain.removeHandler(channel);
  }
}

main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(`[issue${issue799Only ? 799 : issue797Only ? 797 : issue798Only ? 798 : issue792Only ? 792 : 609}] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    app.exit(1);
  });
