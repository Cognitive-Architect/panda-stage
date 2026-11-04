const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { app, BrowserWindow, nativeImage } = require('electron');

app.disableHardwareAcceleration();

const outputDir = path.resolve(
  process.env.PANDA_C5_KF00_OUTPUT_DIR ??
    'D:\\PandaStage-Acceptance\\issue-962-c5-kf00\\run',
);
const manifestPath = path.join(outputDir, 'visual-manifest.json');

function readSvgSize(svg) {
  const openingTag = svg.match(/<svg\b[^>]*>/u)?.[0];
  const width = openingTag?.match(/\bwidth="(\d+)"/u)?.[1];
  const height = openingTag?.match(/\bheight="(\d+)"/u)?.[1];
  if (!width || !height) {
    throw new Error('SVG output must declare integer width and height.');
  }
  return { width: Number(width), height: Number(height) };
}

function bitmapDifference(leftPng, rightPng) {
  const left = nativeImage.createFromBuffer(leftPng);
  const right = nativeImage.createFromBuffer(rightPng);
  const leftSize = left.getSize();
  const rightSize = right.getSize();
  if (leftSize.width !== rightSize.width || leftSize.height !== rightSize.height) {
    return {
      equal: false,
      reason: 'RASTER_DIMENSIONS_DIFFER',
      leftSize,
      rightSize,
      comparedPixels: 0,
      differingPixels: 0,
      maxChannelDifference: null,
    };
  }
  const leftBytes = left.toBitmap();
  const rightBytes = right.toBitmap();
  let differingPixels = 0;
  let maxChannelDifference = 0;
  for (let offset = 0; offset < leftBytes.length; offset += 4) {
    let pixelDiffers = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const difference = Math.abs(leftBytes[offset + channel] - rightBytes[offset + channel]);
      maxChannelDifference = Math.max(maxChannelDifference, difference);
      if (difference !== 0) pixelDiffers = true;
    }
    if (pixelDiffers) differingPixels += 1;
  }
  return {
    equal: differingPixels === 0,
    reason: differingPixels === 0 ? null : 'RASTER_PIXELS_DIFFER',
    leftSize,
    rightSize,
    comparedPixels: leftBytes.length / 4,
    differingPixels,
    maxChannelDifference,
    channelTolerance: 0,
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function visualReviewFingerprint(receipt) {
  const realAsset = receipt.realAsset;
  const bindings = {
    experimentHead: receipt.experimentHead,
    sourceSha256: realAsset.sourceSha256,
    sourcePartPngSha256: realAsset.sourcePartPngSha256,
    projectSnapshotSha256: realAsset.projectSnapshotSha256,
    contactSheetPngSha256: realAsset.contactSheetPngSha256,
    shoulderContactSheetPngSha256: realAsset.shoulderContactSheetPngSha256,
    interactivePreviewHtmlSha256: realAsset.interactivePreviewHtmlSha256,
    diagnosticContactSheetPngSha256:
      realAsset.diagnosticContactSheetPngSha256,
    diagnosticShoulderContactSheetPngSha256:
      realAsset.diagnosticShoulderContactSheetPngSha256,
  };
  if (Object.values(bindings).some((value) => typeof value !== 'string' || !value)) {
    return null;
  }
  return sha256(JSON.stringify({ schema: 'c5-kf-00-visual-review/v1', ...bindings }));
}

async function captureSvg(window, svgPath, outputPath) {
  const svg = fs.readFileSync(svgPath, 'utf8');
  const dimensions = readSvgSize(svg);
  const htmlPath = path.join(
    outputDir,
    `${path.basename(outputPath)}.capture.html`,
  );
  const encodedSvg = Buffer.from(svg, 'utf8').toString('base64');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:${dimensions.width}px;height:${dimensions.height}px;overflow:hidden;background:#fff}canvas{display:block;width:${dimensions.width}px;height:${dimensions.height}px}img{display:none}</style></head><body><img id="source" alt=""><canvas id="output" width="${dimensions.width}" height="${dimensions.height}"></canvas><script>document.getElementById('source').src='data:image/svg+xml;base64,${encodedSvg}';</script></body></html>`;
  fs.writeFileSync(htmlPath, html, 'utf8');
  await window.loadFile(htmlPath);
  const result = await window.webContents.executeJavaScript(
    `(async () => { const image = document.getElementById('source'); await image.decode(); await document.fonts.ready; const canvas = document.getElementById('output'); const context = canvas.getContext('2d', { willReadFrequently: true }); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'; context.drawImage(image, 0, 0, canvas.width, canvas.height); return { dataUrl: canvas.toDataURL('image/png'), naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight }; })()`,
    true,
  );
  if (!result?.dataUrl?.startsWith('data:image/png;base64,')) {
    throw new Error(`Electron failed to rasterize ${path.basename(svgPath)}.`);
  }
  const png = Buffer.from(result.dataUrl.slice('data:image/png;base64,'.length), 'base64');
  fs.writeFileSync(outputPath, png);
  return {
    path: outputPath,
    width: dimensions.width,
    height: dimensions.height,
    sourceNaturalWidth: result.naturalWidth,
    sourceNaturalHeight: result.naturalHeight,
    bytes: png.length,
    sha256: sha256(png),
  };
}

function applyVisualReview(receipt, reviewPath) {
  if (!receipt.realAsset || receipt.realAsset.status !== 'READY_FOR_PRIVATE_VISUAL_REVIEW') {
    return { status: receipt.realAsset?.status ?? 'REAL_ASSET_NOT_RUN' };
  }
  if (!fs.existsSync(reviewPath)) {
    receipt.realAsset.visualReview = 'PENDING_LOCAL_CONTACT_SHEET_REVIEW';
    return { status: receipt.realAsset.visualReview };
  }
  const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
  const fingerprint = visualReviewFingerprint(receipt);
  receipt.realAsset.visualReviewFingerprint = fingerprint;
  const matches =
    fingerprint !== null &&
    review.schema === 'c5-kf-00-visual-review/v1' &&
    review.experimentHead === receipt.experimentHead &&
    review.corpusEvidenceId === receipt.realAsset.corpusEvidenceId &&
    review.sourceSha256 === receipt.realAsset.sourceSha256 &&
    review.sourcePartPngSha256 === receipt.realAsset.sourcePartPngSha256 &&
    review.projectSnapshotSha256 === receipt.realAsset.projectSnapshotSha256 &&
    review.contactSheetPngSha256 === receipt.realAsset.contactSheetPngSha256 &&
    review.shoulderContactSheetPngSha256 === receipt.realAsset.shoulderContactSheetPngSha256 &&
    review.interactivePreviewHtmlSha256 === receipt.realAsset.interactivePreviewHtmlSha256 &&
    review.diagnosticContactSheetPngSha256 === receipt.realAsset.diagnosticContactSheetPngSha256 &&
    review.diagnosticShoulderContactSheetPngSha256 === receipt.realAsset.diagnosticShoulderContactSheetPngSha256 &&
    review.visualReviewFingerprint === fingerprint &&
    review.partName === receipt.realAsset.partName &&
    JSON.stringify(review.pivotSource) === JSON.stringify(receipt.realAsset.pivotSource) &&
    JSON.stringify(review.angleRangeTestedDeg) === JSON.stringify(receipt.realAsset.angleRangeTestedDeg) &&
    review.ownerAttested === false &&
    ['CODEX_LOCAL_VISUAL_PASS_PROVISIONAL', 'VISUAL_FAIL', 'ASSET_LIMITED'].includes(review.verdict);
  if (!matches) {
    receipt.realAsset.visualReview = 'VISUAL_REVIEW_REUSE_NOT_VERIFIED';
    return { status: receipt.realAsset.visualReview };
  }
  receipt.realAsset.visualReview = review.verdict;
  receipt.realAsset.ownerAttested = false;
  receipt.realAsset.visualReviewNote = review.note;
  receipt.realAsset.visualReviewFile = reviewPath;
  receipt.realAsset.visualReviewer = review.reviewer;
  receipt.realAsset.visualReviewedAt = review.reviewedAt;
  return { status: review.verdict, note: review.note };
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Research visual manifest not found: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const receipt = JSON.parse(fs.readFileSync(manifest.receiptPath, 'utf8'));
  const window = new BrowserWindow({
    show: false,
    width: 1_600,
    height: 1_000,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    const publicSheet = await captureSvg(
      window,
      manifest.publicSyntheticSvg,
      manifest.publicSyntheticPng,
    );
    const syntheticStaticPng = await captureSvg(
      window,
      manifest.syntheticStaticSvg,
      path.join(outputDir, 'synthetic-static.png'),
    );
    const syntheticNeutralPng = await captureSvg(
      window,
      manifest.syntheticNeutralSvg,
      path.join(outputDir, 'synthetic-neutral.png'),
    );
    const syntheticNeutralComparison = bitmapDifference(
      fs.readFileSync(syntheticStaticPng.path),
      fs.readFileSync(syntheticNeutralPng.path),
    );
    receipt.synthetic.researchSvgNeutralPixelComparison = syntheticNeutralComparison;
    receipt.synthetic.pixelComparisonScope = 'RESEARCH_SVG_ONLY';
    receipt.synthetic.pixelComparisonVerdict = syntheticNeutralComparison.equal
      ? 'RESEARCH_SVG_NEUTRAL_PIXEL_EQUAL'
      : 'RESEARCH_SVG_NEUTRAL_PIXEL_DIFFERENT';
    receipt.synthetic.productionStagePixelParity = 'NOT_VERIFIED';
    receipt.synthetic.contactSheetPng = publicSheet.path;
    receipt.synthetic.contactSheetSize = {
      width: publicSheet.width,
      height: publicSheet.height,
      bytes: publicSheet.bytes,
    };

    let realSheet = null;
    let realShoulderSheet = null;
    let diagnosticSheet = null;
    let diagnosticShoulderSheet = null;
    if (manifest.privateRealSvg) {
      realSheet = await captureSvg(
        window,
        manifest.privateRealSvg,
        path.join(outputDir, 'private-real-contact-sheet.png'),
      );
      if (manifest.privateRealShoulderSvg) {
        realShoulderSheet = await captureSvg(
          window,
          manifest.privateRealShoulderSvg,
          path.join(outputDir, 'private-real-shoulder-contact-sheet.png'),
        );
      }
      if (manifest.privateRealDiagnosticSvg) {
        diagnosticSheet = await captureSvg(
          window,
          manifest.privateRealDiagnosticSvg,
          path.join(outputDir, 'private-real-diagnostic-30-contact-sheet.png'),
        );
      }
      if (manifest.privateRealDiagnosticShoulderSvg) {
        diagnosticShoulderSheet = await captureSvg(
          window,
          manifest.privateRealDiagnosticShoulderSvg,
          path.join(
            outputDir,
            'private-real-diagnostic-30-shoulder-contact-sheet.png',
          ),
        );
      }
      const realStaticPng = await captureSvg(
        window,
        manifest.privateRealStaticSvg,
        path.join(outputDir, 'private-real-static.png'),
      );
      const realNeutralPng = await captureSvg(
        window,
        manifest.privateRealNeutralSvg,
        path.join(outputDir, 'private-real-neutral.png'),
      );
      const realNeutralComparison = bitmapDifference(
        fs.readFileSync(realStaticPng.path),
        fs.readFileSync(realNeutralPng.path),
      );
      receipt.realAsset.contactSheetPng = realSheet.path;
      receipt.realAsset.contactSheetPngSha256 = realSheet.sha256;
      receipt.realAsset.contactSheetSize = {
        width: realSheet.width,
        height: realSheet.height,
        bytes: realSheet.bytes,
      };
      if (realShoulderSheet) {
        receipt.realAsset.shoulderContactSheetPng = realShoulderSheet.path;
        receipt.realAsset.shoulderContactSheetPngSha256 = realShoulderSheet.sha256;
        receipt.realAsset.shoulderContactSheetSize = {
          width: realShoulderSheet.width,
          height: realShoulderSheet.height,
          bytes: realShoulderSheet.bytes,
        };
      }
      if (diagnosticSheet) {
        receipt.realAsset.diagnosticContactSheetPng = diagnosticSheet.path;
        receipt.realAsset.diagnosticContactSheetPngSha256 =
          diagnosticSheet.sha256;
        receipt.realAsset.diagnosticContactSheetSize = {
          width: diagnosticSheet.width,
          height: diagnosticSheet.height,
          bytes: diagnosticSheet.bytes,
        };
      }
      if (diagnosticShoulderSheet) {
        receipt.realAsset.diagnosticShoulderContactSheetPng =
          diagnosticShoulderSheet.path;
        receipt.realAsset.diagnosticShoulderContactSheetPngSha256 =
          diagnosticShoulderSheet.sha256;
        receipt.realAsset.diagnosticShoulderContactSheetSize = {
          width: diagnosticShoulderSheet.width,
          height: diagnosticShoulderSheet.height,
          bytes: diagnosticShoulderSheet.bytes,
        };
      }
      receipt.realAsset.researchSvgNeutralPixelComparison = realNeutralComparison;
      receipt.realAsset.pixelComparisonScope = 'RESEARCH_SVG_ONLY';
      receipt.realAsset.pixelComparisonVerdict = realNeutralComparison.equal
        ? 'RESEARCH_SVG_NEUTRAL_PIXEL_EQUAL'
        : 'RESEARCH_SVG_NEUTRAL_PIXEL_DIFFERENT';
      receipt.realAsset.productionStagePixelParity = 'NOT_VERIFIED';
    }

    const reviewPath = path.join(outputDir, 'private-visual-review.json');
    const visualReview = applyVisualReview(receipt, reviewPath);
    const pixelChecks = [syntheticNeutralComparison];
    if (receipt.realAsset.researchSvgNeutralPixelComparison) {
      pixelChecks.push(receipt.realAsset.researchSvgNeutralPixelComparison);
    }
    receipt.capture = {
      renderer: `Electron ${process.versions.electron} / Chromium ${process.versions.chrome}`,
      researchSvgSyntheticNeutralPixelEqual: syntheticNeutralComparison.equal,
      researchSvgRealNeutralPixelEqual: receipt.realAsset.researchSvgNeutralPixelComparison?.equal ?? null,
      productionStagePixelParity: 'NOT_VERIFIED',
      visualReview,
      outputDir,
    };
    receipt.gate =
      pixelChecks.every((check) => check.equal) &&
      receipt.synthetic.status === 'TECH_PASS'
        ? 'TECH_PASS'
        : 'TECH_FAIL';
    receipt.realVisualGate =
      visualReview.status === 'CODEX_LOCAL_VISUAL_PASS_PROVISIONAL'
        ? 'CODEX_LOCAL_VISUAL_PASS_PROVISIONAL / OWNER_NOT_ATTESTED'
        : visualReview.status;
    receipt.capturePending = false;
    fs.writeFileSync(
      manifest.receiptPath,
      `${JSON.stringify(receipt, null, 2)}\n`,
      'utf8',
    );
    console.log(JSON.stringify({
      gate: receipt.gate,
      realVisualGate: receipt.realVisualGate,
      syntheticResearchSvgNeutralPixelComparison: syntheticNeutralComparison,
      realResearchSvgNeutralPixelComparison: receipt.realAsset.researchSvgNeutralPixelComparison ?? null,
      productionStagePixelParity: 'NOT_VERIFIED',
      privateVisualReview: visualReview,
      syntheticContactSheet: publicSheet,
      privateRealContactSheet: realSheet,
      privateRealShoulderContactSheet: realShoulderSheet,
      privateRealDiagnosticContactSheet: diagnosticSheet,
      privateRealDiagnosticShoulderContactSheet: diagnosticShoulderSheet,
      interactivePreview: receipt.interactivePreview
        ? {
            status: receipt.interactivePreview.status,
            outputPath: receipt.interactivePreview.outputPath,
            sha256: receipt.interactivePreview.sha256,
            scenarioCount: receipt.interactivePreview.scenarioCount,
            ownerMotionVisibility:
              receipt.interactivePreview.ownerMotionVisibility,
            diagnosticLargeAngleSeam:
              receipt.interactivePreview.diagnosticLargeAngleSeam,
          }
        : null,
      receiptPath: manifest.receiptPath,
    }, null, 2));
    if (receipt.gate !== 'TECH_PASS') process.exitCode = 1;
  } finally {
    window.destroy();
    app.quit();
  }
}

app.whenReady().then(main).catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  app.quit();
  process.exitCode = 1;
});
