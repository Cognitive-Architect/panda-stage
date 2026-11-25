/**
 * V2-R1 Static Snapshot — sandboxed snapshot rasterizer.
 *
 * Issue #287 R1-B. Runs inside the isolated BrowserWindow created by
 * FlaStaticSnapshotWindowManager. It receives a Panda-built, bounded SVG
 * string (never the FLA source), draws it onto a transparent canvas, and
 * returns the encoded PNG bytes. The SVG may contain vector paths and PNGs
 * embedded as data URIs; it contains no script or external references, so
 * rasterization makes no filesystem/network request and does not taint the
 * canvas.
 *
 * Isolation guarantees (per R1-B / R0 invariants):
 *  - no Node, no fs, no network (sandbox + CSP);
 *  - no ActionScript execution (the SVG builder rejects <Script>/<DOMScript>);
 *  - only the bounded SVG in, only bounded PNG bytes out.
 */

import {
  FLA_STATIC_TEXT_LIMITS,
  buildCanvasFontSpec,
  staticTextRunBaselineOffset,
  staticTextRunFontSize,
  computeAuthoritativeGraphicViewport,
  layoutFlaStaticText,
  splitGraphemes,
  type FlaStaticTextBounds,
  type FlaStaticTextGraphicFraming,
  type FlaStaticTextMeasurer,
  type FlaStaticTextRenderItem,
} from '../shared/fla-static-text';
import {
  FLA_SNAPSHOT_MAX_WIDTH,
  FLA_SNAPSHOT_MAX_HEIGHT,
  FLA_SNAPSHOT_MAX_PIXELS,
} from '../shared/fla-snapshot-output-size';

interface FlaSnapshotRenderRequest {
  requestId: string;
  svg: string;
  staticTexts?: readonly FlaStaticTextRenderItem[];
  graphicFraming?: FlaStaticTextGraphicFraming;
  returnResolvedSvg?: boolean;
}

interface FlaSnapshotRenderResult {
  requestId: string;
  png: number[];
  width: number;
  height: number;
  pixelCount: number;
  sourceViewport?: { x: number; y: number; width: number; height: number };
  resolvedSvg?: string;
  profile?: {
    imageLoadMs: number;
    canvasDrawMs: number;
    pngEncodeMs: number;
    pngArrayBufferMs: number;
    pngArraySerializeMs: number;
    totalMs: number;
  };
}

interface FlaSnapshotRendererApi {
  readonly issue762ProfileEnabled: boolean;
  ready(): void;
  onRender(callback: (request: FlaSnapshotRenderRequest) => void): () => void;
  renderResult(payload: FlaSnapshotRenderResult): void;
  renderError(payload: { requestId: string; message: string }): void;
}

declare global {
  interface Window {
    pandaStageFlaSnapshotRenderer: FlaSnapshotRendererApi;
  }
}

function formatNum(value: number): string {
  return Number.isFinite(value) ? Number(value.toFixed(3)).toString() : '0';
}

function resolveStaticTextPlaceholders(
  svg: string,
  staticTexts?: readonly FlaStaticTextRenderItem[],
  graphicFraming?: FlaStaticTextGraphicFraming,
): {
  readonly svg: string;
  readonly sourceViewport?: { x: number; y: number; width: number; height: number };
} {
  if (!staticTexts || staticTexts.length === 0) return { svg };

  const measureCanvas = document.createElement('canvas');
  measureCanvas.width = 1;
  measureCanvas.height = 1;
  const measureCtx = measureCanvas.getContext('2d');
  if (!measureCtx) {
    throw new Error('snapshot static text canvas 2D context is unavailable');
  }

  let currentMeasureFont = '';
  const measure: FlaStaticTextMeasurer = (text, run) => {
    const font = buildCanvasFontSpec(run);
    if (font !== currentMeasureFont) {
      measureCtx.font = font;
      currentMeasureFont = font;
    }
    const metrics = measureCtx.measureText(text);
    const ascent =
      typeof metrics.actualBoundingBoxAscent === 'number' && metrics.actualBoundingBoxAscent > 0
        ? metrics.actualBoundingBoxAscent
        : staticTextRunFontSize(run) * 0.85;
    const descent =
      typeof metrics.actualBoundingBoxDescent === 'number' && metrics.actualBoundingBoxDescent > 0
        ? metrics.actualBoundingBoxDescent
        : staticTextRunFontSize(run) * 0.25;
    return {
      width: Number.isFinite(metrics.width) ? metrics.width : 0,
      ascent,
      descent,
    };
  };

  let resolvedSvg = svg;
  let totalRasterPixels = 0;
  const measuredBoundsByPlaceholderId = new Map<string, FlaStaticTextBounds>();

  for (const item of staticTexts) {
    const layout = layoutFlaStaticText(item.descriptor, measure);
    if (layout.truncated) {
      throw new Error(
        `BUDGET_EXCEEDED: Static text line count exceeds maximum ${FLA_STATIC_TEXT_LIMITS.maxLinesPerText} lines`,
      );
    }
    measuredBoundsByPlaceholderId.set(item.placeholderId, layout.bounds);
    const { x: bx, y: by, width: bw, height: bh } = layout.bounds;
    const desiredScale = Math.min(4, Math.max(1, item.scaleHint));
    const maxScaleX = FLA_STATIC_TEXT_LIMITS.maxRasterDimension / Math.max(1, bw);
    const maxScaleY = FLA_STATIC_TEXT_LIMITS.maxRasterDimension / Math.max(1, bh);
    const effectiveScale = Math.max(0.25, Math.min(desiredScale, maxScaleX, maxScaleY));
    const pixelWidth = Math.max(1, Math.min(FLA_STATIC_TEXT_LIMITS.maxRasterDimension, Math.ceil(bw * effectiveScale)));
    const pixelHeight = Math.max(1, Math.min(FLA_STATIC_TEXT_LIMITS.maxRasterDimension, Math.ceil(bh * effectiveScale)));

    totalRasterPixels += pixelWidth * pixelHeight;
    if (totalRasterPixels > FLA_STATIC_TEXT_LIMITS.maxTotalRasterPixels) {
      throw new Error('BUDGET_EXCEEDED: snapshot static text raster pixel budget exceeded');
    }

    const textCanvas = document.createElement('canvas');
    textCanvas.width = pixelWidth;
    textCanvas.height = pixelHeight;
    const ctx = textCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('snapshot static text draw context is unavailable');
    }
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);
    ctx.scale(pixelWidth / bw, pixelHeight / bh);
    ctx.translate(-bx, -by);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    for (const line of layout.lines) {
      for (const fragment of line.fragments) {
        if (fragment.text.length === 0) continue;
        ctx.font = buildCanvasFontSpec(fragment.run);
        ctx.fillStyle = fragment.run.fillColor;
        ctx.globalAlpha = fragment.run.alpha;
        const baseline = line.baselineY + staticTextRunBaselineOffset(fragment.run);
        const angle = (fragment.run.rotation ?? 0) * Math.PI / 180;
        if (fragment.run.letterSpacing === 0 && angle === 0) {
          ctx.fillText(fragment.text, fragment.x, baseline);
        } else {
          let cursorX = fragment.x;
          for (const grapheme of splitGraphemes(fragment.text)) {
            if (angle === 0) {
              ctx.fillText(grapheme, cursorX, baseline);
            } else {
              ctx.save();
              ctx.translate(cursorX, baseline);
              ctx.rotate(angle);
              ctx.fillText(grapheme, 0, 0);
              ctx.restore();
            }
            cursorX += ctx.measureText(grapheme).width + fragment.run.letterSpacing;
          }
        }
        if (fragment.run.underline && fragment.width > 0) {
          const underlineY = baseline + Math.max(1, staticTextRunFontSize(fragment.run) * 0.12);
          const underlineHeight = Math.max(1, fragment.run.size * 0.06);
          ctx.fillRect(fragment.x, underlineY, fragment.width, underlineHeight);
        }
      }
    }

    const dataUri = textCanvas.toDataURL('image/png');
    const placeholderPattern = new RegExp(
      `<image id="${item.placeholderId}"[^>]*\\/>`,
      'u',
    );
    const replacement =
      `<image id="${item.placeholderId}" x="${formatNum(bx)}" y="${formatNum(by)}" ` +
      `width="${formatNum(bw)}" height="${formatNum(bh)}" preserveAspectRatio="none" href="${dataUri}"/>`;
    resolvedSvg = resolvedSvg.replace(placeholderPattern, () => replacement);
  }

  let sourceViewport: { x: number; y: number; width: number; height: number } | undefined;
  if (graphicFraming) {
    const authoritative = computeAuthoritativeGraphicViewport(graphicFraming, measuredBoundsByPlaceholderId);
    if (!authoritative) {
      throw new Error('BUDGET_EXCEEDED: Graphic static text viewport is not finite');
    }
    if (
      authoritative.outputWidth > FLA_SNAPSHOT_MAX_WIDTH ||
      authoritative.outputHeight > FLA_SNAPSHOT_MAX_HEIGHT ||
      authoritative.outputWidth * authoritative.outputHeight > FLA_SNAPSHOT_MAX_PIXELS
    ) {
      throw new Error(
        `BUDGET_EXCEEDED: Measured Graphic viewport ${authoritative.outputWidth}x${authoritative.outputHeight} exceeds snapshot budget`,
      );
    }
    const vb = authoritative.viewBox;
    const vbAttr = `${formatNum(vb.x)} ${formatNum(vb.y)} ${formatNum(vb.width)} ${formatNum(vb.height)}`;
    resolvedSvg = resolvedSvg.replace(
      /<svg\b([^>]*)>/u,
      (_match, attrs: string) => {
        const updated = attrs
          .replace(/\bviewBox="[^"]*"/u, `viewBox="${vbAttr}"`)
          .replace(/\bwidth="[^"]*"/u, `width="${authoritative.outputWidth}"`)
          .replace(/\bheight="[^"]*"/u, `height="${authoritative.outputHeight}"`);
        return `<svg${updated}>`;
      },
    );
    resolvedSvg = resolvedSvg.replace(
      /<filter\b([^>]*filterUnits="userSpaceOnUse"[^>]*)>/gu,
      (_match, attrs: string) => {
        const updated = attrs
          .replace(/\bx="[^"]*"/u, `x="${formatNum(vb.x)}"`)
          .replace(/\by="[^"]*"/u, `y="${formatNum(vb.y)}"`)
          .replace(/\bwidth="[^"]*"/u, `width="${formatNum(vb.width)}"`)
          .replace(/\bheight="[^"]*"/u, `height="${formatNum(vb.height)}"`);
        return `<filter${updated}>`;
      },
    );
    sourceViewport = vb;
  }

  return {
    svg: resolvedSvg,
    ...(sourceViewport ? { sourceViewport } : {}),
  };
}

function rasterizeSvg(
  svg: string,
  profilingEnabled: boolean,
): Promise<{
  bytes: Uint8Array;
  width: number;
  height: number;
  profile?: Omit<NonNullable<FlaSnapshotRenderResult['profile']>, 'pngArraySerializeMs'>;
}> {
  return new Promise((resolve, reject) => {
    const totalStartedAt = profilingEnabled ? performance.now() : 0;
    const imageLoadStartedAt = profilingEnabled ? performance.now() : 0;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.decoding = 'sync';
    img.onload = () => {
      const imageLoadMs = profilingEnabled ? performance.now() - imageLoadStartedAt : 0;
      const width = img.naturalWidth || 0;
      const height = img.naturalHeight || 0;
      if (
        width <= 0 ||
        height <= 0 ||
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width > FLA_SNAPSHOT_MAX_WIDTH ||
        height > FLA_SNAPSHOT_MAX_HEIGHT
      ) {
        URL.revokeObjectURL(url);
        reject(new Error('snapshot SVG produced out-of-bounds dimensions'));
        return;
      }
      const canvas: HTMLCanvasElement | null = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      try {
        const canvasDrawStartedAt = profilingEnabled ? performance.now() : 0;
        const context = canvas.getContext('2d');
        if (!context) {
          URL.revokeObjectURL(url);
          reject(new Error('snapshot canvas 2D context is unavailable'));
          return;
        }
        context.clearRect(0, 0, width, height);
        context.drawImage(img, 0, 0, width, height);
        const canvasDrawMs = profilingEnabled ? performance.now() - canvasDrawStartedAt : 0;
        const pngEncodeStartedAt = profilingEnabled ? performance.now() : 0;
        canvas.toBlob((blob) => {
          const pngEncodeMs = profilingEnabled ? performance.now() - pngEncodeStartedAt : 0;
          if (!blob) {
            URL.revokeObjectURL(url);
            reject(new Error('snapshot PNG encoding failed'));
            return;
          }
          const pngArrayBufferStartedAt = profilingEnabled ? performance.now() : 0;
          void blob
            .arrayBuffer()
            .then((buffer) => {
              const pngArrayBufferMs = profilingEnabled
                ? performance.now() - pngArrayBufferStartedAt
                : 0;
              resolve({
                bytes: new Uint8Array(buffer),
                width,
                height,
                ...(profilingEnabled ? {
                  profile: {
                    imageLoadMs,
                    canvasDrawMs,
                    pngEncodeMs,
                    pngArrayBufferMs,
                    totalMs: performance.now() - totalStartedAt,
                  },
                } : {}),
              });
            })
            .catch((error: unknown) => {
              reject(error instanceof Error ? error : new Error(String(error)));
            })
            .finally(() => URL.revokeObjectURL(url));
        }, 'image/png');
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('snapshot SVG failed to load in the sandboxed renderer'));
    };
    img.src = url;
  });
}

async function handleRender(request: FlaSnapshotRenderRequest): Promise<void> {
  const renderer = window.pandaStageFlaSnapshotRenderer;
  try {
    const resolved = resolveStaticTextPlaceholders(
      request.svg,
      request.staticTexts,
      request.graphicFraming,
    );
    const rasterized = await rasterizeSvg(resolved.svg, renderer.issue762ProfileEnabled);
    const pngArraySerializeStartedAt = renderer.issue762ProfileEnabled ? performance.now() : 0;
    const png = Array.from(rasterized.bytes);
    const pngArraySerializeMs = renderer.issue762ProfileEnabled
      ? performance.now() - pngArraySerializeStartedAt
      : 0;
    renderer.renderResult({
      requestId: request.requestId,
      png,
      width: rasterized.width,
      height: rasterized.height,
      pixelCount: rasterized.width * rasterized.height,
      ...(resolved.sourceViewport ? { sourceViewport: resolved.sourceViewport } : {}),
      ...(request.returnResolvedSvg ? { resolvedSvg: resolved.svg } : {}),
      ...(rasterized.profile ? {
        profile: {
          ...rasterized.profile,
          pngArraySerializeMs,
          totalMs: rasterized.profile.totalMs + pngArraySerializeMs,
        },
      } : {}),
    });
  } catch (error) {
    renderer.renderError({
      requestId: request.requestId,
      message: error instanceof Error ? error.message : 'snapshot rasterization failed',
    });
  }
}

const snapshotRenderer = window.pandaStageFlaSnapshotRenderer;
snapshotRenderer.ready();
snapshotRenderer.onRender((request) => {
  void handleRender(request);
});

export {};
