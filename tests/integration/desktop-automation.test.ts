import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { BrowserWindow, IpcMain } from 'electron';
import { expect, it, vi } from 'vitest';
import { startDesktopAutomation } from '../../src/main/ipc/desktop-automation';
import { DesktopAutomationRendererRequestSchema } from '../../src/shared/desktop-automation-api';
import { IPC_CHANNELS } from '../../src/shared/ipc/channels';

const exec = promisify(execFile);

it('serves the real CLI over the local session and accepts only the verified editor response', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'panda-live-'));
  const senderFrame = { routingId: 9 };
  const ipc = Object.assign(new EventEmitter(), { handle: vi.fn(), removeHandler: vi.fn() });
  const sender = { id: 11, mainFrame: senderFrame, isLoadingMainFrame: () => false,
    send: vi.fn((channel: string, raw: unknown) => {
      expect(channel).toBe(IPC_CHANNELS.DESKTOP_AUTOMATION_REQUEST);
      const request = DesktopAutomationRendererRequestSchema.parse(raw);
      ipc.emit(IPC_CHANNELS.DESKTOP_AUTOMATION_RESPONSE, { sender, senderFrame: { routingId: 10 } }, {
        requestId: request.requestId, result: { ok: true, data: { incorrectFrame: true } },
      });
      ipc.emit(IPC_CHANNELS.DESKTOP_AUTOMATION_RESPONSE, { sender, senderFrame }, {
        requestId: request.requestId, result: { ok: true, data: { name: 'Current editor', sessionId: request.sessionId } },
      });
    }) };
  const cli = path.resolve('scripts/panda-live.cjs');
  const close = await startDesktopAutomation({ ipcMain: ipc as unknown as IpcMain, userData: dir, cliFile: cli, appVersion: '0.1.0',
    getWindow: () => ({ isDestroyed: () => false, webContents: sender }) as unknown as BrowserWindow });
  try {
    const descriptorName = (await readdir(dir)).find(name => name.startsWith('desktop-automation-'))!;
    const descriptorFile = path.join(dir, descriptorName);
    const result = await exec(process.execPath, [cli, '--session-file', descriptorFile, 'state']);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, data: { name: 'Current editor' } });
    expect(JSON.parse(result.stdout).data).not.toHaveProperty('incorrectFrame');

    const altered = path.join(dir, 'incorrect.json');
    const descriptor = JSON.parse(await readFile(descriptorFile, 'utf8'));
    await writeFile(altered, JSON.stringify({ ...descriptor, credential: '0'.repeat(64) }));
    await expect(exec(process.execPath, [cli, '--session-file', altered, 'state'])).rejects.toMatchObject({
      stdout: expect.stringContaining('UNAUTHORIZED'),
    });
    await expect(exec(process.execPath, [cli, '--session-file', descriptorFile, 'unknown'])).rejects.toMatchObject({
      stdout: expect.stringContaining('INVALID_REQUEST'),
    });
    expect(sender.send).toHaveBeenCalledTimes(1);
  } finally {
    close();
    await rm(dir, { recursive: true, force: true });
  }
});
