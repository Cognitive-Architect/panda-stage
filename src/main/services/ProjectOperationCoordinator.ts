import path from 'node:path';

export class ProjectOperationCoordinator {
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(
    rawProjectRoot: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const projectRoot = path.resolve(rawProjectRoot);
    const previous = this.tails.get(projectRoot);
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = (previous ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => turn);
    this.tails.set(projectRoot, tail);

    if (previous) {
      await previous.catch(() => undefined);
    }
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(projectRoot) === tail) {
        this.tails.delete(projectRoot);
      }
    }
  }

  queuedProjectCount(): number {
    return this.tails.size;
  }
}
