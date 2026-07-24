import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { ProjectSessionController } from './ProjectSessionController';
import { saveCurrentProject } from './saveCurrentProject';

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
  const sessionController = useMemo(
    () =>
      new ProjectSessionController(
        {
          open: (projectRoot) =>
            window.pandaStage.project.open({ projectRoot }),
          track: (request) => window.pandaStage.autosave.track(request),
          stop: (projectRoot) =>
            window.pandaStage.autosave.stop(projectRoot),
          detect: (projectRoot) =>
            window.pandaStage.recovery.detect(projectRoot),
        },
        editorProjectStore,
      ),
    [],
  );
  const [sessionSnapshot, setSessionSnapshot] = useState(() =>
    sessionController.getSnapshot(),
  );
  const [projectRootInput, setProjectRootInput] = useState('');
  const [status, setStatus] = useState(
    'Open a .pandastage project to check crash recovery.',
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => window.pandaStage.autosave.onError((error) => {
    setStatus(error.message);
  }), []);

  useEffect(
    () => () => {
      void sessionController.dispose();
    },
    [sessionController],
  );

  useEffect(() => {
    if (
      !projectSnapshot ||
      projectSnapshot.projectRoot !== sessionSnapshot.trackedProjectRoot
    ) {
      return;
    }
    void window.pandaStage.autosave
      .update(projectSnapshot)
      .then((response) => {
        if (!response.ok) setStatus(response.error.message);
      });
  }, [projectSnapshot, sessionSnapshot.trackedProjectRoot]);

  if (new URLSearchParams(window.location.search).get('gateA') === '1') {
    return null;
  }

  const openProject = async (): Promise<void> => {
    const projectRoot = projectRootInput.trim();
    if (!projectRoot) return;
    setBusy(true);
    try {
      const nextSession = await sessionController.switchProject(projectRoot);
      setSessionSnapshot(nextSession);
      setStatus(
        nextSession.recoveryCandidate
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
    const candidate = sessionSnapshot.recoveryCandidate;
    if (!candidate) return;
    setBusy(true);
    try {
      const response = await window.pandaStage.recovery.restore({
        projectRoot: candidate.projectRoot,
        recoveryFilePath: candidate.recoveryFilePath,
      });
      if (!response.ok) throw new Error(response.error.message);
      editorProjectStore.restore(response.candidate.project);
      setSessionSnapshot(sessionController.clearRecoveryCandidate());
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
    const candidate = sessionSnapshot.recoveryCandidate;
    if (!candidate) return;
    setBusy(true);
    const response = await window.pandaStage.recovery.ignore({
      projectRoot: candidate.projectRoot,
      recoveryFilePath: candidate.recoveryFilePath,
    });
    if (response.ok) {
      setSessionSnapshot(sessionController.clearRecoveryCandidate());
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
    try {
      const result = await saveCurrentProject(
        window.pandaStage.project,
        editorProjectStore,
      );
      if (!result.ok) {
        setStatus(result.error.message);
      } else if (result.acknowledgement === 'stale') {
        setStatus(
          `Revision ${result.savedRevision} was saved, but newer unsaved changes remain.`,
        );
      } else {
        setStatus(
          'Recovered project saved explicitly; stale recovery was cleaned.',
        );
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
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
      {sessionSnapshot.recoveryCandidate ? (
        <div className="recovery-prompt" role="alert">
          <strong>{sessionSnapshot.recoveryCandidate.project.name}</strong>
          <span>
            Recovery from{' '}
            {new Date(
              sessionSnapshot.recoveryCandidate.savedAtMs,
            ).toLocaleString()}
          </span>
          <span className="recovery-path">
            {sessionSnapshot.recoveryCandidate.recoveryFilePath}
          </span>
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
