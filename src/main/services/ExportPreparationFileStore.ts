import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  EXPORT_PREPARATION_MAX_SINGLE_ASSET_BYTES,
} from '../../shared/export-preparation-types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
};

export interface ExportPreparationFileStore {
  create(snapshotId: string): Promise<void>;
  writeAsset(
    snapshotId: string,
    contentHandleId: string,
    mimeType: string,
    bytes: Uint8Array,
  ): Promise<string>;
  readAsset?(
    snapshotId: string,
    contentHandleId: string,
    mimeType: string,
  ): Promise<Uint8Array<ArrayBuffer>>;
  delete(snapshotId: string): Promise<void>;
  dispose(): Promise<void>;
  disposeSync?(): void;
}

export class NodeExportPreparationFileStore
  implements ExportPreparationFileStore
{
  readonly rootDirectory: string;
  private readonly ownedSnapshotIds = new Set<string>();

  constructor(
    rootDirectory = path.join(
      os.tmpdir(),
      'panda-stage',
      'export-preparations',
    ),
  ) {
    this.rootDirectory = path.resolve(rootDirectory);
  }

  async create(snapshotId: string): Promise<void> {
    const directory = this.resolveSnapshotDirectory(snapshotId);
    await mkdir(this.rootDirectory, { recursive: true });
    await mkdir(directory, { recursive: false });
    this.ownedSnapshotIds.add(snapshotId);
  }

  async writeAsset(
    snapshotId: string,
    contentHandleId: string,
    mimeType: string,
    bytes: Uint8Array,
  ): Promise<string> {
    const directory = this.requireOwnedSnapshot(snapshotId);
    if (!UUID_PATTERN.test(contentHandleId)) {
      throw new Error('Invalid export preparation content handle.');
    }
    if (
      bytes.byteLength <= 0 ||
      bytes.byteLength > EXPORT_PREPARATION_MAX_SINGLE_ASSET_BYTES
    ) {
      throw new Error('Export preparation asset exceeds its file budget.');
    }
    const extension = EXTENSION_BY_MIME_TYPE[mimeType];
    if (!extension) throw new Error('Unsupported export preparation media type.');
    const relativePath = path.join('media', contentHandleId + extension);
    const target = path.resolve(directory, relativePath);
    if (!target.startsWith(directory + path.sep)) {
      throw new Error('Export preparation path escapes its owned directory.');
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx' });
    return relativePath.replaceAll(path.sep, '/');
  }

  async readAsset(
    snapshotId: string,
    contentHandleId: string,
    mimeType: string,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const directory = this.requireOwnedSnapshot(snapshotId);
    if (!UUID_PATTERN.test(contentHandleId)) {
      throw new Error('Invalid export preparation content handle.');
    }
    const extension = EXTENSION_BY_MIME_TYPE[mimeType];
    if (!extension) throw new Error('Unsupported export preparation media type.');
    const target = path.resolve(
      directory,
      'media',
      contentHandleId + extension,
    );
    if (!target.startsWith(directory + path.sep)) {
      throw new Error('Export preparation path escapes its owned directory.');
    }
    const bytes = await readFile(target);
    if (
      bytes.byteLength <= 0 ||
      bytes.byteLength > EXPORT_PREPARATION_MAX_SINGLE_ASSET_BYTES
    ) {
      throw new Error('Export preparation asset exceeds its file budget.');
    }
    return Uint8Array.from(bytes);
  }

  async delete(snapshotId: string): Promise<void> {
    const directory = this.resolveSnapshotDirectory(snapshotId);
    if (!this.ownedSnapshotIds.has(snapshotId)) return;
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 75,
    });
    this.ownedSnapshotIds.delete(snapshotId);
  }

  async dispose(): Promise<void> {
    const failures: unknown[] = [];
    for (const snapshotId of [...this.ownedSnapshotIds]) {
      try {
        await this.delete(snapshotId);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        'One or more export preparation snapshots could not be cleaned.',
      );
    }
  }

  disposeSync(): void {
    for (const snapshotId of [...this.ownedSnapshotIds]) {
      try {
        rmSync(this.resolveSnapshotDirectory(snapshotId), {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 75,
        });
        this.ownedSnapshotIds.delete(snapshotId);
      } catch {
        // will-quit cannot await; normal blocked/discard paths use async cleanup.
      }
    }
  }

  private requireOwnedSnapshot(snapshotId: string): string {
    if (!this.ownedSnapshotIds.has(snapshotId)) {
      throw new Error('Export preparation snapshot is not owned.');
    }
    return this.resolveSnapshotDirectory(snapshotId);
  }

  private resolveSnapshotDirectory(snapshotId: string): string {
    if (!UUID_PATTERN.test(snapshotId)) {
      throw new Error('Invalid export preparation snapshot ID.');
    }
    const directory = path.resolve(this.rootDirectory, snapshotId);
    if (!directory.startsWith(this.rootDirectory + path.sep)) {
      throw new Error('Export preparation path escapes its root.');
    }
    return directory;
  }
}
