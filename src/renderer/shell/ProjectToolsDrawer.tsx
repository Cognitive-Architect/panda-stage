import {
  ArrowLeft,
  Maximize2,
  MessageCircleMore,
  ScanLine,
  Sparkles,
  X,
} from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { DecorativeIcon } from '../ui';
import { canvasViewportStore } from '../stores/canvasViewportStore';
import type { CanvasViewportMode } from '../../domain';
import { DialogueBatchPaste } from '../features/dialogue/DialogueBatchPaste';
import type { DialogueAuthoringDraft } from '../features/dialogue/dialogueAuthoringDraft';
import { LegacyWorkspace } from './LegacyWorkspace';

export interface ProjectToolsDrawerProps {
  autoSubtitleDraft: DialogueAuthoringDraft;
  autoSubtitleDraftResetNotice: string | null;
  onDismissAutoSubtitleDraftResetNotice(): void;
  onClose(): void;
}

type ProjectToolsView = 'home' | 'action-presets' | 'auto-subtitles';

interface ViewModeOption {
  mode: CanvasViewportMode;
  label: string;
  testId: string;
  icon: typeof Maximize2;
}

const VIEW_MODE_OPTIONS: readonly ViewModeOption[] = [
  { mode: 'fit', label: '适应窗口', testId: 'canvas-mode-fit', icon: Maximize2 },
  { mode: 'actual', label: '实际尺寸', testId: 'canvas-mode-actual', icon: ScanLine },
] as const;

/**
 * Project Tools is a presentation-level launcher. The ActionPreset business
 * owner remains unchanged; this component only composes its focused
 * presentation and local navigation state.
 */
export function ProjectToolsDrawer({
  autoSubtitleDraft,
  autoSubtitleDraftResetNotice,
  onDismissAutoSubtitleDraftResetNotice,
  onClose,
}: ProjectToolsDrawerProps): React.JSX.Element {
  const [view, setView] = useState<ProjectToolsView>('home');
  const viewportMode = useSyncExternalStore(
    canvasViewportStore.subscribe,
    canvasViewportStore.getSnapshot,
  ).mode;

  return (
    <section
      aria-labelledby={view === 'auto-subtitles' ? undefined : 'project-tools-heading'}
      className="project-tools-drawer"
      data-project-tools-view={view}
      data-testid="project-tools-drawer"
    >
      {view === 'auto-subtitles' ? (
        <header className="project-tools-drawer-header project-tools-auto-subtitles-header">
          <button
            aria-label="返回工具"
            className="project-tools-auto-subtitles-back"
            data-testid="project-tools-auto-subtitles-back"
            onClick={() => setView('home')}
            type="button"
          >
            <DecorativeIcon icon={ArrowLeft} size={18} />
            <span>返回</span>
          </button>
          <h2 id="project-tools-heading">自动字幕</h2>
          <button
            aria-label="关闭工具"
            className="project-tools-close"
            data-testid="project-tools-close"
            onClick={onClose}
            type="button"
          >
            <DecorativeIcon icon={X} size={20} />
          </button>
        </header>
      ) : (
        <header className="project-tools-drawer-header">
          <div className="project-tools-drawer-heading">
            {view === 'action-presets' ? (
              <button
                aria-label="返回工具"
                className="project-tools-back"
                data-testid="project-tools-back"
                onClick={() => setView('home')}
                type="button"
              >
                <DecorativeIcon icon={ArrowLeft} size={18} />
                <span>工具</span>
              </button>
            ) : null}
            <h2 id="project-tools-heading">
              {view === 'action-presets' ? '动作预设' : '工具'}
            </h2>
          </div>
          <button
            aria-label="关闭工具"
            className="project-tools-close"
            data-testid="project-tools-close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>
      )}

      {view === 'home' ? (
        <div className="project-tools-home" data-testid="project-tools-home">
          <section
            aria-labelledby="project-tools-view-mode-heading"
            className="project-tools-view-mode-card"
            data-testid="project-tools-view-mode-card"
          >
            <div className="project-tools-view-mode-heading">
              <h3 id="project-tools-view-mode-heading">画布</h3>
            </div>
            <div
              className="project-tools-view-mode-segmented"
              data-testid="project-tools-view-mode-segmented"
              role="group"
              aria-label="画布视口模式"
            >
              {VIEW_MODE_OPTIONS.map((option) => {
                const active = option.mode === viewportMode;
                return (
                  <button
                    aria-pressed={active}
                    className="ui-icon-label"
                    data-testid={option.testId}
                    key={option.mode}
                    onClick={() => canvasViewportStore.setMode(option.mode)}
                    type="button"
                  >
                    {option.icon === Maximize2 ? (
                      <Maximize2
                        aria-hidden="true"
                        className="ui-icon"
                        focusable="false"
                        size={16}
                      />
                    ) : null}
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
          </section>
          <button
            className="project-tools-auto-subtitle-launcher"
            data-testid="project-tools-auto-subtitles"
            onClick={() => setView('auto-subtitles')}
            type="button"
          >
            <DecorativeIcon icon={MessageCircleMore} size={18} />
            <span>自动字幕</span>
          </button>
          <section
            aria-labelledby="project-tools-action-preset-heading"
            className="project-tools-action-preset-card"
            data-testid="project-tools-action-preset-card"
          >
            <div className="project-tools-action-preset-heading">
              <h3 id="project-tools-action-preset-heading">动作预设</h3>
            </div>
            <button
              className="project-tools-action-preset-launcher"
              data-project-tools-action="action-presets"
              data-testid="project-tools-action-presets"
              onClick={() => setView('action-presets')}
              type="button"
            >
              <DecorativeIcon icon={Sparkles} size={18} />
              <span>打开动作预设</span>
            </button>
          </section>
        </div>
      ) : view === 'action-presets' ? (
        <section
          aria-label="动作预设"
          className="project-tools-action-presets-view"
          data-testid="project-tools-action-presets-view"
        >
          <LegacyWorkspace />
        </section>
      ) : (
        <section
          className="project-tools-auto-subtitles-view"
          data-testid="project-tools-auto-subtitles-view"
        >
          {autoSubtitleDraftResetNotice ? (
            <div
              aria-live="polite"
              className="auto-subtitle-draft-reset-notice"
              data-testid="auto-subtitle-draft-reset-notice"
              role="status"
            >
              <span>{autoSubtitleDraftResetNotice}</span>
              <button
                aria-label="关闭提示"
                data-testid="auto-subtitle-draft-reset-notice-dismiss"
                onClick={onDismissAutoSubtitleDraftResetNotice}
                type="button"
              >
                <DecorativeIcon icon={X} size={16} />
              </button>
            </div>
          ) : null}
          <DialogueBatchPaste
            draft={autoSubtitleDraft}
            presentation="auto-subtitle"
          />
        </section>
      )}
    </section>
  );
}
