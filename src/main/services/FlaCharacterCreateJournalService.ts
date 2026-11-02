import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ProjectSchema, type Project } from '../../domain';
import {
  FlaCharacterCreateErrorCodeSchema,
  FlaCharacterCreateResultIdentitySchema,
  FlaCharacterCreateResultSchema,
  type FlaCharacterCreateErrorCode,
  type FlaCharacterCreateResult,
} from '../../shared/fla-character-create-api';
import { HashService } from './HashService';

const FILE_PREFIX = '.fla-character-create.';
const FILE_SUFFIX = '.json';
const TEMP_PREFIX = '.fla-character-create-journal.';
const MAX_JOURNAL_BYTES = 8 * 1024 * 1024;

const JournalFileSchema = z.object({
  assetId: z.string().trim().min(1).max(200),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  temporaryFileName: z.string().regex(/^\.fla-character-create\.[a-f0-9-]{36}\.\d+\.tmp$/u),
  targetFileName: z.string().regex(/^[^\\/]+\.png$/u).max(260),
}).strict();

const ResultIdentitySchema = FlaCharacterCreateResultIdentitySchema;

const JournalSchema = z.object({
  version: z.literal(1),
  operationId: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  projectId: z.string().trim().min(1).max(200),
  baseRevision: z.number().int().nonnegative(),
  savedRevision: z.number().int().nonnegative(),
  projectSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  phase: z.enum(['planned', 'staged', 'finalized', 'saving', 'committed']),
  result: ResultIdentitySchema,
  files: z.array(JournalFileSchema).max(24),
}).strict().superRefine((journal, context) => {
  if (journal.savedRevision !== journal.baseRevision + 1) {
    context.addIssue({ code: 'custom', path: ['savedRevision'], message: 'Character creation journal must describe one Project revision.' });
  }
  if (journal.result.operationId !== journal.operationId ||
      journal.result.projectId !== journal.projectId ||
      journal.result.baseRevision !== journal.baseRevision ||
      journal.result.savedRevision !== journal.savedRevision) {
    context.addIssue({ code: 'custom', path: ['result'], message: 'Journal result identity does not match the operation.' });
  }
});

const FailureReceiptSchema = z.object({
  version: z.literal(1),
  operationId: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  projectId: z.string().trim().min(1).max(200),
  baseRevision: z.number().int().nonnegative(),
  openInstanceId: z.number().int().positive(),
  error: z.object({
    code: FlaCharacterCreateErrorCodeSchema,
    message: z.string().trim().min(1).max(1_000),
  }).strict(),
}).strict();

export type FlaCharacterCreateJournal = z.infer<typeof JournalSchema>;
export type FlaCharacterCreateFailureReceipt = z.infer<typeof FailureReceiptSchema>;

export interface FlaCharacterCreateJournalFaultInjector {
  beforeWrite?(journal: FlaCharacterCreateJournal): void | Promise<void>;
  afterSync?(journal: FlaCharacterCreateJournal): void | Promise<void>;
  beforeClear?(operationId: string): void | Promise<void>;
}

export class FlaCharacterCreateJournalService {
  constructor(
    private readonly faults: FlaCharacterCreateJournalFaultInjector = {},
    private readonly hashService = new HashService(),
  ) {}

  directory(projectRoot: string): string {
    return path.join(projectRoot, 'recovery');
  }

  filePath(projectRoot: string, operationId: string): string {
    if (!z.uuid().safeParse(operationId).success) {
      throw new Error('Invalid FLA character creation operation ID.');
    }
    return path.join(this.directory(projectRoot), `${FILE_PREFIX}${operationId}${FILE_SUFFIX}`);
  }

  failureFilePath(projectRoot: string, operationId: string): string {
    if (!z.uuid().safeParse(operationId).success) {
      throw new Error('Invalid FLA character creation operation ID.');
    }
    return path.join(this.directory(projectRoot), `${FILE_PREFIX}${operationId}.failed.json`);
  }

  async write(projectRoot: string, rawJournal: FlaCharacterCreateJournal): Promise<void> {
    const journal = JournalSchema.parse(rawJournal);
    const serialized = `${JSON.stringify(journal)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_JOURNAL_BYTES) {
      throw new Error('FLA character creation journal exceeds its bounded size.');
    }
    const directory = this.directory(projectRoot);
    await mkdir(directory, { recursive: true });
    const temporaryPath = path.join(directory, `${TEMP_PREFIX}${journal.operationId}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    let temporaryExists = false;
    try {
      await this.faults.beforeWrite?.(journal);
      handle = await open(temporaryPath, 'w', 0o600);
      temporaryExists = true;
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await this.faults.afterSync?.(journal);
      await rename(temporaryPath, this.filePath(projectRoot, journal.operationId));
      temporaryExists = false;
    } finally {
      await handle?.close().catch(() => undefined);
      if (temporaryExists) await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  async read(projectRoot: string, operationId: string): Promise<FlaCharacterCreateJournal | null> {
    const filePath = this.filePath(projectRoot, operationId);
    let bytes: Buffer;
    try {
      const fileStats = await stat(filePath);
      if (!fileStats.isFile() || fileStats.size > MAX_JOURNAL_BYTES) {
        throw new Error('FLA character creation journal is invalid or too large.');
      }
      bytes = await readFile(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    return JournalSchema.parse(JSON.parse(bytes.toString('utf8')));
  }

  async writeFailure(
    projectRoot: string,
    rawReceipt: {
      version: 1;
      operationId: string;
      fingerprint: string;
      projectId: string;
      baseRevision: number;
      openInstanceId: number;
      error: { code: FlaCharacterCreateErrorCode; message: string };
    },
  ): Promise<void> {
    const receipt = FailureReceiptSchema.parse(rawReceipt);
    const serialized = `${JSON.stringify(receipt)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_JOURNAL_BYTES) {
      throw new Error('FLA character creation failure receipt exceeds its bounded size.');
    }
    const directory = this.directory(projectRoot);
    await mkdir(directory, { recursive: true });
    const temporaryPath = path.join(directory, `.fla-character-create-failure.${receipt.operationId}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    let temporaryExists = false;
    try {
      handle = await open(temporaryPath, 'wx', 0o600);
      temporaryExists = true;
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(temporaryPath, this.failureFilePath(projectRoot, receipt.operationId));
      temporaryExists = false;
    } finally {
      await handle?.close().catch(() => undefined);
      if (temporaryExists) await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  async readFailure(projectRoot: string, operationId: string): Promise<FlaCharacterCreateFailureReceipt | null> {
    const filePath = this.failureFilePath(projectRoot, operationId);
    let bytes: Buffer;
    try {
      const fileStats = await stat(filePath);
      if (!fileStats.isFile() || fileStats.size > MAX_JOURNAL_BYTES) {
        throw new Error('FLA character creation failure receipt is invalid or too large.');
      }
      bytes = await readFile(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    return FailureReceiptSchema.parse(JSON.parse(bytes.toString('utf8')));
  }

  async list(projectRoot: string): Promise<FlaCharacterCreateJournal[]> {
    let names: string[];
    try {
      names = await readdir(this.directory(projectRoot));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const journals: FlaCharacterCreateJournal[] = [];
    for (const name of names) {
      const match = /^\.fla-character-create\.([a-f0-9-]{36})\.json$/u.exec(name);
      if (!match?.[1]) continue;
      const journal = await this.read(projectRoot, match[1]);
      if (journal) journals.push(journal);
    }
    return journals;
  }

  async clear(projectRoot: string, operationId: string): Promise<void> {
    await this.faults.beforeClear?.(operationId);
    await rm(this.filePath(projectRoot, operationId), { force: true });
  }

  projectSha256(project: Project): string {
    return this.hashService.hashBytes(Buffer.from(JSON.stringify(ProjectSchema.parse(project)), 'utf8')).hex;
  }

  matchesCommittedProject(journal: FlaCharacterCreateJournal, project: Project): boolean {
    return this.projectSha256(project) === journal.projectSha256;
  }

  resultForProject(
    journal: FlaCharacterCreateJournal,
    project: Project,
  ): FlaCharacterCreateResult {
    return FlaCharacterCreateResultSchema.parse({
      ...journal.result,
      project: ProjectSchema.parse(project),
    });
  }
}
