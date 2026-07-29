import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import type { RecoveryCandidate } from '../../../shared/recovery-api';
import { RecentProjectsPanel } from '../welcome/RecentProjectsPanel';
import { AssetLibrary } from '../assets/AssetLibrary';
import { CharacterManager } from '../characters/CharacterManager';
import { ShotManager } from '../shots/ShotManager';
import { CanvasStage } from '../canvas/CanvasStage';
import { RecoveryCandidateBanner } from '../../shell/RecoveryCandidateBanner';

export interface ProjectRecoveryPanelProps {
  projectSnapshot: EditorProjectSnapshot | null;
  recoveryCandidate: RecoveryCandidate | null;
  projectRootInput: string;
  status: string;
  busy: boolean;
  recentRefreshToken: number;
  onProjectRootInputChange(value: string): void;
  onOpenProject(): Promise<void>;
  onOpenRecentProject(
    projectRoot: string,
    expectedProjectId: string,
  ): Promise<void>;
  onRestoreRecovery(): Promise<void>;
  onIgnoreRecovery(): Promise<void>;
  onSaveRecoveredProject(): Promise<void>;
}

export type RecoveryPanelControlsProps = Omit<
  ProjectRecoveryPanelProps,
  'recentRefreshToken' | 'onOpenRecentProject'
>;

export function RecoveryPanelControls({
  projectSnapshot,
  recoveryCandidate,
  projectRootInput,
  status,
  busy,
  onProjectRootInputChange,
  onOpenProject,
  onRestoreRecovery,
  onIgnoreRecovery,
  onSaveRecoveredProject,
}: RecoveryPanelControlsProps): React.JSX.Element {
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
            onChange={(event) =>
              onProjectRootInputChange(event.target.value)
            }
            placeholder="D:\Projects\story.pandastage"
            value={projectRootInput}
          />
        </label>
        <button
          disabled={busy || !projectRootInput.trim()}
          onClick={() => void onOpenProject()}
          type="button"
        >
          Open and check recovery
        </button>
      </div>
      {recoveryCandidate ? (
        <RecoveryCandidateBanner
          busy={busy}
          candidate={recoveryCandidate}
          onIgnore={onIgnoreRecovery}
          onRestore={onRestoreRecovery}
        />
      ) : null}
      <div className="recovery-status-row">
        <output>{status}</output>
        <button
          className="editor-save-button"
          disabled={busy || !projectSnapshot?.dirty}
          onClick={() => void onSaveRecoveredProject()}
          type="button"
        >
          Save recovered project
        </button>
      </div>
    </section>
  );
}

export function ProjectRecoveryPanel(
  props: ProjectRecoveryPanelProps,
): React.JSX.Element | null {
  if (new URLSearchParams(window.location.search).get('gateA') === '1') {
    return null;
  }

  return (
    <>
      <RecentProjectsPanel
        onOpenProject={props.onOpenRecentProject}
        refreshToken={props.recentRefreshToken}
      />
      <AssetLibrary snapshot={props.projectSnapshot} />
      <CharacterManager snapshot={props.projectSnapshot} />
      <ShotManager snapshot={props.projectSnapshot} />
      <CanvasStage />
      <RecoveryPanelControls {...props} />
    </>
  );
}
