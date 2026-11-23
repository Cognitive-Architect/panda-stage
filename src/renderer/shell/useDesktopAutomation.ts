import { useEffect } from 'react';
import type { DesktopAutomationRendererRequest, DesktopAutomationResult } from '../../shared/desktop-automation-api';
import { timelineUiStore } from '../features/timeline/timelineUiStore';
import { editorProjectStore } from '../stores/EditorProjectStore';
import { selectionStore } from '../stores/selectionStore';
import { shotStore } from '../stores/shotStore';

function readState(request: DesktopAutomationRendererRequest): DesktopAutomationResult {
  const snapshot = editorProjectStore.getSnapshot();
  const instanceId = editorProjectStore.getProjectInstanceId();
  if (!snapshot || instanceId === null) return { ok: false, code: 'NO_PROJECT', message: 'No Project is open in the desktop editor.' };
  const { project, revision, dirty } = snapshot;
  const shotId = shotStore.getCurrentShotId();
  const shot = project.shots.find(({ id }) => id === shotId);
  const selectedLayer = shot?.layers.find(({ id }) => id === selectionStore.getSelectedLayerId());
  return { ok: true, data: {
    appVersion: request.appVersion,
    session: { sessionId: request.sessionId, projectId: project.id, instanceId },
    project: { id: project.id, name: project.name, schemaVersion: project.schemaVersion, revision, dirty },
    shots: project.shots.map(({ id, name, durationMs }) => ({ id, name, durationMs })),
    shot: shot ? { id: shot.id, name: shot.name, durationMs: shot.durationMs,
      playheadMs: timelineUiStore.getSnapshot().currentTimeMs,
      dialogues: shot.dialogues.map(({ id, text, startMs, endMs }) => ({ id, text, startMs, endMs })),
      layers: shot.layers.map(({ id, name, locked }) => ({ id, name, locked })),
    } : null,
    selection: selectedLayer ? { layerId: selectedLayer.id, nodeId: selectionStore.getSelectedCharacterNodeId() } : null,
  } };
}

/** Bind the local bridge to the same live editor instance that owns Project and History. */
export function useDesktopAutomation(): void {
  useEffect(() => {
    const bridge = window.pandaStage?.desktopAutomation;
    return bridge?.onRequest(request => {
      const result: DesktopAutomationResult = Date.now() > request.deadlineMs
        ? { ok: false, code: 'TIMEOUT', message: 'The desktop command expired.' } : readState(request);
      bridge.respond({ requestId: request.requestId, result });
    });
  }, []);
}
