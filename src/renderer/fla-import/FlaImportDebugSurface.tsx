import { useState } from 'react';
import type { FlaInspectionResponse } from '../../shared/fla-import-api';

type InspectionState = 'idle' | 'inspecting' | 'complete' | 'cancelled' | 'error';

function errorMessage(response: FlaInspectionResponse): string | null {
  return response.ok ? null : `${response.error.code}: ${response.error.message}`;
}

export function FlaImportDebugSurface(): React.JSX.Element {
  const [state, setState] = useState<InspectionState>('idle');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [response, setResponse] = useState<FlaInspectionResponse | null>(null);
  const [cancelAccepted, setCancelAccepted] = useState<boolean | null>(null);

  const inspect = async (): Promise<void> => {
    const nextRequestId = crypto.randomUUID();
    setRequestId(nextRequestId);
    setResponse(null);
    setCancelAccepted(null);
    setState('inspecting');
    try {
      const nextResponse = await window.pandaStage.fla.chooseAndInspect(nextRequestId);
      setResponse(nextResponse);
      setState(
        nextResponse.ok
          ? 'complete'
          : nextResponse.error.code === 'USER_CANCELLED'
            ? 'cancelled'
            : 'error',
      );
    } catch (error) {
      setResponse({
        ok: false,
        error: {
          code: 'PARSER_CRASH',
          message: error instanceof Error ? error.message : 'FLA inspection failed',
        },
      });
      setState('error');
    } finally {
      setRequestId(null);
    }
  };

  const cancel = async (): Promise<void> => {
    if (!requestId) return;
    const result = await window.pandaStage.fla.cancel(requestId);
    setCancelAccepted(result.accepted);
  };

  const summary = response?.ok ? response.ir : null;
  return (
    <section className="export-probe" aria-label="FLA import inspection">
      <h2>FLA V1 Slice 1 inspection</h2>
      <p>
        Read-only debug surface. It opens an FLA through Main, parses it in the
        isolated worker, and never writes Project or Asset data.
      </p>
      <div>
        <button disabled={state === 'inspecting'} onClick={() => void inspect()} type="button">
          {state === 'inspecting' ? 'Inspecting…' : 'Choose FLA and inspect'}
        </button>
        <button disabled={state !== 'inspecting'} onClick={() => void cancel()} type="button">
          Cancel inspection
        </button>
      </div>
      <output data-testid="fla-inspection-status">
        {state === 'idle' && 'Ready'}
        {state === 'inspecting' && 'Waiting for the isolated parser…'}
        {state === 'complete' && 'Inspection complete'}
        {state === 'cancelled' && 'Inspection cancelled'}
        {state === 'error' && (response ? errorMessage(response) : 'Inspection failed')}
        {cancelAccepted !== null ? ` Cancel accepted: ${cancelAccepted ? 'yes' : 'no'}.` : ''}
      </output>
      {summary ? (
        <output data-testid="fla-inspection-summary">
          {`${summary.source.basename} · ${summary.document.width}×${summary.document.height} @ ${summary.document.frameRate}fps · ${summary.media.length} media · ${summary.summary.placedInstanceCount} placed · ${summary.summary.libraryOnlyMediaCount} library-only · parser ${summary.source.parser.commit}`}
        </output>
      ) : null}
      {response?.trace ? (
        <output data-testid="fla-inspection-trace">
          {`${response.trace.ingestMode} · recoveryApplied=${response.trace.recoveryApplied ? 'true' : 'false'} · classifier=${response.trace.classifierState} · postStrict=${response.trace.postNormalizationStrictResult} · parser=${response.trace.parserResult}`}
        </output>
      ) : null}
    </section>
  );
}
