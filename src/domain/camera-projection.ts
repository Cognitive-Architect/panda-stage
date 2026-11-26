export interface CameraView {
  centerX: number;
  centerY: number;
  zoom: number;
  rotationDeg?: number;
}

const NATIVE_CAMERA_FOCAL_LENGTH = 1_000;
const NATIVE_CAMERA_NEAR_DISTANCE = 10;

export function cameraWorldTransform(camera: CameraView | undefined, width: number, height: number) {
  return {
    x: width / 2,
    y: height / 2,
    offsetX: camera?.centerX ?? width / 2,
    offsetY: camera?.centerY ?? height / 2,
    scaleX: camera?.zoom ?? 1,
    scaleY: camera?.zoom ?? 1,
    rotation: -(camera?.rotationDeg ?? 0) % 360,
  };
}

function nativeCameraPlaneMetrics(zoom: number, depth: number): { distance: number; restDistance: number } | null {
  if (!Number.isFinite(zoom) || zoom <= 0 || !Number.isFinite(depth)) return null;
  const distance = NATIVE_CAMERA_FOCAL_LENGTH / zoom + depth;
  const restDistance = NATIVE_CAMERA_FOCAL_LENGTH + depth;
  if (!Number.isFinite(distance) || distance < NATIVE_CAMERA_NEAR_DISTANCE || !Number.isFinite(restDistance) || restDistance <= 0) {
    return null;
  }
  return { distance, restDistance };
}

/** A rest-normalized top-level plane. Null means only this plane is clipped. */
export function cameraLayerTransform(
  camera: CameraView | undefined,
  width: number,
  height: number,
  depth: number,
  space: 'world' | 'screen',
): ReturnType<typeof cameraWorldTransform> | null {
  if (!camera || space === 'screen') return cameraWorldTransform(undefined, width, height);
  if (depth === 0) return cameraWorldTransform(camera, width, height);
  const plane = nativeCameraPlaneMetrics(camera.zoom, depth);
  if (!plane) return null;
  const pan = NATIVE_CAMERA_FOCAL_LENGTH / plane.restDistance;
  const centerX = width / 2;
  const centerY = height / 2;
  return cameraWorldTransform({
    ...camera,
    centerX: centerX + (camera.centerX - centerX) * pan,
    centerY: centerY + (camera.centerY - centerY) * pan,
    zoom: plane.restDistance / plane.distance,
  }, width, height);
}

/**
 * Invert `cameraLayerTransform` at `zoom` so a world-space point on `depth`
 * projects onto the stage center. Returns `null` for screen-space planes or
 * planes clipped at `zoom`.
 */
export function solveCameraCenterForWorldPoint(
  worldX: number,
  worldY: number,
  width: number,
  height: number,
  zoom: number,
  depth: number,
  space: 'world' | 'screen',
): { centerX: number; centerY: number } | null {
  if (space === 'screen') return null;
  if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
  if (depth === 0) return { centerX: worldX, centerY: worldY };
  const plane = nativeCameraPlaneMetrics(zoom, depth);
  if (!plane) return null;
  const pan = NATIVE_CAMERA_FOCAL_LENGTH / plane.restDistance;
  const stageCenterX = width / 2;
  const stageCenterY = height / 2;
  return {
    centerX: stageCenterX + (worldX - stageCenterX) / pan,
    centerY: stageCenterY + (worldY - stageCenterY) / pan,
  };
}
