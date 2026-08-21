/**
 * V2-R1 Static Snapshot — sandboxed snapshot rasterizer.
 *
 * Issue #287 R1-B. Runs inside the isolated BrowserWindow created by
 * FlaStaticSnapshotWindowManager. It receives a Panda-built, bounded SVG
 * string (never the FLA source), draws it onto a transparent canvas, and
 * returns the encoded PNG bytes. The SVG is self-contained vector content
 * (no <image>/<script>/external refs), so the canvas is never tainted and
 * toBlob/toDataURL is safe.
 *
 * Isolation guarantees (per R1-B / R0 invariants):
 *  - no Node, no fs, no network (sandbox + CSP);
 *  - no ActionScript execution (the SVG builder rejects <Script>/<DOMScript>);
 *  - only the bounded SVG in, only bounded PNG bytes out.
 */

interface FlaSnapshotRenderRequest {
  requestId: string;
  svg: string;
}

interface FlaSnapshotRenderResult {
  requestId: string;
  png: number[];
  width: number;
  height: number;
  pixelCount: number;
}

interface FlaSnapshotRendererApi {
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

const MAX_SNAPSHOT_DIMENSION = 4_096;

function rasterizeSvg(
  svg: string,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.decoding = 'sync';
    img.onload = () => {
      const width = img.naturalWidth || 0;
      const height = img.naturalHeight || 0;
      if (
        width <= 0 ||
        height <= 0 ||
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width > MAX_SNAPSHOT_DIMENSION ||
        height > MAX_SNAPSHOT_DIMENSION
      ) {
        URL.revokeObjectURL(url);
        reject(new Error('snapshot SVG produced out-of-bounds dimensions'));
        return;
      }
      const canvas: HTMLCanvasElement | null = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      try {
        const context = canvas.getContext('2d');
        if (!context) {
          URL.revokeObjectURL(url);
          reject(new Error('snapshot canvas 2D context is unavailable'));
          return;
        }
        context.clearRect(0, 0, width, height);
        context.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) {
            URL.revokeObjectURL(url);
            reject(new Error('snapshot PNG encoding failed'));
            return;
          }
          void blob
            .arrayBuffer()
            .then((buffer) => {
              resolve({ bytes: new Uint8Array(buffer), width, height });
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
    const rasterized = await rasterizeSvg(request.svg);
    renderer.renderResult({
      requestId: request.requestId,
      png: Array.from(rasterized.bytes),
      width: rasterized.width,
      height: rasterized.height,
      pixelCount: rasterized.width * rasterized.height,
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
