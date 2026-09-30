import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shouldStartProductPreviewAutoplay } from '../../src/renderer/shell/productPreviewReveal';

const shell = readFileSync('src/renderer/shell/EditorShell.tsx', 'utf8');
const workspace = readFileSync('src/renderer/shell/RightWorkspace.tsx', 'utf8');
const preview = readFileSync('src/renderer/shell/ProductPreviewOverlay.tsx', 'utf8');
const styles = readFileSync('src/renderer/styles/shell/right-workspace/issue653-auto-camera-mode.css', 'utf8');

function functionBody(source: string, start: string, end: string): string {
  const beginning = source.indexOf(start);
  expect(beginning).toBeGreaterThanOrEqual(0);
  const ending = source.indexOf(end, beginning + start.length);
  expect(ending).toBeGreaterThan(beginning);
  return source.slice(beginning, ending);
}

describe('Issue #653 persistent automatic Camera mode', () => {
  it('keeps a separate one-click mode beside, not inside, right activity navigation', () => {
    expect(workspace).toContain("{ id: 'subtitles', label: '字幕', icon: MessageCircleMore }");
    expect(workspace).toContain("{ id: 'properties', label: '属性', icon: SlidersHorizontal }");
    expect(workspace).toContain("{ id: 'tools', label: '工具', icon: Wrench }");
    expect(workspace).not.toMatch(/id: 'auto-camera'/u);
    expect(workspace.indexOf('className="right-mode-group"')).toBeGreaterThan(
      workspace.indexOf('</nav>'),
    );
    const mode = functionBody(workspace, '<div aria-label="预览模式"', '</div>');
    expect(mode).toContain('aria-pressed={autoCameraEnabled}');
    expect(mode).toContain('onClick={() => onAutoCameraChange(!autoCameraEnabled)}');
    expect(mode).toContain('data-testid="right-mode-auto-camera"');
    expect(mode).toContain('<strong>自动运镜</strong>');
    expect(mode).not.toMatch(/aria-controls|aria-expanded|selectActivity/u);
    expect(styles).toContain('.right-mode-group');
    expect(styles).toContain('border-top: 1px solid var(--ui-color-border)');
    expect(styles).toContain("button[aria-pressed='true']");
  });

  it('shares one OFF-by-default session owner across the rail and Preview', () => {
    expect(shell).toContain('const [autoCameraEnabled, setAutoCameraEnabled] = useState(false)');
    expect(shell).toContain('autoCameraEnabled={autoCameraEnabled}');
    expect(shell.match(/onAutoCameraChange=\{setAutoCameraEnabled\}/gu)).toHaveLength(2);
    expect(preview).not.toMatch(/useState\([^)]*speakerFocus|setSpeakerFocus/u);
    expect(preview).toContain('aria-pressed={autoCameraEnabled}');
    expect(preview).toContain('onClick={() => onAutoCameraChange(!autoCameraEnabled)}');
    expect(preview).toContain('自动运镜');
    expect(preview).not.toContain('说话人聚焦');
    expect(workspace).not.toContain('说话人聚焦');
  });

  it('preserves the choice through Preview close, but resets after successful project switch or close', () => {
    expect(functionBody(shell, 'const closeProductPreview =', 'const requestCloseProject ='))
      .not.toContain('setAutoCameraEnabled');
    expect(functionBody(shell, 'const switchToProject =', 'const switchToRecentProject ='))
      .toContain('setAutoCameraEnabled(false)');
    expect(functionBody(shell, 'const switchToRecentProject =', 'const openProjectCenter ='))
      .toContain('setAutoCameraEnabled(false)');
    expect(functionBody(shell, 'const finishCloseProject =', 'const closeProject ='))
      .toContain('setAutoCameraEnabled(false)');
    expect(functionBody(shell, 'const openProjectCenter =', 'const returnToEditor ='))
      .not.toContain('setAutoCameraEnabled');
    expect(shell).not.toMatch(/updateProject\([^)]*autoCameraEnabled/u);
    expect(preview).not.toMatch(/updateProject|HistoryStore|setDirty|setRevision/u);
  });

  it('has Camera ready before auto-play can begin with the first active Dialogue', () => {
    expect(preview).toContain('autoCameraEnabled && shot ? prepareSpeakerFocusCamera(project, shot) : null');
    expect(preview).toContain('evaluateSpeakerFocusCamera(cameraPlan, activeShotTimeMs)');
    expect(preview).toContain('camera={camera}');
    expect(preview).toContain('shouldStartProductPreviewAutoplay({');
    expect(preview).toContain('setPlaying(true)');
    expect(shell).toMatch(/<ProductPreviewOverlay\s+autoPlay\s+autoCameraEnabled=\{autoCameraEnabled\}/u);
    expect(shouldStartProductPreviewAutoplay({
      autoPlay: true,
      dataReady: true,
      durationMs: 1_000,
      revealPhase: 'active',
    })).toBe(true);
  });
});
