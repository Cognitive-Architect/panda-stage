import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import {
  FlaCharacterCreateRequestSchema,
  FlaCharacterCreateResponseSchema,
  FlaCharacterCreateStatusRequestSchema,
  FlaCharacterCreateStatusResponseSchema,
  type FlaCharacterCreateRequest,
  type FlaCharacterCreateResult,
} from '../../shared/fla-character-create-api';
import { IPC_CHANNELS } from '../../shared/ipc/channels';
import {
  FlaCharacterCreateService,
  FlaCharacterCreateServiceError,
} from '../services/FlaCharacterCreateService';

export interface FlaCharacterCreateIpcDependencies {
  getMainWindow: () => BrowserWindow | null;
  service: FlaCharacterCreateService;
  afterCommitBeforeResponse?: (
    request: FlaCharacterCreateRequest,
    result: FlaCharacterCreateResult,
  ) => void | Promise<void>;
}

function assertTrustedSender(event: IpcMainInvokeEvent, expectedWindow: BrowserWindow | null): void {
  if (!expectedWindow || expectedWindow.isDestroyed() || event.sender.id !== expectedWindow.webContents.id) {
    throw new Error('Untrusted FLA character creation IPC sender');
  }
}

function failure(error: unknown, operationId?: string) {
  const code = error instanceof FlaCharacterCreateServiceError
    ? error.code
    : 'COMMIT_FAILED';
  const message = error instanceof Error
    ? error.message.slice(0, 1_000)
    : 'FLA character creation failed.';
  return FlaCharacterCreateResponseSchema.parse({
    ok: false,
    status: 'ERROR',
    ...(operationId ? { operationId } : {}),
    error: { code, message },
  });
}

export function registerFlaCharacterCreateIpcHandlers(
  dependencies: FlaCharacterCreateIpcDependencies,
): () => void {
  const commit = async (event: IpcMainInvokeEvent, rawRequest: unknown) => {
    assertTrustedSender(event, dependencies.getMainWindow());
    const parsed = FlaCharacterCreateRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      return failure(new FlaCharacterCreateServiceError('INVALID_REQUEST', 'Invalid F1-03 Character creation request.'));
    }
    let result: FlaCharacterCreateResult;
    try {
      result = await dependencies.service.commit(parsed.data);
    } catch (error) {
      return failure(error, parsed.data.operationId);
    }
    await dependencies.afterCommitBeforeResponse?.(parsed.data, result);
    return FlaCharacterCreateResponseSchema.parse({ ok: true, status: 'COMMITTED', result });
  };

  const status = async (event: IpcMainInvokeEvent, rawRequest: unknown) => {
    assertTrustedSender(event, dependencies.getMainWindow());
    const parsed = FlaCharacterCreateStatusRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      return FlaCharacterCreateStatusResponseSchema.parse({
        ok: false,
        status: 'ERROR',
        error: { code: 'INVALID_REQUEST', message: 'Invalid F1-03 operation status request.' },
      });
    }
    return FlaCharacterCreateStatusResponseSchema.parse(
      await dependencies.service.getStatus(parsed.data),
    );
  };

  ipcMain.handle(IPC_CHANNELS.FLA_CHARACTER_CREATE, commit);
  ipcMain.handle(IPC_CHANNELS.FLA_CHARACTER_CREATE_STATUS, status);
  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.FLA_CHARACTER_CREATE);
    ipcMain.removeHandler(IPC_CHANNELS.FLA_CHARACTER_CREATE_STATUS);
  };
}
