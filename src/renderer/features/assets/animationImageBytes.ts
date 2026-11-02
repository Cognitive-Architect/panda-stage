export function copyAnimationImageBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

export function createAnimationImageBlob(bytes: Uint8Array, mimeType: string): Blob {
  return new Blob([copyAnimationImageBytes(bytes)], { type: mimeType });
}
