import { randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Project } from '../../domain';
import { HashService } from './HashService';

const JOURNAL_FILE_NAME = '.fla-asset-commit-journal.json';
const JOURNAL_TEMP_PREFIX = '.fla-asset-commit-journal.';
const ASSET_TEMP_PREFIX = '.fla-asset-commit.';
const MAX_JOURNAL_BYTES = 4 * 1024 * 1024;

const JournalEntrySchema = z
  .object({
    assetId: z.string().trim().min(1).max(200),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    temporaryFileName: z
      .string()
      .regex(/^\.fla-asset-commit\.[a-f0-9-]+\.tmp$/u),
    targetFileName: z
      .string()
      .regex(/^[^\\/]+\.png$/u)
      .max(260),
  })
  .strict();

const JournalSchema = z
  .object({
    version: z.literal(1),
    operationId: z.uuid(),
    projectId: z.string().trim().min(1).max(200),
    baseRevision: z.number().int().nonnegative(),
    phase: z.enum(['planned', 'staged', 'finalized', 'project-saved']),
    entries: z.array(JournalEntrySchema).min(1).max(2_048),
  })
  .strict();

export type FlaAssetCommitJournal = z.infer<typeof JournalSchema>;
export type FlaAssetCommitJournalEntry = z.infer<typeof JournalEntrySchema>;

export interface FlaAssetCommitJournalFaultInjector {
  beforeWrite?(journal: FlaAssetCommitJournal): void | Promise<void>;
  afterSync?(journal: FlaAssetCommitJournal): void | Promise<void>;
  beforeClear?(): void | Promise<void>;
}

export interface FlaAssetCommitRecoveryResult {
  hadJournal: boolean;
  projectWasSaved: boolean;
  removedPaths: readonly string[];
}

export class FlaAssetCommitJournalService {
  private readonly faults: FlaAssetCommitJournalFaultInjector;
  private readonly hashService: HashService;

  constructor(
    faults: FlaAssetCommitJournalFaultInjector = {},
    hashService = new HashService(),
  ) {
    this.faults = faults;
    this.hashService = hashService;
  }

  journalPath(projectRoot: string): string {
    return path.join(projectRoot, 'recovery', JOURNAL_FILE_NAME);
  }

  async write(
    projectRoot: string,
    rawJournal: FlaAssetCommitJournal,
  ): Promise<void> {
    const journal = JournalSchema.parse(rawJournal);
    const serialized = `${JSON.stringify(journal)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_JOURNAL_BYTES) {
      throw new Error('FLA Asset commit journal exceeds its bounded size.');
    }
    const recoveryDirectory = path.join(projectRoot, 'recovery');
    await mkdir(recoveryDirectory, { recursive: true });
    const temporaryPath = path.join(
      recoveryDirectory,
      `${JOURNAL_TEMP_PREFIX}${randomUUID()}.tmp`,
    );
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    let temporaryExists = false;
    try {
      await this.faults.beforeWrite?.(journal);
      handle = await open(temporaryPath, 'wx', 0o600);
      temporaryExists = true;
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await this.faults.afterSync?.(journal);
      await rename(temporaryPath, this.journalPath(projectRoot));
      temporaryExists = false;
    } finally {
      await handle?.close().catch(() => undefined);
      if (temporaryExists) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
      }
    }
  }

  async read(projectRoot: string): Promise<FlaAssetCommitJournal | null> {
    let bytes: Buffer;
    try {
      const fileStats = await stat(this.journalPath(projectRoot));
      if (!fileStats.isFile() || fileStats.size > MAX_JOURNAL_BYTES) {
        throw new Error('FLA Asset commit journal is invalid or too large.');
      }
      bytes = await readFile(this.journalPath(projectRoot));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    return JournalSchema.parse(JSON.parse(bytes.toString('utf8')));
  }

  async clear(projectRoot: string): Promise<void> {
    await this.faults.beforeClear?.();
    await rm(this.journalPath(projectRoot), { force: true });
  }

  /**
   * Reconciles one bounded journal before a project becomes available.  A
   * project-saved journal is retained only when every recorded ImageAsset and
   * target path is present in the durable project; otherwise all files owned
   * by the interrupted operation are removed.
   */
  async recover(
    projectRoot: string,
    project: Project,
  ): Promise<FlaAssetCommitRecoveryResult> {
    const removedPaths: string[] = [];
    await this.removeStaleTemporaryFiles(projectRoot, removedPaths);
    const journal = await this.read(projectRoot);
    if (!journal) {
      return {
        hadJournal: false,
        projectWasSaved: false,
        removedPaths,
      };
    }

    const projectWasSaved =
      journal.phase === 'project-saved' &&
      journal.entries.every((entry) =>
        project.assets.some(
          (asset) =>
            asset.id === entry.assetId &&
            asset.relativePath === `assets/${entry.targetFileName}` &&
            asset.sha256 === entry.sha256,
        ),
      );

    for (const entry of journal.entries) {
      if (!projectWasSaved) {
        await this.removeAssetFile(
          projectRoot,
          entry.targetFileName,
          removedPaths,
        );
      } else {
        if (!(await this.assetFileExists(projectRoot, entry.targetFileName))) {
          throw new Error(
            `FLA Asset commit journal references a missing committed file: ${entry.targetFileName}`,
          );
        }
        const fileHash = await this.hashService.hashFile(
          path.join(projectRoot, 'assets', entry.targetFileName),
        );
        if (fileHash.hex !== entry.sha256) {
          throw new Error(
            `FLA Asset commit journal references a changed committed file: ${entry.targetFileName}`,
          );
        }
      }
      await this.removeAssetFile(
        projectRoot,
        entry.temporaryFileName,
        removedPaths,
      );
    }
    await this.clear(projectRoot);
    return { hadJournal: true, projectWasSaved, removedPaths };
  }

  private async removeStaleTemporaryFiles(
    projectRoot: string,
    removedPaths: string[],
  ): Promise<void> {
    const assetsDirectory = path.join(projectRoot, 'assets');
    let entries: string[];
    try {
      entries = await readdir(assetsDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (
        !entry.startsWith(ASSET_TEMP_PREFIX) ||
        !entry.endsWith('.tmp')
      ) {
        continue;
      }
      await rm(path.join(assetsDirectory, entry), { force: true });
      removedPaths.push(`assets/${entry}`);
    }
  }

  private async removeAssetFile(
    projectRoot: string,
    fileName: string,
    removedPaths: string[],
  ): Promise<void> {
    const assetPath = path.join(projectRoot, 'assets', fileName);
    const existed = await this.assetFileExists(projectRoot, fileName);
    await rm(assetPath, { force: true });
    if (existed) removedPaths.push(`assets/${fileName}`);
  }

  private async assetFileExists(
    projectRoot: string,
    fileName: string,
  ): Promise<boolean> {
    if (path.basename(fileName) !== fileName || /[\\/]/u.test(fileName)) {
      throw new Error(`Unsafe FLA Asset journal path: ${fileName}`);
    }
    try {
      return (await stat(path.join(projectRoot, 'assets', fileName))).isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
}

export const FLA_ASSET_COMMIT_JOURNAL_FILE_NAME = JOURNAL_FILE_NAME;
