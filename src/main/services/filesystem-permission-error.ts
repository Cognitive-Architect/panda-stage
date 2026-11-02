export type FilesystemPermissionErrorCode = 'EACCES' | 'EPERM' | 'EROFS';

export function filesystemPermissionErrorCode(
  error: unknown,
): FilesystemPermissionErrorCode | null {
  const seen = new Set<object>();
  let current = error;

  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    const candidate = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (
      typeof candidate.code === 'string' &&
      ['EACCES', 'EPERM', 'EROFS'].includes(candidate.code)
    ) {
      return candidate.code as FilesystemPermissionErrorCode;
    }
    if (typeof candidate.message === 'string') {
      const code = candidate.message.match(/\b(EACCES|EPERM|EROFS)\b/u)?.[1];
      if (code) return code as FilesystemPermissionErrorCode;
      if (/(permission denied|access is denied)/iu.test(candidate.message)) {
        return 'EACCES';
      }
    }
    current = candidate.cause;
  }

  if (typeof current === 'string') {
    const code = current.match(/\b(EACCES|EPERM|EROFS)\b/u)?.[1];
    if (code) return code as FilesystemPermissionErrorCode;
    if (/(permission denied|access is denied)/iu.test(current)) return 'EACCES';
  }

  return null;
}
