import path from 'node:path';

export class PathService {
  private readonly pathImplementation: path.PlatformPath;

  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
  ) {
    this.pathImplementation =
      platform === 'win32' ? path.win32 : path.posix;
  }

  resolve(rawPath: string): string {
    const value = rawPath.trim();
    if (!value) throw new Error('Path must not be empty.');
    return this.pathImplementation.resolve(value);
  }

  comparisonKey(rawPath: string): string {
    const resolved = this.resolve(rawPath);
    return this.platform === 'win32'
      ? resolved.toLocaleLowerCase('en-US')
      : resolved;
  }

  same(left: string, right: string): boolean {
    return this.comparisonKey(left) === this.comparisonKey(right);
  }

  join(root: string, ...segments: string[]): string {
    return this.pathImplementation.join(this.resolve(root), ...segments);
  }

  basename(rawPath: string): string {
    return this.pathImplementation.basename(this.resolve(rawPath));
  }
}
