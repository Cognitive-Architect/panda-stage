import {
  FlaAdapterError,
  adaptFlaDocument,
} from './fla-viewer-adapter';
import type { FlaWorkerStartRequest } from '../../shared/fla-import-api';

const cancelledSessions = new Set<string>();

function safeMessage(error: unknown): string {
  if (error instanceof FlaAdapterError) return error.message;
  if (error instanceof Error && error.message.trim()) {
    return error.message
      .replace(/[a-zA-Z]:[\\/][^\s)]+/gu, '<source>')
      .slice(0, 900);
  }
  return 'The isolated FLA parser failed while inspecting the source';
}

function errorCode(error: unknown): FlaAdapterError['code'] {
  if (error instanceof FlaAdapterError) return error.code;
  const message = safeMessage(error).toLocaleLowerCase('en-US');
  if (message.includes('image') || message.includes('bitmap')) return 'MEDIA_DECODE_FAILED';
  if (message.includes('domdocument') || message.includes('xml')) return 'MALFORMED_XFL';
  return 'PARSER_CRASH';
}

async function inspect(request: FlaWorkerStartRequest): Promise<void> {
  const { sessionId, source } = request;
  try {
    const ir = await adaptFlaDocument(
      source,
      (message) => window.pandaStageFlaParser.progress({ sessionId, message }),
      () => cancelledSessions.has(sessionId),
    );
    if (cancelledSessions.has(sessionId)) {
      window.pandaStageFlaParser.error({
        sessionId,
        error: { code: 'USER_CANCELLED', message: 'FLA inspection was cancelled' },
      });
      return;
    }
    window.pandaStageFlaParser.result({ sessionId, ir });
  } catch (error) {
    window.pandaStageFlaParser.error({
      sessionId,
      error: {
        code: errorCode(error),
        message: safeMessage(error),
      },
    });
  } finally {
    cancelledSessions.delete(sessionId);
  }
}

window.pandaStageFlaParser.onCancel((sessionId) => {
  cancelledSessions.add(sessionId);
});
window.pandaStageFlaParser.onStart((request) => {
  void inspect(request);
});
window.pandaStageFlaParser.ready();
