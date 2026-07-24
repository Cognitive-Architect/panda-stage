import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../src/domain';
import { AutosaveService } from '../../src/main/services/AutosaveService';
import {
  RecoveryService,
  RecoveryServiceError,
} from '../../src/main/services/RecoveryService';
import { AUTOSAVE_INTERVAL_MS } from '../../src/shared/recovery-api';
import exampleProject from '../../demo-project/project-v1.example.json';
import { ProjectSchema } from '../../src/domain';

const PROJECT_ROOT = 'D:\\projects\\autosave.pandastage';

function project(name: string): Project {
  return ProjectSchema.parse({ ...structuredClone(exampleProject), name });
}

function recoveryService(
  writeRecovery: ReturnType<typeof vi.fn>,
): RecoveryService {
  return { writeRecovery } as unknown as RecoveryService;
}

describe('AutosaveService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('writes once after 30 seconds only when a newer dirty revision exists', async () => {
    const writeRecovery = vi.fn().mockResolvedValue({});
    const service = new AutosaveService({
      recoveryService: recoveryService(writeRecovery),
    });
    service.track({
      projectRoot: PROJECT_ROOT,
      project: project('Clean'),
      dirty: false,
      revision: 0,
    });
    service.track({
      projectRoot: PROJECT_ROOT,
      project: project('Clean'),
      dirty: false,
      revision: 0,
    });
    expect(vi.getTimerCount()).toBe(1);
    service.update({
      projectRoot: PROJECT_ROOT,
      project: project('Dirty revision'),
      dirty: true,
      revision: 1,
    });

    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS - 1);
    expect(writeRecovery).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await service.waitForIdle(PROJECT_ROOT);
    expect(writeRecovery).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS * 3);
    expect(writeRecovery).toHaveBeenCalledTimes(1);

    await service.stop(PROJECT_ROOT);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never overlaps writes and saves a newer revision on a later tick', async () => {
    let finishFirst: (() => void) | null = null;
    let activeWrites = 0;
    let maximumActiveWrites = 0;
    const writeRecovery = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            activeWrites += 1;
            maximumActiveWrites = Math.max(
              maximumActiveWrites,
              activeWrites,
            );
            finishFirst = () => {
              activeWrites -= 1;
              resolve();
            };
          }),
      )
      .mockImplementationOnce(async () => {
        activeWrites += 1;
        maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
        activeWrites -= 1;
      });
    const service = new AutosaveService({
      recoveryService: recoveryService(writeRecovery),
    });
    service.track({
      projectRoot: PROJECT_ROOT,
      project: project('Clean'),
      dirty: false,
      revision: 0,
    });
    service.update({
      projectRoot: PROJECT_ROOT,
      project: project('Revision 1'),
      dirty: true,
      revision: 1,
    });

    const firstTick = service.tick(PROJECT_ROOT);
    service.update({
      projectRoot: PROJECT_ROOT,
      project: project('Revision 2'),
      dirty: true,
      revision: 2,
    });
    const overlappingTick = service.tick(PROJECT_ROOT);

    expect(writeRecovery).toHaveBeenCalledTimes(1);
    finishFirst!();
    await Promise.all([firstTick, overlappingTick]);
    await service.tick(PROJECT_ROOT);

    expect(writeRecovery).toHaveBeenCalledTimes(2);
    expect(maximumActiveWrites).toBe(1);
    await service.stop(PROJECT_ROOT);
  });

  it('skips clean sessions and reports periodic write failures clearly', async () => {
    const onError = vi.fn();
    const writeRecovery = vi.fn().mockRejectedValue(
      new RecoveryServiceError(
        'RECOVERY_WRITE_FAILED',
        PROJECT_ROOT,
        'Injected recovery failure.',
      ),
    );
    const service = new AutosaveService({
      recoveryService: recoveryService(writeRecovery),
      onError,
    });
    service.track({
      projectRoot: PROJECT_ROOT,
      project: project('Clean'),
      dirty: false,
      revision: 0,
    });

    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
    expect(writeRecovery).not.toHaveBeenCalled();

    service.update({
      projectRoot: PROJECT_ROOT,
      project: project('Dirty'),
      dirty: true,
      revision: 1,
    });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'RECOVERY_WRITE_FAILED',
        projectRoot: PROJECT_ROOT,
      }),
    );
    await service.stop(PROJECT_ROOT);
  });

  it('releases every project timer on application shutdown', async () => {
    const writeRecovery = vi.fn().mockResolvedValue({});
    const service = new AutosaveService({
      recoveryService: recoveryService(writeRecovery),
    });
    service.track({
      projectRoot: PROJECT_ROOT,
      project: project('First'),
      dirty: false,
      revision: 0,
    });
    service.track({
      projectRoot: 'D:\\projects\\second.pandastage',
      project: project('Second'),
      dirty: false,
      revision: 0,
    });
    expect(vi.getTimerCount()).toBe(2);

    await service.stopAll();

    expect(service.trackedProjectCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
