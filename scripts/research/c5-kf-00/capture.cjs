const fs = require('node:fs');
const path = require('node:path');
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
  const matches =
    review.corpusEvidenceId === receipt.realAsset.corpusEvidenceId &&
    review.sourceSha256 === receipt.realAsset.sourceSha256 &&
    review.partName === receipt.realAsset.partName &&
    JSON.stringify(review.pivotSource) === JSON.stringify(receipt.realAsset.pivotSource) &&
    JSON.stringify(review.angleRangeTestedDeg) === JSON.stringify(receipt.realAsset.angleRangeTestedDeg) &&
    ['REAL_VISUAL_PASS', 'VISUAL_FAIL', 'ASSET_LIMITED'].includes(review.verdict);
  if (!matches) {
    receipt.realAsset.visualReview = 'REVIEW_RECORD_MISMATCH';
    throw new Error('Private visual review does not match this exact source, Part, pivot, and angle range.');
  }
  receipt.realAsset.visualReview = review.verdict;
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
    receipt.synthetic.neutralPixelComparison = syntheticNeutralComparison;
    receipt.synthetic.contactSheetPng = publicSheet.path;
    receipt.synthetic.contactSheetSize = {
      width: publicSheet.width,
      height: publicSheet.height,
      bytes: publicSheet.bytes,
    };

    let realSheet = null;
    let realShoulderSheet = null;
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
      receipt.realAsset.contactSheetSize = {
        width: realSheet.width,
        height: realSheet.height,
        bytes: realSheet.bytes,
      };
      if (realShoulderSheet) {
        receipt.realAsset.shoulderContactSheetPng = realShoulderSheet.path;
        receipt.realAsset.shoulderContactSheetSize = {
          width: realShoulderSheet.width,
          height: realShoulderSheet.height,
          bytes: realShoulderSheet.bytes,
        };
      }
      receipt.realAsset.neutralPixelComparison = realNeutralComparison;
    }

    const reviewPath = path.join(outputDir, 'private-visual-review.json');
    const visualReview = applyVisualReview(receipt, reviewPath);
    const pixelChecks = [syntheticNeutralComparison];
    if (receipt.realAsset.neutralPixelComparison) {
      pixelChecks.push(receipt.realAsset.neutralPixelComparison);
    }
    receipt.capture = {
      renderer: `Electron ${process.versions.electron} / Chromium ${process.versions.chrome}`,
      syntheticStaticNeutralPixelEqual: syntheticNeutralComparison.equal,
      realStaticNeutralPixelEqual: receipt.realAsset.neutralPixelComparison?.equal ?? null,
      visualReview,
      outputDir,
    };
    receipt.gate =
      pixelChecks.every((check) => check.equal) &&
      receipt.synthetic.status === 'TECH_PASS'
        ? 'TECH_PASS'
        : 'TECH_FAIL';
    receipt.realVisualGate =
      visualReview.status === 'REAL_VISUAL_PASS'
        ? 'REAL_VISUAL_PASS'
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
      syntheticNeutralPixelComparison: syntheticNeutralComparison,
      realNeutralPixelComparison: receipt.realAsset.neutralPixelComparison ?? null,
      privateVisualReview: visualReview,
      syntheticContactSheet: publicSheet,
      privateRealContactSheet: realSheet,
      privateRealShoulderContactSheet: realShoulderSheet,
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
