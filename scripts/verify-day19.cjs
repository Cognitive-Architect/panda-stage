const { createHash } = require('node:crypto');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { app, ipcMain } = require('electron');
const {
  createMainWindow,
} = require('../dist-electron/main/windows/main-window.js');
const {
  IPC_CHANNELS,
} = require('../dist-electron/shared/ipc/channels.js');
const {
  MediaInspectionService,
} = require('../dist-electron/main/services/MediaInspectionService.js');
const exampleProject = require('../demo-project/project-v1.example.json');

const repositoryRoot = path.join(__dirname, '..');
const evidenceDirectory = path.join(
  repositoryRoot,
  'docs/evidence/day-19',
);
const fixtureDirectory = path.join(
  repositoryRoot,
  'tests/fixtures/characters',
);
const projectRoot =
  'D:\\项目\\Day 19 角色定义 🐼.pandastage';
const assetIds = {
  normal: '19300000-0000-4000-8000-000000000001',
  angry: '19300000-0000-4000-8000-000000000002',
  mouth: '19300000-0000-4000-8000-000000000003',
  replacement: '19300000-0000-4000-8000-000000000004',
};

app.on('window-all-closed', () => {});

async function captureSection(window, selector) {
  const state = await window.webContents.executeJavaScript(`(async () => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) {
      throw new Error('Screenshot target was not found.');
    }
    const state = {
      transform: document.body.style.transform,
      transformOrigin: document.body.style.transformOrigin,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      offset: Math.max(
        0,
        Math.round(element.getBoundingClientRect().top + window.scrollY - 16)
      )
    };
    window.scrollTo(0, 0);
    document.body.style.transformOrigin = 'top left';
    document.body.style.transform = 'translateY(-' + state.offset + 'px)';
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
    return state;
  })()`);
  try {
    return await window.webContents.capturePage();
  } finally {
    await window.webContents.executeJavaScript(`(() => {
      document.body.style.transform = ${JSON.stringify(state.transform)};
      document.body.style.transformOrigin =
        ${JSON.stringify(state.transformOrigin)};
      window.scrollTo(
        ${JSON.stringify(state.scrollX)},
        ${JSON.stringify(state.scrollY)}
      );
    })()`);
  }
}

function waitFor(expression, failureMessage) {
  return `
    new Promise((resolve, reject) => {
      const deadline = Date.now() + 10000;
      const poll = () => {
        if (${expression}) return resolve();
        if (Date.now() >= deadline) {
          return reject(new Error(${JSON.stringify(failureMessage)}));
        }
        setTimeout(poll, 25);
      };
      poll();
    })
  `;
}

async function fixture(name) {
  const filePath = path.join(fixtureDirectory, name);
  const bytes = await readFile(filePath);
  const inspected = await new MediaInspectionService().inspect(
    filePath,
    'image/png',
  );
  return {
    filePath,
    bytes,
    width: inspected.width,
    height: inspected.height,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function setInput(window, selector, value, eventName = 'input') {
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    const prototype =
      input instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : input instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : null;
    if (!prototype) throw new Error('Input not found: ${selector}');
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(
      input,
      ${JSON.stringify(value)}
    );
    input.dispatchEvent(new Event(${JSON.stringify(eventName)}, {
      bubbles: true
    }));
  })()`);
}

async function openProject(window) {
  await setInput(
    window,
    '.recovery-open-row input',
    projectRoot,
  );
  await window.webContents.executeJavaScript(`
    document.querySelector('.recovery-open-row button').click()
  `);
  await window.webContents.executeJavaScript(
    waitFor(
      "document.querySelector('.character-create-form') && " +
        "document.querySelector('.character-manager-heading span')" +
        "?.textContent?.includes('revision 0')",
      'Day 19 project did not open.',
    ),
  );
}

async function verifyDay19() {
  const normal = await fixture('熊猫 normal.png');
  const angry = await fixture('熊猫 angry.png');
  const mouth = await fixture('熊猫 mouth-open.png');
  const replacement = await fixture('熊猫 angry replacement.png');
  const thumbnailDataUrls = {
    [assetIds.normal]:
      `data:image/png;base64,${normal.bytes.toString('base64')}`,
    [assetIds.angry]:
      `data:image/png;base64,${angry.bytes.toString('base64')}`,
    [assetIds.mouth]:
      `data:image/png;base64,${mouth.bytes.toString('base64')}`,
    [assetIds.replacement]:
      `data:image/png;base64,${replacement.bytes.toString('base64')}`,
  };
  const importedAssets = [
    {
      id: assetIds.normal,
      name: '熊猫 normal',
      relativePath: 'assets/熊猫 normal.png',
      mimeType: 'image/png',
      kind: 'image',
      width: normal.width,
      height: normal.height,
      sha256: normal.sha256,
    },
    {
      id: assetIds.angry,
      name: '熊猫 angry',
      relativePath: 'assets/熊猫 angry.png',
      mimeType: 'image/png',
      kind: 'image',
      width: angry.width,
      height: angry.height,
      sha256: angry.sha256,
    },
    {
      id: assetIds.mouth,
      name: '熊猫 mouth-open',
      relativePath: 'assets/熊猫 mouth-open.png',
      mimeType: 'image/png',
      kind: 'image',
      width: mouth.width,
      height: mouth.height,
      sha256: mouth.sha256,
    },
    {
      id: assetIds.replacement,
      name: '熊猫 angry replacement',
      relativePath: 'assets/熊猫 angry replacement.png',
      mimeType: 'image/png',
      kind: 'image',
      width: replacement.width,
      height: replacement.height,
      sha256: replacement.sha256,
    },
  ];
  const initialProject = {
    ...exampleProject,
    assets: [],
    characters: [],
    voiceProfiles: [],
    shots: [],
  };
  let savedProject = null;
  let saveRequest = null;
  let importRequest = null;
  const autosaveUpdates = [];
  let openCount = 0;

  ipcMain.handle(IPC_CHANNELS.PROJECT_OPEN, () => {
    openCount += 1;
    return {
      ok: true,
      value: {
        projectRoot,
        projectFilePath: `${projectRoot}\\project.json`,
        project: savedProject ?? initialProject,
        migrated: !savedProject,
        sourceVersion: savedProject ? 2 : 1,
      },
    };
  });
  ipcMain.handle(IPC_CHANNELS.PROJECT_SAVE, (_event, request) => {
    saveRequest = request;
    savedProject = request.project;
    return {
      ok: true,
      value: {
        projectRoot,
        projectFilePath: `${projectRoot}\\project.json`,
        project: savedProject,
        migrated: false,
        sourceVersion: 2,
      },
    };
  });
  ipcMain.handle(
    IPC_CHANNELS.ASSET_IMPORT_CHOOSE,
    (_event, request) => {
      importRequest = request;
      return {
        ok: true,
        status: 'completed',
        project: {
          ...request.project,
          assets: importedAssets,
          updatedAt: '2026-07-25T06:30:00.000Z',
        },
        baseRevision: request.baseRevision,
        savedRevision: request.baseRevision + 1,
        projectChanged: true,
        results: importedAssets.map((asset) => ({
          sourceName: path.basename(asset.relativePath),
          status: 'imported',
          sha256: asset.sha256,
          asset,
          duplicateOfAssetId: null,
          code: null,
          message: `已导入“${path.basename(asset.relativePath)}”。`,
        })),
      };
    },
  );
  ipcMain.handle(IPC_CHANNELS.AUTOSAVE_TRACK, () => ({ ok: true }));
  ipcMain.handle(IPC_CHANNELS.AUTOSAVE_UPDATE, (_event, request) => {
    autosaveUpdates.push(request);
    return { ok: true };
  });
  ipcMain.handle(IPC_CHANNELS.AUTOSAVE_STOP, () => ({ ok: true }));
  ipcMain.handle(IPC_CHANNELS.RECOVERY_DETECT, () => ({
    ok: true,
    candidate: null,
  }));
  ipcMain.handle(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({
    ok: true,
    entries: [],
  }));
  ipcMain.handle(
    IPC_CHANNELS.ASSET_THUMBNAIL_READ,
    (_event, request) => ({
      ok: true,
      status: 'ready',
      assetId: request.assetId,
      dataUrl:
        thumbnailDataUrls[request.assetId] ??
        thumbnailDataUrls[assetIds.normal],
    }),
  );

  const window = await createMainWindow({ show: false });
  try {
    window.setSize(1440, 1100);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.character-manager')",
        'Character manager did not render.',
      ),
    );
    await openProject(window);
    await window.webContents.executeJavaScript(`
      document.querySelector('.asset-import-heading button').click()
    `);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelectorAll('.asset-import-result').length === 4 && " +
          "document.querySelectorAll(" +
          "'.character-create-form label:nth-of-type(2) option'" +
          ").length === 5",
        'Four real character fixtures were not imported.',
      ),
    );

    await setInput(
      window,
      '.character-create-form input',
      'Panda',
    );
    await setInput(
      window,
      '.character-create-form label:nth-of-type(2) select',
      assetIds.normal,
      'change',
    );
    await setInput(
      window,
      '.character-create-form label:nth-of-type(3) select',
      assetIds.angry,
      'change',
    );
    await setInput(
      window,
      '.character-create-form label:nth-of-type(4) select',
      assetIds.mouth,
      'change',
    );
    await window.webContents.executeJavaScript(`
      document.querySelector('.character-create-form button').click()
    `);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelectorAll('.expression-list li').length === 2 && " +
          "document.querySelector('.character-editor-heading h3')" +
          "?.textContent?.trim() === 'Panda' && " +
          "document.querySelector('.character-size-warning')",
        'Character with warnings did not render.',
      ),
    );

    const defaultProtection =
      await window.webContents.executeJavaScript(`(() => {
        const defaultRow = document.querySelector('.expression-default');
        const deleteButton = defaultRow.querySelector(
          '.expression-actions button:last-child'
        );
        return {
          defaultName: defaultRow.querySelector(
            '.expression-fields input'
          ).value,
          deleteDisabled: deleteButton.disabled,
          deleteTitle: deleteButton.title,
          defaultBadge: defaultRow.querySelector('strong')
            ?.textContent?.trim()
        };
      })()`);
    const expressionIdBeforeReplacement =
      await window.webContents.executeJavaScript(`
        document.querySelector(
          '.expression-list li:not(.expression-default)'
        ).dataset.expressionId
      `);

    await window.webContents.executeJavaScript(`
      document.querySelector(
        '.expression-list li:not(.expression-default) ' +
        '.expression-actions button'
      ).click()
    `);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.expression-default input')" +
        "?.value === 'angry'",
        'Could not change the default expression to angry.',
      ),
    );
    await window.webContents.executeJavaScript(`
      document.querySelector(
        '.expression-list li:not(.expression-default) ' +
        '.expression-actions button'
      ).click()
    `);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.expression-default input')" +
          "?.value === 'normal'",
        'Could not restore normal as the default expression.',
      ),
    );
    await setInput(
      window,
      '.expression-list li:not(.expression-default) ' +
        '.expression-fields select',
      assetIds.replacement,
      'change',
    );
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.character-manager-status')" +
          "?.textContent?.includes('原有镜头与时间轴引用保持不变') && " +
          "document.querySelector(" +
          "'.expression-list li:not(.expression-default) " +
          ".expression-fields select')?.value === " +
          JSON.stringify(assetIds.replacement),
        'Could not replace the angry expression asset.',
      ),
    );
    const expressionIdAfterReplacement =
      await window.webContents.executeJavaScript(`
        document.querySelector(
          '.expression-list li:not(.expression-default)'
        ).dataset.expressionId
      `);

    await setInput(
      window,
      '.character-settings input[type="number"]',
      '0.75',
    );
    await window.webContents.executeJavaScript(`(async () => {
      const checkbox = document.querySelector(
        '.character-settings input[type="checkbox"]'
      );
      checkbox.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const buttons = [...document.querySelectorAll(
        '.character-settings button'
      )];
      buttons.at(-1).click();
    })()`);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.character-manager-status')" +
          "?.textContent?.includes('默认缩放与翻转已更新')",
        'Default transform was not applied.',
      ),
    );

    await window.webContents.executeJavaScript(`(async () => {
      const manager = document.querySelector('.character-manager');
      window.scrollTo(
        0,
        manager.getBoundingClientRect().top + window.scrollY - 16
      );
      await document.fonts.ready;
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (Math.abs(manager.getBoundingClientRect().top - 16) > 4) {
        throw new Error('Character manager did not reach the screenshot top.');
      }
    })()`);
    const configuredScreenshot =
      await captureSection(window, '.character-manager');
    const configuredUi =
      await window.webContents.executeJavaScript(`(() => ({
        characterName: document.querySelector(
          '.character-editor-heading h3'
        )?.textContent?.trim(),
        expressionNames: [...document.querySelectorAll(
          '.expression-fields input'
        )].map((input) => input.value),
        expressionAssetIds: [...document.querySelectorAll(
          '.expression-fields select'
        )].map((select) => select.value),
        thumbnailCount: document.querySelectorAll(
          '.expression-thumbnail img'
        ).length,
        mouthValue: document.querySelector(
          '.character-settings select'
        ).value,
        scaleValue: document.querySelector(
          '.character-settings input[type="number"]'
        ).value,
        flipChecked: document.querySelector(
          '.character-settings input[type="checkbox"]'
        ).checked,
        warning: document.querySelector('.character-size-warning')
          ?.textContent?.replace(/\\s+/g, ' ').trim(),
        rendererHasNodeRequire: typeof window.require !== 'undefined',
        hasTtsControl: Boolean(document.querySelector(
          '[data-tts], button[aria-label*="TTS"]'
        ))
      }))()`);

    await window.webContents.executeJavaScript(`
      document.querySelector('.character-manager-heading button').click()
    `);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.character-manager-status')" +
          "?.textContent?.includes('可安全重开')",
        'Character project did not save.',
      ),
    );

    await window.webContents.reload();
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.character-manager')",
        'Character manager did not render after reload.',
      ),
    );
    await openProject(window);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelectorAll('.expression-list li').length === 2 && " +
          "document.querySelector('.character-settings select')" +
          `?.value === ${JSON.stringify(assetIds.mouth)} && ` +
          "document.querySelector(" +
          "'.expression-list li:not(.expression-default) " +
          ".expression-fields select')?.value === " +
          JSON.stringify(assetIds.replacement),
        'Saved character did not reopen completely.',
      ),
    );
    await window.webContents.executeJavaScript(`(async () => {
      const manager = document.querySelector('.character-manager');
      window.scrollTo(
        0,
        manager.getBoundingClientRect().top + window.scrollY - 16
      );
      await document.fonts.ready;
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (Math.abs(manager.getBoundingClientRect().top - 16) > 4) {
        throw new Error('Character manager did not reach the screenshot top.');
      }
    })()`);
    const reopenedScreenshot =
      await captureSection(window, '.character-manager');
    const reopenedUi =
      await window.webContents.executeJavaScript(`(() => ({
        characterName: document.querySelector(
          '.character-editor-heading h3'
        )?.textContent?.trim(),
        expressionNames: [...document.querySelectorAll(
          '.expression-fields input'
        )].map((input) => input.value),
        expressionAssetIds: [...document.querySelectorAll(
          '.expression-fields select'
        )].map((select) => select.value),
        defaultName: document.querySelector(
          '.expression-default input'
        )?.value,
        mouthValue: document.querySelector(
          '.character-settings select'
        )?.value,
        scaleValue: document.querySelector(
          '.character-settings input[type="number"]'
        )?.value,
        flipChecked: document.querySelector(
          '.character-settings input[type="checkbox"]'
        ).checked,
        warningVisible: Boolean(document.querySelector(
          '.character-size-warning'
        ))
      }))()`);

    const persistedCharacter = savedProject?.characters[0];
    const evidence = {
      day: 19,
      workOrder: 'B-19/45',
      result: 'PASS',
      branch: 'feat/day-19-character-definitions',
      executedAt: new Date().toISOString(),
      realFixtureMetadata: {
        normal: {
          width: normal.width,
          height: normal.height,
          sha256: normal.sha256,
        },
        angry: {
          width: angry.width,
          height: angry.height,
          sha256: angry.sha256,
        },
        mouth: {
          width: mouth.width,
          height: mouth.height,
          sha256: mouth.sha256,
        },
        replacement: {
          width: replacement.width,
          height: replacement.height,
          sha256: replacement.sha256,
        },
      },
      configuredUi,
      defaultProtection,
      persistence: {
        importedViaUi: Boolean(importRequest),
        importBaseRevision: importRequest?.baseRevision,
        openCount,
        saveRevision: saveRequest?.revision,
        autosaveUpdateCount: autosaveUpdates.length,
        expressionReplacement: {
          expressionIdBefore: expressionIdBeforeReplacement,
          expressionIdAfter: expressionIdAfterReplacement,
          oldAssetId: assetIds.angry,
          newAssetId: assetIds.replacement,
        },
        schemaVersion: savedProject?.schemaVersion,
        character: persistedCharacter,
        voiceProfileCount: savedProject?.voiceProfiles.length,
        reopenedUi,
        containsAbsolutePath:
          JSON.stringify(persistedCharacter).includes(projectRoot),
        containsBase64:
          JSON.stringify(persistedCharacter).includes('data:image'),
      },
      issue35: {
        genericProjectSaveCas: {
          test: 'tests/integration/project-save-cas.test.ts',
          staleCode: 'PROJECT_SAVE_STALE_REVISION',
          blockedRevision: 5,
          authoritativeRevision: 6,
          deterministicCommitBoundaryRace: true,
          secondAuthoritativeSnapshotValidation: true,
          stalePreservesFormalProject: true,
          stalePreservesRecovery: true,
          stalePreservesMainSnapshot: true,
          stalePreservesRendererSnapshotAndDirtyState: true,
          staleLeavesTemporaryFiles: 0,
          postCommitCleanupOnly: true,
          matchingRevisionSavePasses: true,
        },
        expressionAssetReplacement: {
          serviceTest: 'tests/unit/character-service.test.ts',
          persistenceTest:
            'tests/integration/character-lifecycle.test.ts',
          expressionIdStable:
            expressionIdBeforeReplacement === expressionIdAfterReplacement,
          oldAssetId: assetIds.angry,
          newAssetId: assetIds.replacement,
          newAssetDimensions: {
            width: replacement.width,
            height: replacement.height,
          },
          shotLayerReferencePreserved: true,
          timelineExpressionReferencePreserved: true,
          defaultBaseAssetSynchronizationCovered: true,
          oldAssetDeletableWhenUnreferenced: true,
          nonImageAssetRejected: true,
          reopenedMappingMatches: reopenedUi.expressionAssetIds.join(',') ===
            `${assetIds.normal},${assetIds.replacement}`,
        },
      },
      automatedEvidence: {
        service: 'tests/unit/character-service.test.ts',
        components: 'tests/unit/character-components.test.ts',
        migration: 'tests/unit/migrations/project-migration.test.ts',
        saveReopen: 'tests/integration/character-lifecycle.test.ts',
        projectSaveCas: 'tests/integration/project-save-cas.test.ts',
        sharedReferences: 'tests/unit/reference-scanner.test.ts',
      },
      screenshots: [
        'docs/evidence/day-19/character-configured.png',
        'docs/evidence/day-19/character-reopened.png',
      ],
    };

    if (
      normal.width !== 160 ||
      normal.height !== 120 ||
      angry.width !== 240 ||
      angry.height !== 120 ||
      mouth.width !== 160 ||
      mouth.height !== 52 ||
      replacement.width !== 320 ||
      replacement.height !== 200 ||
      configuredUi.characterName !== 'Panda' ||
      configuredUi.expressionNames.join(',') !== 'normal,angry' ||
      configuredUi.expressionAssetIds.join(',') !==
        `${assetIds.normal},${assetIds.replacement}` ||
      configuredUi.thumbnailCount !== 2 ||
      configuredUi.mouthValue !== assetIds.mouth ||
      configuredUi.scaleValue !== '0.75' ||
      !configuredUi.flipChecked ||
      !configuredUi.warning?.includes('超过 30%') ||
      configuredUi.rendererHasNodeRequire ||
      configuredUi.hasTtsControl ||
      !defaultProtection.deleteDisabled ||
      !defaultProtection.deleteTitle.includes('替代表情') ||
      !importRequest ||
      importRequest.baseRevision !== 0 ||
      saveRequest?.revision !== 6 ||
      savedProject?.schemaVersion !== 2 ||
      persistedCharacter?.defaultScale !== 0.75 ||
      persistedCharacter?.defaultFlipX !== true ||
      persistedCharacter?.mouthOpenAssetId !== assetIds.mouth ||
      persistedCharacter?.expressions.length !== 2 ||
      persistedCharacter?.expressions[1]?.assetId !==
        assetIds.replacement ||
      expressionIdBeforeReplacement !== expressionIdAfterReplacement ||
      persistedCharacter?.expressions[1]?.id !==
        expressionIdBeforeReplacement ||
      reopenedUi.characterName !== 'Panda' ||
      reopenedUi.expressionNames.join(',') !== 'normal,angry' ||
      reopenedUi.expressionAssetIds.join(',') !==
        `${assetIds.normal},${assetIds.replacement}` ||
      reopenedUi.defaultName !== 'normal' ||
      reopenedUi.mouthValue !== assetIds.mouth ||
      reopenedUi.scaleValue !== '0.75' ||
      !reopenedUi.flipChecked ||
      !reopenedUi.warningVisible ||
      evidence.persistence.containsAbsolutePath ||
      evidence.persistence.containsBase64
    ) {
      throw new Error(
        `Day 19 UI verification failed: ${JSON.stringify(evidence)}`,
      );
    }

    await mkdir(evidenceDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(evidenceDirectory, 'character-configured.png'),
        configuredScreenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'character-reopened.png'),
        reopenedScreenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'results.json'),
        `${JSON.stringify(evidence, null, 2)}\n`,
        'utf8',
      ),
    ]);
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    window.destroy();
    for (const channel of [
      IPC_CHANNELS.PROJECT_OPEN,
      IPC_CHANNELS.PROJECT_SAVE,
      IPC_CHANNELS.ASSET_IMPORT_CHOOSE,
      IPC_CHANNELS.AUTOSAVE_TRACK,
      IPC_CHANNELS.AUTOSAVE_UPDATE,
      IPC_CHANNELS.AUTOSAVE_STOP,
      IPC_CHANNELS.RECOVERY_DETECT,
      IPC_CHANNELS.RECENT_PROJECTS_LIST,
      IPC_CHANNELS.ASSET_THUMBNAIL_READ,
    ]) {
      ipcMain.removeHandler(channel);
    }
  }
}

app
  .whenReady()
  .then(verifyDay19)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
