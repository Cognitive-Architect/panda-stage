import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Clock3, MessageSquareText, Trash2, UserRound, Volume2 } from 'lucide-react';
import type { Character } from '../../../domain';
import { layoutSubtitleText } from '../../../shared/preview/subtitle-layout';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { dialogueStore } from '../../stores/dialogueStore';
import { shotStore } from '../../stores/shotStore';
import { DecorativeIcon } from '../../ui';
import {
  clampTime,
  formatTimecode,
  integerFrameSpanMs,
} from '../timeline/timeGeometry';

export function normalizeManualDialogueTiming(
  startValue: string,
  endValue: string,
  durationMs: number,
): { startMs: number; endMs: number } {
  const rawStart = Number(startValue);
  const rawEnd = Number(endValue);
  if (
    startValue.trim() === '' ||
    endValue.trim() === '' ||
    !Number.isFinite(rawStart) ||
    !Number.isFinite(rawEnd) ||
    !Number.isInteger(rawStart) ||
    !Number.isInteger(rawEnd)
  ) {
    throw new Error('开始和结束时间必须是整数毫秒。');
  }
  return {
    startMs: clampTime(rawStart, durationMs),
    endMs: clampTime(rawEnd, durationMs),
  };
}

export type DialogueInspectorPresentation =
  | 'inspector'
  | 'properties'
  | 'timeline';
export type DialogueInspectorLandscapePresentation = 'landscape';

type DialogueInspectorErrorScope = 'text' | 'timing' | 'speaker';

interface DialogueInspectorError {
  scope: DialogueInspectorErrorScope;
  message: string;
}

/**
 * The existing dialogue editor owner, extended only with a presentation seam
 * for the portrait Timeline. Text still commits on blur; timing and Untimed
 * arrangement remain explicit, one-command actions.
 */
export function DialogueInspector({
  dialogueId,
  presentation = 'inspector',
}: {
  dialogueId: string;
  presentation?:
    | DialogueInspectorPresentation
    | DialogueInspectorLandscapePresentation;
}): React.JSX.Element {
  const timelinePresentation = presentation === 'timeline';
  const propertiesPresentation = presentation === 'properties';
  const landscapePresentation = presentation === 'landscape';
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const currentShotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
  );
  const shot = snapshot?.project.shots.find(
    (candidate) => candidate.id === currentShotId,
  );
  const dialogue = shot?.dialogues.find(
    (candidate) => candidate.id === dialogueId,
  );
  const characters: readonly Character[] = snapshot?.project.characters ?? [];
  const character = characters.find(
    (candidate) => candidate.id === dialogue?.characterId,
  );
  const subtitleStyle = snapshot?.project.subtitleStyles.find(
    (style) => style.id === dialogue?.subtitleStyleId,
  );
  const audioClip = dialogue?.audioClipId
    ? shot?.audioClips.find(
        (candidate) => candidate.id === dialogue.audioClipId,
      )
    : undefined;
  const audioAsset = audioClip
    ? snapshot?.project.assets.find(
        (candidate) => candidate.id === audioClip.assetId,
      )
    : undefined;
  const audioSummary = audioClip
    ? (audioAsset?.name ?? audioClip.name) +
      ' · ' +
      formatTimecode(Math.max(0, audioClip.endMs - audioClip.startMs)) +
      ' · 已绑定'
    : dialogue?.audioClipId
      ? '绑定音频不可用'
      : '未绑定音频';

  const [text, setText] = useState(dialogue?.text ?? '');
  const [startMs, setStartMs] = useState(String(dialogue?.startMs ?? 0));
  const [endMs, setEndMs] = useState(String(dialogue?.endMs ?? 0));
  const [error, setError] = useState<DialogueInspectorError | null>(null);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setText(dialogue?.text ?? '');
    setStartMs(String(dialogue?.startMs ?? 0));
    setEndMs(String(dialogue?.endMs ?? 0));
    setError(null);
  }, [dialogue?.id, dialogue?.text, dialogue?.startMs, dialogue?.endMs]);

  if (!shot || !dialogue) {
    return timelinePresentation ? (
      <div
        className="timeline-subtitle-editor-empty"
        data-testid="timeline-subtitle-editor-empty"
      >
        请选择时间轴中的字幕片段。
      </div>
    ) : landscapePresentation ? (
      <div
        className="dialogue-inspector-empty"
        data-testid="dialogue-inspector-empty"
      >
        当前镜头没有可编辑字幕。
      </div>
    ) : propertiesPresentation ? (
      <div
        className="dialogue-inspector-properties-empty"
        data-testid="dialogue-inspector-empty"
      >
        当前没有可编辑字幕。
      </div>
    ) : (
      <div className="right-inspector-heading">
        <div>
          <p className="eyebrow">右侧检查器</p>
          <h2 id="right-inspector-heading">对白检查器</h2>
        </div>
        <span>当前镜头</span>
      </div>
    );
  }

  const timed = dialogue.endMs > dialogue.startMs;
  const subtitleWarning = layoutSubtitleText(
    dialogue.text,
    subtitleStyle ?? { fontSize: 44, maxWidth: 1_420 },
  ).warning;

  const report = (
    scope: DialogueInspectorErrorScope,
    action: () => void,
    fallback: string,
  ): void => {
    try {
      action();
      setError(null);
    } catch (nextError) {
      setError({
        scope,
        message: nextError instanceof Error ? nextError.message : fallback,
      });
    }
  };

  const commitText = (): void => {
    focusedRef.current = false;
    const trimmed = text.trim();
    if (!trimmed) {
      setText(dialogue.text);
      setError({ scope: 'text', message: '对白文本不能为空。' });
      return;
    }
    if (trimmed !== dialogue.text) {
      report(
        'text',
        () => dialogueStore.update(dialogue.id, { text: trimmed }),
        '对白文本无效。',
      );
    } else {
      setText(dialogue.text);
    }
  };

  const commitTiming = (): void => {
    let timing: { startMs: number; endMs: number };
    try {
      timing = normalizeManualDialogueTiming(
        startMs,
        endMs,
        shot.durationMs,
      );
    } catch (nextError) {
      setError(
        {
          scope: 'timing',
          message:
            nextError instanceof Error
              ? nextError.message
              : '开始和结束时间必须是整数毫秒。',
        },
      );
      return;
    }
    report(
      'timing',
      () => {
        dialogueStore.setTiming(
          dialogue.id,
          timing.startMs,
          timing.endMs,
        );
        setStartMs(String(timing.startMs));
        setEndMs(String(timing.endMs));
      },
      '对白时间段无效。',
    );
  };

  const timingInputValid = [startMs, endMs].every((value) => {
    if (value.trim() === '') return false;
    const raw = Number(value);
    return Number.isFinite(raw) && Number.isInteger(raw);
  });

  if (timelinePresentation) {
    return (
      <div
        className="dialogue-inspector dialogue-inspector-timeline dialogue-timed-editor"
        data-dialogue-id={dialogue.id}
        data-timed-editor-layout="two-column"
        data-testid="dialogue-inspector"
      >
        <header
          aria-live="polite"
          className="timeline-subtitle-selection"
          data-selection-state="dialogue"
          data-testid="right-inspector-selection"
        >
          <div className="timeline-subtitle-selection-identity">
            <p className="eyebrow">当前字幕</p>
            <strong data-testid="dialogue-inspector-speaker-name">
              {character?.name ?? '未知角色'}
            </strong>
          </div>
          <span
            className="timeline-subtitle-selection-status"
            data-testid="right-inspector-selection-message"
            data-timed={String(timed)}
          >
            <span aria-hidden="true">✓</span> {timed ? '已定时' : '未定时'}
          </span>
        </header>

        <section
          className="dialogue-inspector-section dialogue-timed-copy-section"
          data-testid="dialogue-inspector-copy-section"
        >
          <h3>台词</h3>
          <label className="dialogue-field">
            <span>内容</span>
            <textarea
              aria-label="台词内容"
              className="dialogue-timed-textarea"
              data-testid="dialogue-inspector-text"
              value={text}
              rows={3}
              onChange={(event) => setText(event.target.value)}
              onFocus={() => {
                focusedRef.current = true;
              }}
              onBlur={commitText}
            />
          </label>
          {subtitleWarning ? (
            <p
              className="dialogue-editor-error"
              data-testid="dialogue-subtitle-warning"
              role="status"
            >
              {subtitleWarning}
            </p>
          ) : null}
          {error?.scope === 'text' ? (
            <p
              className="dialogue-editor-error"
              data-error-scope="text"
              data-testid="dialogue-editor-error"
              role="alert"
            >
              {error.message}
            </p>
          ) : null}
        </section>

        <section
          className="dialogue-inspector-section dialogue-timed-timing-section"
          data-testid="dialogue-inspector-time-section"
        >
          <h3>时间</h3>
          {timed ? (
            <>
              <div className="dialogue-timing-fields">
                <label className="dialogue-field">
                  <span className="dialogue-timing-label">
                    开始{' '}
                    <time
                      data-testid="dialogue-inspector-start-readable"
                      dateTime={
                        'PT' + Math.max(0, dialogue.startMs) / 1000 + 'S'
                      }
                    >
                      {formatTimecode(dialogue.startMs)}
                    </time>
                  </span>
                  <span className="dialogue-timing-input">
                    <input
                      aria-label="开始时间（毫秒）"
                      className="dialogue-timed-time-input"
                      data-display-time={formatTimecode(dialogue.startMs)}
                      data-testid="dialogue-inspector-start"
                      inputMode="numeric"
                      min={0}
                      onChange={(event) => setStartMs(event.target.value)}
                      type="number"
                      value={startMs}
                    />
                    <span aria-hidden="true">ms</span>
                  </span>
                </label>
                <label className="dialogue-field">
                  <span className="dialogue-timing-label">
                    结束{' '}
                    <time
                      data-testid="dialogue-inspector-end-readable"
                      dateTime={'PT' + Math.max(0, dialogue.endMs) / 1000 + 'S'}
                    >
                      {formatTimecode(dialogue.endMs)}
                    </time>
                  </span>
                  <span className="dialogue-timing-input">
                    <input
                      aria-label="结束时间（毫秒）"
                      className="dialogue-timed-time-input"
                      data-display-time={formatTimecode(dialogue.endMs)}
                      data-testid="dialogue-inspector-end"
                      inputMode="numeric"
                      min={0}
                      onChange={(event) => setEndMs(event.target.value)}
                      type="number"
                      value={endMs}
                    />
                    <span aria-hidden="true">ms</span>
                  </span>
                </label>
              </div>
              <div className="dialogue-timing-footer">
                <p
                  className="dialogue-point-time"
                  data-duration-ms={Math.max(
                    0,
                    dialogue.endMs - dialogue.startMs,
                  )}
                  data-testid="dialogue-inspector-timing-summary"
                >
                  <span>持续</span>{' '}
                  <time
                    dateTime={
                      'PT' +
                      Math.max(0, dialogue.endMs - dialogue.startMs) / 1000 +
                      'S'
                    }
                  >
                    {formatTimecode(dialogue.endMs - dialogue.startMs)}
                  </time>
                </p>
                <button
                  className="dialogue-timeline-apply-timing dialogue-timed-apply-timing"
                  data-testid="dialogue-inspector-apply-timing"
                  disabled={!timingInputValid}
                  onClick={commitTiming}
                  type="button"
                >
                  应用时间
                </button>
              </div>
              {error?.scope === 'timing' ? (
                <p
                  className="dialogue-editor-error"
                  data-error-scope="timing"
                  data-testid="dialogue-editor-error"
                  role="alert"
                >
                  {error.message}
                </p>
              ) : null}
            </>
          ) : (
            <button
              className="dialogue-arrange"
              data-testid="dialogue-inspector-arrange"
              onClick={() =>
                report(
                  'timing',
                  () =>
                    dialogueStore.arrange(
                      dialogue.id,
                      integerFrameSpanMs(),
                    ),
                  '未定时对白安排失败。',
                )
              }
              type="button"
            >
              安排一帧
            </button>
          )}
          {!timed ? (
            <p className="dialogue-point-time">
              待安排字幕尚未产生显示时间窗。
            </p>
          ) : null}
        </section>

        <section
          className="dialogue-inspector-section dialogue-inspector-speaker-section dialogue-timed-speaker-section"
          data-testid="dialogue-inspector-speaker-section"
        >
          <h3>角色</h3>
          <label className="dialogue-field">
            <span>说话人</span>
            <select
              aria-label="字幕角色"
              className="dialogue-timed-speaker-select"
              data-testid="dialogue-inspector-speaker"
              value={dialogue.characterId}
              onChange={(event) =>
                report(
                  'speaker',
                  () =>
                    dialogueStore.update(dialogue.id, {
                      characterId: event.target.value,
                    }),
                  '角色无效。',
                )
              }
            >
              {characters.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
          {error?.scope === 'speaker' ? (
            <p
              className="dialogue-editor-error"
              data-error-scope="speaker"
              data-testid="dialogue-editor-error"
              role="alert"
            >
              {error.message}
            </p>
          ) : null}
        </section>

        <section
          className="dialogue-inspector-section dialogue-inspector-audio-section dialogue-timed-audio-section"
          data-testid="dialogue-inspector-audio-section"
        >
          <h3>音频</h3>
          <p data-testid="dialogue-inspector-audio-summary">{audioSummary}</p>
          <span className="dialogue-inspector-audio-note">
            当前仅展示已有绑定状态。
          </span>
        </section>

        <div className="dialogue-inspector-actions dialogue-timed-actions">
          <button
            aria-label={`删除字幕：${character?.name ?? '未知角色'}：${dialogue.text}`}
            type="button"
            className="dialogue-delete dialogue-timed-delete"
            data-testid="dialogue-inspector-delete"
            onClick={() => dialogueStore.remove(dialogue.id)}
          >
            删除字幕
          </button>
        </div>
      </div>
    );
  }

  if (propertiesPresentation) {
    return (
      <div
        className="dialogue-inspector dialogue-inspector-properties"
        data-dialogue-id={dialogue.id}
        data-testid="dialogue-inspector"
      >
        <header
          aria-live="polite"
          className="dialogue-properties-header"
          data-testid="dialogue-properties-header"
        >
          <div className="dialogue-properties-heading-copy">
            <p className="eyebrow">当前选择</p>
            <h2>字幕属性</h2>
            <p
              className="dialogue-properties-identity"
              data-testid="dialogue-properties-identity"
            >
              {character?.name ?? '未知角色'} · {timed ? '已定时字幕' : '待安排字幕'}
            </p>
          </div>
          <span
            className="dialogue-properties-status"
            data-testid="dialogue-properties-status"
            data-timed={String(timed)}
          >
            {timed ? '已定时' : '待安排'}
          </span>
        </header>

        <section
          className="dialogue-properties-section"
          data-testid="dialogue-inspector-copy-section"
        >
          <div className="dialogue-properties-section-heading">
            <DecorativeIcon icon={MessageSquareText} size={18} />
            <h3>台词</h3>
          </div>
          <label className="dialogue-field">
            <span>内容</span>
            <textarea
              aria-label="台词内容"
              data-testid="dialogue-inspector-text"
              value={text}
              rows={4}
              onChange={(event) => setText(event.target.value)}
              onFocus={() => {
                focusedRef.current = true;
              }}
              onBlur={commitText}
            />
          </label>
          {subtitleWarning ? (
            <p
              className="dialogue-editor-error"
              data-testid="dialogue-subtitle-warning"
              role="status"
            >
              {subtitleWarning}
            </p>
          ) : null}
          {error?.scope === 'text' ? (
            <p
              className="dialogue-editor-error"
              data-error-scope="text"
              data-testid="dialogue-editor-error"
              role="alert"
            >
              {error.message}
            </p>
          ) : null}
        </section>

        <section
          className="dialogue-properties-section"
          data-testid="dialogue-inspector-speaker-section"
        >
          <div className="dialogue-properties-section-heading">
            <DecorativeIcon icon={UserRound} size={18} />
            <h3>角色</h3>
          </div>
          <label className="dialogue-field">
            <span>角色（说话人）</span>
            <select
              aria-label="字幕角色"
              data-testid="dialogue-inspector-speaker"
              value={dialogue.characterId}
              onChange={(event) =>
                report(
                  'speaker',
                  () =>
                    dialogueStore.update(dialogue.id, {
                      characterId: event.target.value,
                    }),
                  '角色无效。',
                )
              }
            >
              {characters.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
          {error?.scope === 'speaker' ? (
            <p
              className="dialogue-editor-error"
              data-error-scope="speaker"
              data-testid="dialogue-editor-error"
              role="alert"
            >
              {error.message}
            </p>
          ) : null}
        </section>

        <section
          className="dialogue-properties-section"
          data-testid="dialogue-inspector-time-section"
        >
          <div className="dialogue-properties-section-heading">
            <DecorativeIcon icon={Clock3} size={18} />
            <h3>时间</h3>
          </div>
          {timed ? (
            <>
              <div className="dialogue-timing-fields">
                <label className="dialogue-field">
                  <span className="dialogue-timing-label">
                    开始
                    <time
                      data-testid="dialogue-inspector-start-readable"
                      dateTime={'PT' + Math.max(0, dialogue.startMs) / 1000 + 'S'}
                    >
                      {formatTimecode(dialogue.startMs)}
                    </time>
                  </span>
                  <span className="dialogue-timing-input">
                    <input
                      aria-label="开始时间（毫秒）"
                      data-display-time={formatTimecode(dialogue.startMs)}
                      data-testid="dialogue-inspector-start"
                      inputMode="numeric"
                      min={0}
                      onChange={(event) => setStartMs(event.target.value)}
                      type="number"
                      value={startMs}
                    />
                    <span aria-hidden="true">ms</span>
                  </span>
                </label>
                <label className="dialogue-field">
                  <span className="dialogue-timing-label">
                    结束
                    <time
                      data-testid="dialogue-inspector-end-readable"
                      dateTime={'PT' + Math.max(0, dialogue.endMs) / 1000 + 'S'}
                    >
                      {formatTimecode(dialogue.endMs)}
                    </time>
                  </span>
                  <span className="dialogue-timing-input">
                    <input
                      aria-label="结束时间（毫秒）"
                      data-display-time={formatTimecode(dialogue.endMs)}
                      data-testid="dialogue-inspector-end"
                      inputMode="numeric"
                      min={0}
                      onChange={(event) => setEndMs(event.target.value)}
                      type="number"
                      value={endMs}
                    />
                    <span aria-hidden="true">ms</span>
                  </span>
                </label>
              </div>
              <div className="dialogue-timing-footer">
                <p
                  className="dialogue-point-time"
                  data-duration-ms={Math.max(0, dialogue.endMs - dialogue.startMs)}
                  data-testid="dialogue-inspector-timing-summary"
                >
                  <span>持续</span>{' '}
                  <time
                    dateTime={
                      'PT' +
                      Math.max(0, dialogue.endMs - dialogue.startMs) / 1000 +
                      'S'
                    }
                  >
                    {formatTimecode(dialogue.endMs - dialogue.startMs)}
                  </time>
                </p>
                <button
                  className="dialogue-properties-apply-timing"
                  data-testid="dialogue-inspector-apply-timing"
                  disabled={!timingInputValid}
                  onClick={commitTiming}
                  type="button"
                >
                  应用时间
                </button>
              </div>
              {error?.scope === 'timing' ? (
                <p
                  className="dialogue-editor-error"
                  data-error-scope="timing"
                  data-testid="dialogue-editor-error"
                  role="alert"
                >
                  {error.message}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <button
                className="dialogue-properties-arrange"
                data-testid="dialogue-inspector-arrange"
                onClick={() =>
                  report(
                    'timing',
                    () =>
                      dialogueStore.arrange(
                        dialogue.id,
                        integerFrameSpanMs(),
                      ),
                    '未定时对白安排失败。',
                  )
                }
                type="button"
              >
                安排为一帧
              </button>
              <p className="dialogue-point-time">
                待安排字幕尚未产生显示时间窗。
              </p>
            </>
          )}
        </section>

        <section
          className="dialogue-properties-section dialogue-properties-audio-section"
          data-testid="dialogue-inspector-audio-section"
        >
          <div className="dialogue-properties-section-heading">
            <DecorativeIcon icon={Volume2} size={18} />
            <h3>音频</h3>
          </div>
          <div
            className="dialogue-properties-audio-state"
            data-audio-bound={String(Boolean(audioClip))}
          >
            <span className="dialogue-properties-audio-icon">
              <DecorativeIcon icon={Volume2} size={16} />
            </span>
            <div>
              <strong>{audioClip ? '已绑定音频' : '未绑定音频'}</strong>
              <p data-testid="dialogue-inspector-audio-summary">
                {audioSummary}
              </p>
            </div>
          </div>
          <span className="dialogue-inspector-audio-note">
            音频播放区间独立于字幕时间；当前仅展示已有绑定状态。
          </span>
        </section>

        <div className="dialogue-properties-actions">
          <button
            aria-label={`删除字幕：${character?.name ?? '未知角色'}：${dialogue.text}`}
            className="dialogue-delete"
            data-testid="dialogue-inspector-delete"
            onClick={() => dialogueStore.remove(dialogue.id)}
            type="button"
          >
            <span className="ui-icon-label">
              <DecorativeIcon icon={Trash2} size={16} />
              <span>删除字幕</span>
            </span>
          </button>
        </div>
      </div>
    );
  }

  if (landscapePresentation) {
    return (
      <div
        className="dialogue-inspector dialogue-inspector-landscape dialogue-inspector-landscape-properties"
        data-dialogue-id={dialogue.id}
        data-testid="dialogue-inspector"
      >
        <header
          aria-live="polite"
          className="dialogue-properties-header dialogue-inspector-context-summary"
          data-testid="dialogue-properties-header"
        >
          <div
            className="dialogue-properties-heading-copy dialogue-inspector-context-copy"
            data-testid="dialogue-inspector-context"
          >
            <p className="eyebrow">{timed ? '已安排字幕' : '待安排字幕'}</p>
            <div className="dialogue-landscape-properties-identity-row">
              <strong data-testid="dialogue-inspector-speaker-name">
                {character?.name ?? '未知角色'}
              </strong>
              <span
                className="dialogue-properties-status"
                data-testid="dialogue-inspector-status"
                data-timed={String(timed)}
              >
                {timed ? '已定时' : '待安排'}
              </span>
            </div>
            <p
              className="dialogue-properties-identity"
              data-testid="dialogue-properties-identity"
              title={dialogue.text}
            >
              {dialogue.text}
            </p>
          </div>
        </header>

        <section
          className="dialogue-properties-section dialogue-landscape-properties-section dialogue-landscape-properties-copy-section"
          data-testid="dialogue-inspector-copy-section"
        >
          <div className="dialogue-properties-section-heading">
            <DecorativeIcon icon={MessageSquareText} size={18} />
            <h3>台词</h3>
          </div>
          <label className="dialogue-field">
            <span>内容</span>
            <textarea
              aria-label="台词内容"
              className="dialogue-landscape-properties-textarea"
              data-testid="dialogue-inspector-text"
              value={text}
              rows={3}
              onChange={(event) => setText(event.target.value)}
              onFocus={() => {
                focusedRef.current = true;
              }}
              onBlur={commitText}
            />
          </label>
          {subtitleWarning ? (
            <p
              className="dialogue-editor-error"
              data-testid="dialogue-subtitle-warning"
              role="status"
            >
              {subtitleWarning}
            </p>
          ) : null}
          {error?.scope === 'text' ? (
            <p
              className="dialogue-editor-error"
              data-error-scope="text"
              data-testid="dialogue-editor-error"
              role="alert"
            >
              {error.message}
            </p>
          ) : null}
        </section>

        <section
          className="dialogue-properties-section dialogue-landscape-properties-section dialogue-landscape-properties-timing-section"
          data-testid="dialogue-inspector-time-section"
        >
          <div className="dialogue-properties-section-heading">
            <DecorativeIcon icon={Clock3} size={18} />
            <h3>时间</h3>
          </div>
          {timed ? (
            <>
              <div className="dialogue-timing-fields dialogue-landscape-properties-timing-fields">
                <label className="dialogue-field">
                  <span className="dialogue-timing-label">
                    <span>开始</span>
                    <time
                      data-testid="dialogue-inspector-start-readable"
                      dateTime={
                        'PT' + Math.max(0, dialogue.startMs) / 1000 + 'S'
                      }
                    >
                      {formatTimecode(dialogue.startMs)}
                    </time>
                  </span>
                  <span className="dialogue-timing-input">
                    <input
                      aria-label="开始时间（毫秒）"
                      className="dialogue-landscape-properties-time-input"
                      data-testid="dialogue-inspector-start"
                      data-display-time={formatTimecode(dialogue.startMs)}
                      inputMode="numeric"
                      min={0}
                      onChange={(event) => setStartMs(event.target.value)}
                      type="number"
                      value={startMs}
                    />
                    <span aria-hidden="true">ms</span>
                  </span>
                </label>
                <label className="dialogue-field">
                  <span className="dialogue-timing-label">
                    <span>结束</span>
                    <time
                      data-testid="dialogue-inspector-end-readable"
                      dateTime={
                        'PT' + Math.max(0, dialogue.endMs) / 1000 + 'S'
                      }
                    >
                      {formatTimecode(dialogue.endMs)}
                    </time>
                  </span>
                  <span className="dialogue-timing-input">
                    <input
                      aria-label="结束时间（毫秒）"
                      className="dialogue-landscape-properties-time-input"
                      data-testid="dialogue-inspector-end"
                      data-display-time={formatTimecode(dialogue.endMs)}
                      inputMode="numeric"
                      min={0}
                      onChange={(event) => setEndMs(event.target.value)}
                      type="number"
                      value={endMs}
                    />
                    <span aria-hidden="true">ms</span>
                  </span>
                </label>
              </div>
              <div className="dialogue-timing-footer dialogue-landscape-properties-timing-footer">
                <p
                  className="dialogue-point-time"
                  data-duration-ms={Math.max(
                    0,
                    dialogue.endMs - dialogue.startMs,
                  )}
                  data-testid="dialogue-inspector-timing-summary"
                >
                  <span>持续</span>
                  <time
                    dateTime={
                      'PT' +
                      Math.max(0, dialogue.endMs - dialogue.startMs) / 1000 +
                      'S'
                    }
                  >
                    {formatTimecode(dialogue.endMs - dialogue.startMs)}
                  </time>
                </p>
                <button
                  className="dialogue-properties-apply-timing"
                  data-testid="dialogue-inspector-apply-timing"
                  disabled={!timingInputValid}
                  onClick={commitTiming}
                  type="button"
                >
                  应用时间
                </button>
              </div>
              {error?.scope === 'timing' ? (
                <p
                  className="dialogue-editor-error"
                  data-error-scope="timing"
                  data-testid="dialogue-editor-error"
                  role="alert"
                >
                  {error.message}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <button
                className="dialogue-properties-arrange"
                data-testid="dialogue-inspector-arrange"
                onClick={() =>
                  report(
                    'timing',
                    () =>
                      dialogueStore.arrange(
                        dialogue.id,
                        integerFrameSpanMs(),
                      ),
                    '未定时对白安排失败。',
                  )
                }
                type="button"
              >
                安排为一帧
              </button>
              <p className="dialogue-point-time">
                待安排字幕尚未产生显示时间窗。
              </p>
            </>
          )}
        </section>

        <section
          className="dialogue-properties-section dialogue-landscape-properties-section dialogue-landscape-properties-speaker-section"
          data-testid="dialogue-inspector-speaker-section"
        >
          <div className="dialogue-properties-section-heading">
            <DecorativeIcon icon={UserRound} size={18} />
            <h3>角色（说话人）</h3>
          </div>
          <label className="dialogue-field">
            <span>角色（说话人）</span>
            <select
              aria-label="字幕角色"
              className="dialogue-landscape-properties-speaker-select"
              data-testid="dialogue-inspector-speaker"
              value={dialogue.characterId}
              onChange={(event) =>
                report(
                  'speaker',
                  () =>
                    dialogueStore.update(dialogue.id, {
                      characterId: event.target.value,
                    }),
                  '角色无效。',
                )
              }
            >
              {characters.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
          {error?.scope === 'speaker' ? (
            <p
              className="dialogue-editor-error"
              data-error-scope="speaker"
              data-testid="dialogue-editor-error"
              role="alert"
            >
              {error.message}
            </p>
          ) : null}
        </section>

        <section
          className="dialogue-properties-section dialogue-properties-audio-section dialogue-landscape-properties-section dialogue-landscape-properties-audio-section"
          data-testid="dialogue-inspector-audio-section"
        >
          <div className="dialogue-properties-section-heading">
            <DecorativeIcon icon={Volume2} size={18} />
            <h3>音频</h3>
          </div>
          <div
            className="dialogue-landscape-properties-audio-state"
            data-audio-bound={String(Boolean(audioClip))}
          >
            <strong>{audioClip ? '已绑定音频' : '未绑定音频'}</strong>
            <p data-testid="dialogue-inspector-audio-summary">
              {audioSummary}
            </p>
          </div>
          <span className="dialogue-inspector-audio-note">
            音频播放区间独立于字幕时间；当前仅展示已有绑定状态。
          </span>
        </section>

        <div className="dialogue-properties-actions dialogue-landscape-properties-actions">
          <button
            aria-label={`删除字幕：${character?.name ?? '未知角色'}：${dialogue.text}`}
            className="dialogue-delete"
            data-testid="dialogue-inspector-delete"
            onClick={() => dialogueStore.remove(dialogue.id)}
            type="button"
          >
            <span className="ui-icon-label">
              <DecorativeIcon icon={Trash2} size={16} />
              <span>删除字幕</span>
            </span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="right-inspector-heading">
        <div>
          <p className="eyebrow">右侧检查器</p>
          <h2 id="right-inspector-heading">对白检查器</h2>
        </div>
        <span>当前镜头</span>
      </div>
      <section
        aria-live="polite"
        className="right-inspector-selection"
        data-selection-state="dialogue"
        data-testid="right-inspector-selection"
      >
        <p className="eyebrow">当前选择</p>
        <strong>{character?.name ?? '未知角色'}</strong>
        <span data-testid="right-inspector-selection-message">
          已选择对白：{character?.name ?? dialogue.characterId}
        </span>
      </section>
      <div
        className="dialogue-inspector"
        data-testid="dialogue-inspector"
      >
        <label className="dialogue-field">
          <span>角色（说话人）</span>
          <select
            data-testid="dialogue-inspector-speaker"
            value={dialogue.characterId}
            onChange={(event) =>
              report(
                'speaker',
                () =>
                  dialogueStore.update(dialogue.id, {
                    characterId: event.target.value,
                  }),
                '角色无效。',
              )
            }
          >
            {characters.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        {subtitleWarning ? (
          <p
            className="dialogue-editor-error"
            data-testid="dialogue-subtitle-warning"
            role="status"
          >
            {subtitleWarning}
          </p>
        ) : null}
        <label className="dialogue-field">
          <span>台词</span>
          <textarea
            data-testid="dialogue-inspector-text"
            value={text}
            rows={4}
            onChange={(event) => setText(event.target.value)}
            onFocus={() => {
              focusedRef.current = true;
            }}
            onBlur={commitText}
          />
        </label>
        {timed ? (
          <div className="dialogue-timing-fields">
            <label className="dialogue-field">
              <span>开始（ms）</span>
              <input
                data-testid="dialogue-inspector-start"
                inputMode="numeric"
                min={0}
                onChange={(event) => setStartMs(event.target.value)}
                type="number"
                value={startMs}
              />
            </label>
            <label className="dialogue-field">
              <span>结束（ms）</span>
              <input
                data-testid="dialogue-inspector-end"
                inputMode="numeric"
                min={0}
                onChange={(event) => setEndMs(event.target.value)}
                type="number"
                value={endMs}
              />
            </label>
            <button
              data-testid="dialogue-inspector-apply-timing"
              onClick={commitTiming}
              type="button"
            >
              应用时间
            </button>
          </div>
        ) : (
          <button
            className="dialogue-arrange"
            data-testid="dialogue-inspector-arrange"
            onClick={() =>
              report(
                'timing',
                () =>
                  dialogueStore.arrange(
                    dialogue.id,
                    integerFrameSpanMs(),
                  ),
                '未定时对白安排失败。',
              )
            }
            type="button"
          >
            安排为一帧
          </button>
        )}
        {error ? (
          <p
            className="dialogue-editor-error"
            data-testid="dialogue-editor-error"
            role="alert"
          >
            {error.message}
          </p>
        ) : null}
        <button
          type="button"
          className="dialogue-delete"
          data-testid="dialogue-inspector-delete"
          onClick={() => dialogueStore.remove(dialogue.id)}
        >
          删除对白
        </button>
        <p className="dialogue-point-time">
          {timed
            ? `时间段：${dialogue.startMs}–${dialogue.endMs}ms`
            : `未定时：${dialogue.startMs}ms（选择“安排为一帧”后才产生字幕窗口）`}
        </p>
      </div>
    </>
  );
}
