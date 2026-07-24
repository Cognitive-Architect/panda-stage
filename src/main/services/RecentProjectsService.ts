import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { migrateProject } from '../../domain';
import {
  ProjectDocumentSchema,
  type ProjectDocument,
} from '../../shared/project-api';
import {
  RecentProjectEntrySchema,
  type RecentProjectEntry,
  type RecentProjectsErrorCode,
} from '../../shared/recent-projects-api';
import { PathService } from './PathService';

const RECENT_PROJECTS_SCHEMA_VERSION = 1 as const;
const MAX_RECENT_PROJECTS = 12;

const StoredRecentProjectSchema = RecentProjectEntrySchema.omit({
  status: true,
});

const RecentProjectsConfigSchema = z
  .object({
    schemaVersion: z.literal(RECENT_PROJECTS_SCHEMA_VERSION),
    entries: z.array(StoredRecentProjectSchema).max(MAX_RECENT_PROJECTS),
  })
  .strict();

type StoredRecentProject = z.infer<typeof StoredRecentProjectSchema>;
type RecentProjectsConfig = z.infer<typeof RecentProjectsConfigSchema>;

export interface RecentProjectsServiceOptions {
  configurationFilePath: string;
  pathService?: PathService;
  now?: () => Date;
}

export class RecentProjectsServiceError extends Error {
  constructor(
    readonly code: RecentProjectsErrorCode,
    readonly projectRoot: string | null,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RecentProjectsServiceError';
  }
}

export class RecentProjectsService {
  private readonly configurationFilePath: string;
  private readonly pathService: PathService;
  private readonly now: () => Date;

  constructor(options: RecentProjectsServiceOptions) {
    this.configurationFilePath = path.resolve(
      options.configurationFilePath,
    );
    this.pathService = options.pathService ?? new PathService();
    this.now = options.now ?? (() => new Date());
  }

  configPath(): string {
    return this.configurationFilePath;
  }

  async list(): Promise<RecentProjectEntry[]> {
    const config = await this.readConfig();
    return Promise.all(
      config.entries.map(async (entry) => ({
        ...entry,
        status: await this.inspectStatus(entry),
      })),
    );
  }

  async record(rawDocument: ProjectDocument): Promise<RecentProjectEntry[]> {
    const document = ProjectDocumentSchema.parse(rawDocument);
    const config = await this.readConfig();
    const projectRoot = this.pathService.resolve(document.projectRoot);
    const key = this.pathService.comparisonKey(projectRoot);
    const conflict = config.entries.find(
      (candidate) =>
        this.pathService.comparisonKey(candidate.projectRoot) === key &&
        candidate.projectId !== document.project.id,
    );
    if (conflict) {
      throw new RecentProjectsServiceError(
        'RECENT_PROJECT_MISMATCH',
        projectRoot,
        `The path is already recorded for ${conflict.projectName}; resolve that identity conflict explicitly.`,
      );
    }
    const entry: StoredRecentProject = {
      projectId: document.project.id,
      projectName: document.project.name,
      projectRoot,
      lastOpenedAt: this.now().toISOString(),
    };
    const entries = [
      entry,
      ...config.entries.filter(
        (candidate) =>
          this.pathService.comparisonKey(candidate.projectRoot) !== key,
      ),
    ].slice(0, MAX_RECENT_PROJECTS);
    await this.writeConfig({ schemaVersion: 1, entries });
    return this.list();
  }

  async remove(rawProjectRoot: string): Promise<RecentProjectEntry[]> {
    const projectRoot = this.pathService.resolve(rawProjectRoot);
    const key = this.pathService.comparisonKey(projectRoot);
    const config = await this.readConfig();
    const entries = config.entries.filter(
      (entry) =>
        this.pathService.comparisonKey(entry.projectRoot) !== key,
    );
    await this.writeConfig({ schemaVersion: 1, entries });
    return this.list();
  }

  async relocate(
    rawPreviousRoot: string,
    rawDocument: ProjectDocument,
  ): Promise<RecentProjectEntry[]> {
    const previousRoot = this.pathService.resolve(rawPreviousRoot);
    const previousKey = this.pathService.comparisonKey(previousRoot);
    const document = ProjectDocumentSchema.parse(rawDocument);
    const config = await this.readConfig();
    const previous = config.entries.find(
      (entry) =>
        this.pathService.comparisonKey(entry.projectRoot) === previousKey,
    );
    if (!previous) {
      throw new RecentProjectsServiceError(
        'RECENT_PROJECT_NOT_FOUND',
        previousRoot,
        `Recent project was not found: ${previousRoot}`,
      );
    }
    if (previous.projectId !== document.project.id) {
      throw new RecentProjectsServiceError(
        'RECENT_PROJECT_MISMATCH',
        previousRoot,
        `The selected directory contains another project and cannot replace ${previous.projectName}.`,
      );
    }

    const nextRoot = this.pathService.resolve(document.projectRoot);
    const nextKey = this.pathService.comparisonKey(nextRoot);
    const relocated: StoredRecentProject = {
      projectId: document.project.id,
      projectName: document.project.name,
      projectRoot: nextRoot,
      lastOpenedAt: this.now().toISOString(),
    };
    const entries = [
      relocated,
      ...config.entries.filter((entry) => {
        const key = this.pathService.comparisonKey(entry.projectRoot);
        return key !== previousKey && key !== nextKey;
      }),
    ].slice(0, MAX_RECENT_PROJECTS);
    await this.writeConfig({ schemaVersion: 1, entries });
    return this.list();
  }

  private async inspectStatus(
    entry: StoredRecentProject,
  ): Promise<RecentProjectEntry['status']> {
    try {
      const serialized = await readFile(
        this.pathService.join(entry.projectRoot, 'project.json'),
        'utf8',
      );
      const project = migrateProject(JSON.parse(serialized));
      return project.id === entry.projectId
        ? 'available'
        : 'mismatched';
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === 'ENOENT' || code === 'ENOTDIR'
        ? 'missing'
        : 'invalid';
    }
  }

  private async readConfig(): Promise<RecentProjectsConfig> {
    let serialized: string;
    try {
      serialized = await readFile(this.configurationFilePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { schemaVersion: 1, entries: [] };
      }
      throw this.configError('RECENT_PROJECT_CONFIG_FAILED', error);
    }

    try {
      return RecentProjectsConfigSchema.parse(JSON.parse(serialized));
    } catch (error) {
      throw this.configError('RECENT_PROJECT_CONFIG_INVALID', error);
    }
  }

  private async writeConfig(config: RecentProjectsConfig): Promise<void> {
    const parsed = RecentProjectsConfigSchema.parse(config);
    const directory = path.dirname(this.configurationFilePath);
    const temporaryPath = path.join(
      directory,
      `.recent-projects.${randomUUID()}.tmp`,
    );
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(
        temporaryPath,
        `${JSON.stringify(parsed, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      );
      await rename(temporaryPath, this.configurationFilePath);
    } catch (error) {
      throw this.configError('RECENT_PROJECT_CONFIG_FAILED', error);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  private configError(
    code:
      | 'RECENT_PROJECT_CONFIG_INVALID'
      | 'RECENT_PROJECT_CONFIG_FAILED',
    error: unknown,
  ): RecentProjectsServiceError {
    return new RecentProjectsServiceError(
      code,
      null,
      `Recent projects configuration could not be ${code === 'RECENT_PROJECT_CONFIG_INVALID' ? 'read' : 'saved'}.`,
      { cause: error },
    );
  }
}
