import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import path from 'node:path';
import type { BrowserWindow, IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import {
  DESKTOP_AUTOMATION_MAX_REQUEST_BYTES, DESKTOP_AUTOMATION_PROTOCOL, DESKTOP_AUTOMATION_TIMEOUT_MS,
  DesktopAutomationRendererResponseSchema, DesktopAutomationSocketRequestSchema,
  type DesktopAutomationResult, type DesktopAutomationStatus,
} from '../../shared/desktop-automation-api';
import { IPC_CHANNELS } from '../../shared/ipc/channels';

type FailureCode = Extract<DesktopAutomationResult, { ok: false }>['code'];
const failure = (code: FailureCode, message: string): DesktopAutomationResult => ({ ok: false, code, message });

/** The local socket has only this set of typed commands and never calls IPC chosen by the client. */
export async function startDesktopAutomation(options: {
  ipcMain: IpcMain;
  getWindow: () => BrowserWindow | null;
  userData: string;
  appVersion: string;
  cliFile: string;
}): Promise<() => void> {
  const secret = randomBytes(32);
  const sessionId = randomUUID();
  const sessionFile = path.join(options.userData, `desktop-automation-${sessionId}.json`);
  const sockets = new Set<Socket>();
  const pending = new Map<string, { socket: Socket; timer: NodeJS.Timeout; senderId: number }>();
  let status: DesktopAutomationStatus = null;

  function complete(requestId: string, result: DesktopAutomationResult): void {
    const request = pending.get(requestId);
    if (!request) return;
    pending.delete(requestId);
    clearTimeout(request.timer);
    if (!request.socket.destroyed) request.socket.end(`${JSON.stringify(result)}\n`);
  }

  function trustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    const window = options.getWindow();
    return Boolean(window && !window.isDestroyed() && window.webContents.id === event.sender.id &&
      event.senderFrame?.routingId === window.webContents.mainFrame.routingId);
  }

  const onReply = (event: IpcMainEvent, value: unknown): void => {
    if (!trustedSender(event)) return;
    const parsed = DesktopAutomationRendererResponseSchema.safeParse(value);
    if (!parsed.success || pending.get(parsed.data.requestId)?.senderId !== event.sender.id) return;
    complete(parsed.data.requestId, parsed.data.result);
  };

  const server = createServer(socket => {
    sockets.add(socket);
    socket.setTimeout(DESKTOP_AUTOMATION_TIMEOUT_MS + 1_000);
    socket.on('timeout', () => socket.destroy());
    socket.on('error', () => socket.destroy());
    let activeRequestId: string | undefined;
    socket.on('close', () => {
      sockets.delete(socket);
      if (!activeRequestId) return;
      const request = pending.get(activeRequestId);
      if (request) clearTimeout(request.timer);
      pending.delete(activeRequestId);
    });
    let input = Buffer.alloc(0);

    function parseLine(chunk: Buffer): void {
      input = Buffer.concat([input, chunk]);
      if (input.length > DESKTOP_AUTOMATION_MAX_REQUEST_BYTES) {
        socket.removeListener('data', parseLine);
        socket.end(`${JSON.stringify(failure('INVALID_REQUEST', 'Request exceeds the local command size limit.'))}\n`);
        return;
      }
      const end = input.indexOf(10);
      if (end === -1) return;
      socket.removeListener('data', parseLine);
      let value: unknown;
      try { value = JSON.parse(input.subarray(0, end).toString('utf8')); } catch { /* validated below */ }
      const parsed = DesktopAutomationSocketRequestSchema.safeParse(value);
      if (!parsed.success || input.subarray(end + 1).toString('utf8').trim()) {
        socket.end(`${JSON.stringify(failure('INVALID_REQUEST', 'Unknown command or invalid parameters.'))}\n`);
        return;
      }
      if (!timingSafeEqual(Buffer.from(parsed.data.credential, 'hex'), secret)) {
        socket.end(`${JSON.stringify(failure('UNAUTHORIZED', 'The desktop session credential does not match.'))}\n`);
        return;
      }
      const window = options.getWindow();
      if (!window || window.isDestroyed() || window.webContents.isLoadingMainFrame()) {
        socket.end(`${JSON.stringify(failure('UNAVAILABLE', 'The desktop editor window is unavailable.'))}\n`);
        return;
      }
      const requestId = randomUUID();
      const deadlineMs = Date.now() + DESKTOP_AUTOMATION_TIMEOUT_MS;
      const timer = setTimeout(() => complete(requestId, failure('TIMEOUT', 'The editor did not complete this request in time.')),
        DESKTOP_AUTOMATION_TIMEOUT_MS);
      activeRequestId = requestId;
      pending.set(requestId, { socket, timer, senderId: window.webContents.id });
      try {
        window.webContents.send(IPC_CHANNELS.DESKTOP_AUTOMATION_REQUEST, {
          requestId, sessionId, deadlineMs, appVersion: options.appVersion, command: parsed.data.command,
        });
      } catch {
        complete(requestId, failure('UNAVAILABLE', 'The desktop editor window closed.'));
      }
    }

    socket.on('data', parseLine);
  });
  server.maxConnections = 32;

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    server.on('error', () => { status = null; });
    const bound = server.address();
    if (typeof bound !== 'object' || !bound) throw new Error('Desktop automation socket has no address.');
    await writeFile(sessionFile, JSON.stringify({ protocol: DESKTOP_AUTOMATION_PROTOCOL, port: bound.port,
      credential: secret.toString('hex') }), { mode: 0o600, flag: 'wx' });
    status = { protocol: DESKTOP_AUTOMATION_PROTOCOL, appVersion: options.appVersion, sessionFile, cliFile: options.cliFile };
  } catch (error) {
    server.close();
    for (const socket of sockets) socket.destroy();
    throw error;
  }

  options.ipcMain.handle(IPC_CHANNELS.DESKTOP_AUTOMATION_STATUS, (event, value: unknown) =>
    value === undefined && trustedSender(event) ? status : null);
  options.ipcMain.on(IPC_CHANNELS.DESKTOP_AUTOMATION_RESPONSE, onReply);
  return () => {
    status = null;
    options.ipcMain.removeHandler(IPC_CHANNELS.DESKTOP_AUTOMATION_STATUS);
    options.ipcMain.removeListener(IPC_CHANNELS.DESKTOP_AUTOMATION_RESPONSE, onReply);
    for (const { timer } of pending.values()) clearTimeout(timer);
    pending.clear();
    for (const socket of sockets) socket.destroy();
    server.close();
    try { unlinkSync(sessionFile); } catch { /* A stopped listener never accepts the orphaned credential. */ }
  };
}
