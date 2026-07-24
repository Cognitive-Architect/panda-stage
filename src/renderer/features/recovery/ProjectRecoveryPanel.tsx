import { useEffect, useState, useSyncExternalStore } from 'react';
import type { RecoveryCandidate } from '../../../shared/recovery-api';
import { editorProjectStore } from '../../stores/EditorProjectStore';

function failureMessage(
  response: { ok: boolean; error?: { message: string } },
  fallback: string,
): string {
  return response.ok ? fallback : response.error?.message ?? fallback;
}

export function ProjectRecoveryPanel(): React.JSX.Element | null {
  const projectSnapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const [projectRootInput, setProjectRootInput] = useState('');
  const [candidate, setCandidate] = useState<RecoveryCandidate | null>(null);
  const [trackedProjectRoot, setTrackedProjectRoot] = useState<string | null>(
    null,
  );
  const [status, setStatus] = useState(
    'Open a .pandastage project to check crash recovery.',
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => window.pandaStage.autosave.onError((error) => {
    setStatus(error.message);
  }), []);

  useEffect(
    () => () => {
      const current = editorProjectStore.getSnapshot();
      if (current) void window.pandaStage.autosave.stop(current.projectRoot);
    },
    [],
  );

  useEffect(() => {
    if (
      !projectSnapshot ||
      projectSnapshot.projectRoot !== trackedProjectRoot
    ) {
      return;
    }
    void window.pandaStage.autosave
      .update(projectSnapshot)
      .then((response) => {
        if (!response.ok) setStatus(response.error.message);
      });
  }, [projectSnapshot, trackedProjectRoot]);

  if (new URLSearchParams(window.location.search).get('gateA') === '1') {
    return null;
  }

  const openProject = async (): Promise<void> => {
    const projectRoot = projectRootInput.trim();
    if (!projectRoot) return;
    setBusy(true);
    try {
      const previous = editorProjectStore.getSnapshot();
      if (previous) {
        await window.pandaStage.autosave.stop(previous.projectRoot);
        setTrackedProjectRoot(null);
      }
      const opened = await window.pandaStage.project.open({ projectRoot });
      if (!opened.ok) throw new Error(opened.error.message);
      editorProjectStore.open(opened.value.projectRoot, opened.value.project);
      const snapshot = editorProjectStore.getSnapshot()!;
      const tracked = await window.pandaStage.autosave.track(snapshot);
      if (!tracked.ok) throw new Error(tracked.error.message);
      setTrackedProjectRoot(snapshot.projectRoot);
      const detected = await window.pandaStage.recovery.detect(
        snapshot.projectRoot,
      );
      if (!detected.ok) throw new Error(detected.error.message);
      setCandidate(detected.candidate);
      setStatus(
        detected.candidate
          ? 'A newer crash-recovery snapshot is available.'
          : 'Project opened. No newer recovery snapshot was found.',
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Open failed.');
    } finally {
      setBusy(false);
    }
  };

  const restoreRecovery = async (): Promise<void> => {
    if (!candidate) return;
    setBusy(true);
    try {
      const response = await window.pandaStage.recovery.restore({
        projectRoot: candidate.projectRoot,
        recoveryFilePath: candidate.recoveryFilePath,
      });
      if (!response.ok) throw new Error(response.error.message);
      editorProjectStore.restore(response.candidate.project);
      setCandidate(null);
      setStatus(
        'Recovery loaded in memory and marked dirty. Use Save recovered project to replace project.json.',
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Restore failed.');
    } finally {
      setBusy(false);
    }
  };

  const ignoreRecovery = async (): Promise<void> => {
    if (!candidate) return;
    setBusy(true);
    const response = await window.pandaStage.recovery.ignore({
      projectRoot: candidate.projectRoot,
      recoveryFilePath: candidate.recoveryFilePath,
    });
    if (response.ok) {
      setCandidate(null);
      setStatus(
        'Recovery ignored for this session. The evidence file was retained.',
      );
    } else {
      setStatus(failureMessage(response, 'Ignore failed.'));
    }
    setBusy(false);
  };

  const saveRecoveredProject = async (): Promise<void> => {
    const snapshot = editorProjectStore.getSnapshot();
    if (!snapshot?.dirty) return;
    setBusy(true);
    const response = await window.pandaStage.project.save({
      projectRoot: snapshot.projectRoot,
      project: snapshot.project,
    });
    if (response.ok) {
      editorProjectStore.markSaved(response.value.project);
      setStatus(
        'Recovered project saved explicitly; stale recovery was cleaned.',
      );
    } else {
      setStatus(response.error.message);
    }
    setBusy(false);
  };

  return (
    <section className="recovery-panel" aria-labelledby="recovery-heading">
      <div className="recovery-heading-row">
        <div>
          <p className="eyebrow">Day 13 safety</p>
          <h2 id="recovery-heading">Crash recovery</h2>
        </div>
        <span className={projectSnapshot?.dirty ? 'dirty-state' : 'clean-state'}>
          {projectSnapshot?.dirty ? 'Unsaved recovered changes' : 'Clean'}
        </span>
      </div>
      <div className="recovery-open-row">
        <label>
          Project directory
          <input
            onChange={(event) => setProjectRootInput(event.target.value)}
            placeholder="D:\Projects\story.pandastage"
            value={projectRootInput}
          />
        </label>
        <button
          disabled={busy || !projectRootInput.trim()}
          onClick={() => void openProject()}
          type="button"
        >
          Open and check recovery
        </button>
      </div>
      {candidate ? (
        <div className="recovery-prompt" role="alert">
          <strong>{candidate.project.name}</strong>
          <span>
            Recovery from {new Date(candidate.savedAtMs).toLocaleString()}
          </span>
          <span className="recovery-path">{candidate.recoveryFilePath}</span>
          <div>
            <button
              disabled={busy}
              onClick={() => void restoreRecovery()}
              type="button"
            >
              Restore in memory
            </button>
            <button
              disabled={busy}
              onClick={() => void ignoreRecovery()}
              type="button"
            >
              Ignore and retain file
            </button>
          </div>
        </div>
      ) : null}
      <div className="recovery-status-row">
        <output>{status}</output>
        <button
          disabled={busy || !projectSnapshot?.dirty}
          onClick={() => void saveRecoveredProject()}
          type="button"
        >
          Save recovered project
        </button>
      </div>
    </section>
  );
}
