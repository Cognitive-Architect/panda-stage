import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { ProjectRecoveryPanel } from '../features/recovery/ProjectRecoveryPanel';
import { ResourceActivityDock } from './ResourceActivityDock';
import type { ResourceActivity } from './ResourceActivityDock';
import type {
  CreateFlaCharacter,
  QueryFlaCharacterCreateStatus,
} from '../features/fla-import/FlaCharacterImportFlow';
import type { AdaptivePartsAssemblyActionsRef } from '../features/characters/CharacterManager';
import { LegacyCompatibilityActivity } from './LegacyCompatibilityActivity';
import type { EditorShellLayoutMode } from './adaptiveEditorShell';

export interface LeftWorkspaceProps {
  projectSnapshot: EditorProjectSnapshot;
  recentRefreshToken: number;
  shellMode?: EditorShellLayoutMode;
  drawerOpen?: boolean;
  onDrawerOpenChange?(open: boolean): void;
  activeActivity?: ResourceActivity;
  onActiveActivityChange?(activity: ResourceActivity): void;
  adaptivePartsActionsRef?: AdaptivePartsAssemblyActionsRef;
  onCreateFlaCharacter?: CreateFlaCharacter;
  onQueryFlaCharacterCreateStatus: QueryFlaCharacterCreateStatus;
  flaCharacterRecoveryAction?: React.JSX.Element | null;
  flaCharacterRecoveryBusy?: boolean;
  onFlaCharacterImportStart?(): void;
  onFlaCharacterCommitStateChange?(committing: boolean): void;
  onOpenRecentProject(
    projectRoot: string,
    expectedProjectId: string,
  ): Promise<void>;
}

export function LeftWorkspace({
  projectSnapshot,
  recentRefreshToken,
  shellMode,
  drawerOpen,
  onDrawerOpenChange,
  activeActivity,
  onActiveActivityChange,
  adaptivePartsActionsRef,
  onCreateFlaCharacter,
  onQueryFlaCharacterCreateStatus,
  flaCharacterRecoveryAction,
  flaCharacterRecoveryBusy,
  onFlaCharacterImportStart,
  onFlaCharacterCommitStateChange,
  onOpenRecentProject,
}: LeftWorkspaceProps): React.JSX.Element {
  const projectUtilities = (
    <>
      <ProjectRecoveryPanel
        onOpenRecentProject={onOpenRecentProject}
        projectSnapshot={projectSnapshot}
        recentRefreshToken={recentRefreshToken}
      />
      <LegacyCompatibilityActivity
        key={`compatibility:${projectSnapshot.projectRoot}`}
        projectRoot={projectSnapshot.projectRoot}
      />
    </>
  );

  return (
    <aside
      aria-label="左侧工作区"
      className="left-workspace"
      data-testid="left-workspace-scroll"
    >
      <ResourceActivityDock
        activeActivity={activeActivity}
        adaptivePartsActionsRef={adaptivePartsActionsRef}
        auxiliaryContent={shellMode === 'landscape' ? undefined : projectUtilities}
        compact={
          shellMode === undefined ? undefined : shellMode === 'landscape'
        }
        drawerOpen={drawerOpen}
        hideSectionLabels={shellMode === 'portrait'}
        key={`resource:${projectSnapshot.projectRoot}`}
        onActiveActivityChange={onActiveActivityChange}
        onDrawerOpenChange={onDrawerOpenChange}
        onCreateFlaCharacter={onCreateFlaCharacter}
        onQueryFlaCharacterCreateStatus={onQueryFlaCharacterCreateStatus}
        flaCharacterRecoveryAction={flaCharacterRecoveryAction}
        flaCharacterRecoveryBusy={flaCharacterRecoveryBusy}
        onFlaCharacterImportStart={onFlaCharacterImportStart}
        onFlaCharacterCommitStateChange={onFlaCharacterCommitStateChange}
        presentation={shellMode === 'landscape' ? 'landscape' : 'default'}
        snapshot={projectSnapshot}
      />
    </aside>
  );
}
