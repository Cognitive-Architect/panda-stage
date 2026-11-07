import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  belongsToSceneToolSession,
  shouldHandleSceneToolMessage,
} from '../../src/renderer/shell/sceneToolHandoff';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

const PROJECT_A = 'D:\\panda-a.pandastage\u0000project-a\u0000instance-1';
const PROJECT_B = 'D:\\panda-b.pandastage\u0000project-b\u0000instance-2';

describe('Issue #1000 cross-project Auto Scene hand-off guard', () => {
  it('only accepts messages issued by the current project session', () => {
    const issuedByA = { sessionIdentity: PROJECT_A, token: 4 };

    expect(belongsToSceneToolSession(issuedByA, PROJECT_A)).toBe(true);
    expect(belongsToSceneToolSession(issuedByA, PROJECT_B)).toBe(false);
    expect(belongsToSceneToolSession(null, PROJECT_A)).toBe(false);
    expect(belongsToSceneToolSession(undefined, PROJECT_A)).toBe(false);
    expect(shouldHandleSceneToolMessage(issuedByA, PROJECT_B, 0)).toBe(false);
  });

  it('handles a current request once and ignores the replay', () => {
    const request = { sessionIdentity: PROJECT_B, token: 5 };

    expect(shouldHandleSceneToolMessage(request, PROJECT_B, 0)).toBe(true);
    expect(shouldHandleSceneToolMessage(request, PROJECT_B, 5)).toBe(false);
    expect(shouldHandleSceneToolMessage(null, PROJECT_B, 5)).toBe(false);
  });

  it('stamps requests and receipts with the project session', () => {
    const shell = source('src/renderer/shell/EditorShell.tsx');
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');
    const right = source('src/renderer/shell/RightWorkspace.tsx');

    // Shell: requests carry the issuing session; a session change drops them.
    expect(shell).toContain('useState<SceneToolRequest | null>(null)');
    expect(shell).toContain('useState<SceneToolImportResult | null>(null)');
    expect(shell).toContain('sessionIdentity: sceneToolSessionIdentityRef.current');
    expect(shell).toContain('setSceneBackgroundImportResult(null);');
    expect(shell).toContain(
      '}, [sceneCreationProjectSessionIdentity]);',
    );
    expect(shell).toContain(
      'projectSessionIdentity={sceneCreationProjectSessionIdentity}',
    );

    // Left dock: only a request from the owning session opens the surface, and
    // the receipt is reported with the session that asked for it.
    expect(dock).toContain('shouldHandleSceneToolMessage(');
    expect(dock).toContain('projectSessionIdentity,');
    expect(dock).toContain('const sceneImportPending = useRef<string | null>(null);');
    expect(dock).toContain('if (pendingSessionIdentity !== projectSessionIdentity) return;');
    expect(dock).toContain(
      'onSceneBackgroundImported?.(pendingSessionIdentity, importedAssetIds);',
    );
    expect(dock).not.toContain(
      'sceneBackgroundImportRequest === handledSceneImportRequestRef.current',
    );

    // Right drawer: a receipt from another session never reopens the tool.
    expect(right).toContain('belongsToSceneToolSession(result, projectSessionIdentity)');
    expect(right).toContain('handledSceneImportTokenRef.current = result.token;');
  });
});

describe('Issue #1000 Auto Scene preview follows the selected shot', () => {
  it('invalidates the plan and canvas preview when the selection changes', () => {
    const panel = source('src/renderer/features/shots/SceneCreationPanel.tsx');

    expect(panel).toContain('useSyncExternalStore(');
    expect(panel).toContain('activeShotStore.getCurrentShotId');
    expect(panel).toContain('previewPlanShotId !== (currentShotId ?? null)');
    expect(panel).toContain(
      'const stale = inspectionStale || previewStale || previewShotStale;',
    );
    expect(panel).toContain('setPreviewPlanShotId(currentShotId ?? null);');
    expect(panel).toContain('setPreviewPlanShotId(null);');
    // The clearing path retires the plan and the central preview together.
    expect(panel).toContain(
      'if (previous === next || previewPlan === null) return;',
    );
    expect(panel).toContain('已切换镜头，正在刷新预览');
    // Confirm keeps the same single gate; no second commit path was added.
    expect(panel).toContain('canvasPreviewStatus !== \'ready\'');
    expect(panel).toContain('      stale ||');
  });
});
