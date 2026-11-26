import {
  buildCanvasFontSpec,
  splitGraphemes,
  staticTextRunBaselineOffset,
  staticTextRunFontSize,
  type FlaStaticTextLayoutResult,
  type FlaStaticTextMeasurer,
} from '../shared/fla-static-text';

export function createCanvasStaticTextMeasurer(measureCtx: CanvasRenderingContext2D): FlaStaticTextMeasurer {
  let currentMeasureFont = '';
  return (text, run) => {
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
}

export function drawCanvasStaticText(
  ctx: CanvasRenderingContext2D, layout: FlaStaticTextLayoutResult, fillOverride?: string,
): void {
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  for (const line of layout.lines) {
    for (const fragment of line.fragments) {
      if (fragment.text.length === 0) continue;
      ctx.font = buildCanvasFontSpec(fragment.run);
      ctx.fillStyle = fillOverride ?? fragment.run.fillColor;
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
}
