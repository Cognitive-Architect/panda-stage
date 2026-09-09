import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Clock3, MessageSquareText, Trash2, UserRound, Volume2 } from 'lucide-react';
import {
  getBoundAudioEndRange,
  type AudioAsset,
  type Character,
} from '../../../domain';
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

function parseSecondsToMilliseconds(
  value: string,
  label: string,
): number {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new Error(`${label}不能为空。`);
  }
  const seconds = Number(trimmed);
  if (!Number.isFinite(seconds)) {
    throw new Error(`${label}必须是有效的秒数。`);
  }
  const milliseconds = Math.round(seconds * 1_000);
  if (!Number.isSafeInteger(milliseconds)) {
    throw new Error(`${label}超出支持的时间范围。`);
  }
  return milliseconds;
}

/** Convert a human-readable seconds draft to the integer-ms project boundary. */
export function secondsToMilliseconds(value: string, label = '时间'): number {
  return parseSecondsToMilliseconds(value, label);
}

/** Display integer-ms project timing with at most millisecond precision. */
export function millisecondsToSeconds(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) return '—';
  const roundedMilliseconds = Math.round(milliseconds);
  if (!Number.isSafeInteger(roundedMilliseconds)) return '—';
  return (
    roundedMilliseconds / 1_000
  )
    .toFixed(3)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1');
}

/** Keep audio summaries human-readable without changing the integer-ms model. */
export function formatHumanAudioDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) return '—';
  const roundedMilliseconds = Math.round(milliseconds);
  if (!Number.isSafeInteger(roundedMilliseconds)) return '—';
  return `${(Math.max(0, roundedMilliseconds) / 1_000).toFixed(2)} 秒`;
}

export function normalizeManualDialogueTiming(
  startSecondsValue: string,
  durationSecondsValue: string,
  durationMs: number,
): { startMs: number; endMs: number } {
  const startMs = secondsToMilliseconds(startSecondsValue, '开始时间');
  const durationMilliseconds = secondsToMilliseconds(
    durationSecondsValue,
    '时长',
  );
  if (startMs < 0) {
    throw new Error('开始时间不能小于 0 秒。');
  }
  if (durationMilliseconds < 1) {
    throw new Error('时长必须大于 0 秒。');
  }
  if (!Number.isSafeInteger(durationMs) || durationMs < 1) {
    throw new Error('当前镜头时长无效。');
  }
  if (startMs > durationMs) {
    throw new Error('开始时间不能超过当前镜头时长。');
  }
  const endMs = startMs + durationMilliseconds;
  if (!Number.isSafeInteger(endMs)) {
    throw new Error('开始时间与时长超出支持的时间范围。');
  }
  if (endMs > durationMs) {
    throw new Error('开始时间加时长不能超过当前镜头时长。');
  }

  return {
    startMs,
    endMs,
  };
}

function normalizeLegacyManualDialogueTiming(
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

type DialogueInspectorErrorScope = 'text' | 'timing' | 'speaker' | 'audio';

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
  const audioAssets: readonly AudioAsset[] =
    snapshot?.project.assets.filter(
      (candidate): candidate is AudioAsset => candidate.kind === 'audio',
    ) ?? [];
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
    ? audioAssets.find((candidate) => candidate.id === audioClip.assetId)
    : undefined;
  const audioEndRange =
    shot && dialogue && audioClip && audioAsset?.durationMs !== undefined
      ? getBoundAudioEndRange({
          shotDurationMs: shot.durationMs,
          dialogueEndMs: dialogue.endMs,
          clipStartMs: audioClip.startMs,
          clipOffsetMs: audioClip.offsetMs,
          sourceDurationMs: audioAsset.durationMs,
        })
      : null;
  const audioClipDurationMs = audioClip
    ? Math.max(0, audioClip.endMs - audioClip.startMs)
    : 0;
  const audioTrimMaximumDurationMs = audioClip && audioEndRange
    ? audioEndRange.maximumEndMs - audioClip.startMs
    : 0;
  const sourceAvailableDurationMs = audioClip && audioAsset?.durationMs
    ? Math.max(0, audioAsset.durationMs - audioClip.offsetMs)
    : 0;
  const audioSummary = audioClip
    ? `音频 ${formatHumanAudioDuration(audioClipDurationMs)}`
    : dialogue?.audioClipId
      ? '绑定配音不可用'
      : null;
  const unavailableAudioCount = audioAssets.filter(
    (asset) =>
      asset.durationMs === undefined || asset.metadata?.status === 'error',
  ).length;

  const [text, setText] = useState(dialogue?.text ?? '');
  const [startMs, setStartMs] = useState(String(dialogue?.startMs ?? 0));
  const [endMs, setEndMs] = useState(String(dialogue?.endMs ?? 0));
  const [startSeconds, setStartSeconds] = useState(
    millisecondsToSeconds(dialogue?.startMs ?? 0),
  );
  const [durationSeconds, setDurationSeconds] = useState(
    millisecondsToSeconds(
      Math.max(0, (dialogue?.endMs ?? 0) - (dialogue?.startMs ?? 0)),
    ),
  );
  const [error, setError] = useState<DialogueInspectorError | null>(null);
  const [audioTrimEditorOpen, setAudioTrimEditorOpen] = useState(false);
  const [audioTrimDurationMs, setAudioTrimDurationMs] = useState(
    audioClipDurationMs,
  );
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setText(dialogue?.text ?? '');
    setStartMs(String(dialogue?.startMs ?? 0));
    setEndMs(String(dialogue?.endMs ?? 0));
    setStartSeconds(millisecondsToSeconds(dialogue?.startMs ?? 0));
    setDurationSeconds(
      millisecondsToSeconds(
        Math.max(0, (dialogue?.endMs ?? 0) - (dialogue?.startMs ?? 0)),
      ),
    );
    setError(null);
  }, [dialogue?.id, dialogue?.text, dialogue?.startMs, dialogue?.endMs]);

  useEffect(() => {
    setAudioTrimEditorOpen(false);
    setAudioTrimDurationMs(audioClipDurationMs);
  }, [audioClip?.id, audioClip?.startMs, audioClip?.endMs]);

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
  ): boolean => {
    try {
      action();
      setError(null);
      return true;
    } catch (nextError) {
      setError({
        scope,
        message: nextError instanceof Error ? nextError.message : fallback,
      });
      return false;
    }
  };

  const openAudioTrimEditor = (): void => {
    if (!audioClip || !audioEndRange) return;
    setAudioTrimDurationMs(
      Math.min(
        audioTrimMaximumDurationMs,
        Math.max(1, audioClipDurationMs),
      ),
    );
    setAudioTrimEditorOpen(true);
    setError(null);
  };

  const cancelAudioTrim = (): void => {
    setAudioTrimDurationMs(audioClipDurationMs);
    setAudioTrimEditorOpen(false);
    setError(null);
  };

  const applyAudioTrim = (): void => {
    if (!audioClip || !audioEndRange) return;
    const applied = report(
      'audio',
      () =>
        dialogueStore.resizeBoundAudioEnd(
          dialogue.id,
          audioClip.startMs + audioTrimDurationMs,
        ),
      '配音时长调整失败。',
    );
    if (applied) setAudioTrimEditorOpen(false);
  };

  const audioBindingControl = timed ? (
    <div
      className={`dialogue-audio-state${audioClip ? ' is-bound' : ' is-empty'}`}
      data-audio-bound={String(Boolean(audioClip))}
    >
      {audioClip ? (
        <div
          className="dialogue-audio-source-card"
          data-testid="dialogue-inspector-audio-summary"
        >
          <strong>{audioAsset?.name ?? audioClip.name}</strong>
          {!audioTrimEditorOpen ? (
            <span>
              音频{' '}
              <time dateTime={`PT${audioClipDurationMs / 1000}S`}>
                {formatHumanAudioDuration(audioClipDurationMs)}
              </time>
            </span>
          ) : null}
        </div>
      ) : null}
      {audioTrimEditorOpen && audioClip && audioAsset && audioEndRange ? (
        <div
          className="dialogue-audio-duration-editor"
          data-testid="dialogue-inspector-audio-duration-editor"
        >
          <dl className="dialogue-audio-duration-facts">
            <div>
              <dt>片段时长</dt>
              <dd>
                <output data-testid="dialogue-inspector-audio-duration-draft">
                  {formatTimecode(audioTrimDurationMs)}
                </output>
              </dd>
            </div>
            <div>
              <dt>可用原音频</dt>
              <dd>
                <time>{formatTimecode(sourceAvailableDurationMs)}</time>
              </dd>
            </div>
          </dl>
          <label className="dialogue-audio-duration-slider">
            <span>调整片段时长</span>
            <input
              aria-label="配音片段时长"
              aria-valuetext={formatTimecode(audioTrimDurationMs)}
              data-testid="dialogue-inspector-audio-duration-input"
              max={audioTrimMaximumDurationMs}
              min={1}
              onChange={(event) =>
                setAudioTrimDurationMs(Number(event.target.value))
              }
              step={1}
              type="range"
              value={audioTrimDurationMs}
            />
          </label>
          <div className="dialogue-audio-duration-range" aria-hidden="true">
            <span>{formatTimecode(1)}</span>
            <span>当前上限 {formatTimecode(audioTrimMaximumDurationMs)}</span>
          </div>
          <div className="dialogue-audio-duration-actions">
            <button
              data-testid="dialogue-inspector-audio-duration-restore"
              onClick={() =>
                setAudioTrimDurationMs(audioTrimMaximumDurationMs)
              }
              type="button"
            >
              恢复可用长度
            </button>
            <button
              data-testid="dialogue-inspector-audio-duration-cancel"
              onClick={cancelAudioTrim}
              type="button"
            >
              取消
            </button>
            <button
              className="is-primary"
              data-testid="dialogue-inspector-audio-duration-apply"
              disabled={audioTrimDurationMs === audioClipDurationMs}
              onClick={applyAudioTrim}
              type="button"
            >
              应用
            </button>
          </div>
        </div>
      ) : (
        <div className="dialogue-audio-actions">
          <select
            aria-label={audioClip ? '更换配音' : '选择配音'}
            className="dialogue-audio-select-action"
            data-testid="dialogue-inspector-audio"
            disabled={audioAssets.length === 0}
            value=""
            onChange={(event) => {
              if (!event.target.value) return;
              report(
                'audio',
                () => dialogueStore.bindAudio(dialogue.id, event.target.value),
                '配音绑定失败。',
              );
            }}
          >
            <option value="">
              {audioAssets.length === 0
                ? '当前项目没有可用配音'
                : audioClip
                  ? '更换配音'
                  : '选择配音'}
            </option>
            {audioAssets.map((asset) => {
              const ready =
                asset.durationMs !== undefined &&
                asset.metadata?.status !== 'error';
              return (
                <option disabled={!ready} key={asset.id} value={asset.id}>
                  {asset.name}
                  {ready
                    ? ` · ${formatTimecode(asset.durationMs!)}`
                    : ' · 正在准备…'}
                </option>
              );
            })}
          </select>
          {audioClip ? (
            <>
              <button
                className="dialogue-audio-trim-action"
                data-testid="dialogue-inspector-audio-trim"
                disabled={!audioEndRange}
                onClick={openAudioTrimEditor}
                type="button"
              >
                调整时长
              </button>
              <button
                className="dialogue-audio-unbind"
                data-testid="dialogue-inspector-audio-unbind"
                onClick={() =>
                  report(
                    'audio',
                    () => dialogueStore.unbindAudio(dialogue.id),
                    '移除配音失败。',
                  )
                }
                type="button"
              >
                移除配音
              </button>
            </>
          ) : null}
        </div>
      )}
      {unavailableAudioCount > 0 ? (
        <small data-testid="dialogue-inspector-audio-unavailable">
          {unavailableAudioCount} 段配音尚未准备好。
        </small>
      ) : null}
      {error?.scope === 'audio' ? (
        <p
          className="dialogue-editor-error"
          data-error-scope="audio"
          data-testid="dialogue-editor-error"
          role="alert"
        >
          {error.message}
        </p>
      ) : null}
    </div>
  ) : (
    <p
      className="dialogue-properties-untimed-audio"
      data-testid="dialogue-inspector-untimed-audio"
    >
      安排到时间轴后即可添加配音。
    </p>
  );

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

  const commitLegacyTiming = (): void => {
    let timing: { startMs: number; endMs: number };
    try {
      timing = normalizeLegacyManualDialogueTiming(
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

  const commitTiming = (): void => {
    let timing: { startMs: number; endMs: number };
    try {
      timing = normalizeManualDialogueTiming(
        startSeconds,
        durationSeconds,
        shot.durationMs,
      );
    } catch (nextError) {
      setError({
        scope: 'timing',
        message:
          nextError instanceof Error
            ? nextError.message
            : '开始时间和时长必须是有效的秒数。',
      });
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
        setStartSeconds(millisecondsToSeconds(timing.startMs));
        setDurationSeconds(
          millisecondsToSeconds(timing.endMs - timing.startMs),
        );
      },
      '对白时间段无效。',
    );
  };

  const timingInputValid = [startMs, endMs].every((value) => {
    if (value.trim() === '') return false;
    const raw = Number(value);
    return Number.isFinite(raw) && Number.isInteger(raw);
  });

  const parseSecondsDraft = (value: string): number | null => {
    if (value.trim() === '') return null;
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return null;
    const milliseconds = Math.round(seconds * 1_000);
    return Number.isSafeInteger(milliseconds) ? milliseconds : null;
  };
  const draftStartMs = parseSecondsDraft(startSeconds);
  const draftDurationMs = parseSecondsDraft(durationSeconds);
  const draftEndMs =
    draftStartMs !== null &&
    draftDurationMs !== null &&
    Number.isSafeInteger(draftStartMs + draftDurationMs)
      ? draftStartMs + draftDurationMs
      : null;
  // Keep these readable aliases for the existing presentation markup; they
  // now intentionally contain seconds, not legacy timecode strings.
  const draftStartTimecode =
    draftStartMs === null ? '—' : millisecondsToSeconds(draftStartMs);
  const draftDurationTimecode =
    draftDurationMs === null ? '—' : millisecondsToSeconds(draftDurationMs);
  const draftEndTimecode =
    draftEndMs === null ? '—' : millisecondsToSeconds(draftEndMs);

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
                  onClick={commitLegacyTiming}
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
              快速安排
            </button>
          )}
          {!timed ? (
            <p className="dialogue-point-time">
              安排后即会在时间轴产生显示窗口。
            </p>
          ) : null}
        </section>

        <section
          className="dialogue-inspector-section dialogue-inspector-speaker-section dialogue-timed-speaker-section"
          data-testid="dialogue-inspector-speaker-section"
        >
          <h3>角色</h3>
          <label className="dialogue-field">
            <span>角色</span>
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
          <h3>配音</h3>
          {audioSummary ? (
            <p data-testid="dialogue-inspector-audio-summary">
              {audioSummary}
            </p>
          ) : null}
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
          aria-label="字幕属性"
          className="dialogue-properties-identity-editor"
          data-testid="dialogue-properties-header"
        >
          <DecorativeIcon icon={MessageSquareText} size={18} />
          <div
            className="dialogue-properties-identity-copy"
            data-testid="dialogue-inspector-copy-section"
          >
            <strong
              className="dialogue-properties-identity"
              data-testid="dialogue-properties-identity"
            >
              {character?.name ?? '未知角色'}
            </strong>
            <textarea
              aria-label="台词内容"
              className="dialogue-properties-inline-text"
              data-testid="dialogue-inspector-text"
              value={text}
              rows={2}
              onChange={(event) => setText(event.target.value)}
              onFocus={() => {
                focusedRef.current = true;
              }}
              onBlur={commitText}
            />
          </div>
          {!timed ? <span className="dialogue-properties-status">待安排</span> : null}
        </header>
        <div className="dialogue-properties-inline-feedback">
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
        </div>

        <section
          className="dialogue-properties-section dialogue-properties-time-section"
          data-testid="dialogue-inspector-time-section"
        >
          <div className="dialogue-properties-section-heading">
            <DecorativeIcon icon={Clock3} size={18} />
            <h3>时间</h3>
            {timed ? (
              <button
                className="dialogue-properties-apply-timing"
                data-testid="dialogue-inspector-apply-timing"
                onClick={commitTiming}
                type="button"
              >
                应用
              </button>
            ) : null}
          </div>
          {timed ? (
            <>
              <div className="dialogue-compact-timing-grid">
                <label className="dialogue-compact-time-cell">
                  <span>开始（秒）</span>
                  <span className="dialogue-compact-time-value dialogue-compact-time-editable">
                    <output hidden data-testid="dialogue-inspector-start-readable">
                      {draftStartTimecode}
                    </output>
                    <input
                      className="dialogue-timing-seconds-input"
                      aria-label="开始（秒）"
                      aria-invalid={draftStartMs === null}
                      aria-valuetext={draftStartTimecode}
                      data-display-time={draftStartTimecode}
                      data-persisted-timecode={formatTimecode(dialogue.startMs)}
                      data-testid="dialogue-inspector-start"
                      inputMode="decimal"
                      onChange={(event) => {
                        setStartSeconds(event.target.value);
                        setError((current) =>
                          current?.scope === 'timing' ? null : current,
                        );
                      }}
                      onClick={(event) => event.currentTarget.select()}
                      onFocus={(event) => event.currentTarget.select()}
                      type="text"
                      value={startSeconds}
                    />
                    <span aria-hidden="true" className="dialogue-time-unit">
                      秒
                    </span>
                  </span>
                </label>
                <label className="dialogue-compact-time-cell">
                  <span>时长（秒）</span>
                  <span className="dialogue-compact-time-value dialogue-compact-time-editable">
                    <output hidden data-testid="dialogue-inspector-duration-readable">
                      {draftDurationTimecode}
                    </output>
                    <input
                      className="dialogue-timing-seconds-input"
                      aria-label="时长（秒）"
                      aria-invalid={draftDurationMs === null}
                      aria-valuetext={draftDurationTimecode}
                      data-display-time={draftDurationTimecode}
                      data-testid="dialogue-inspector-duration"
                      inputMode="decimal"
                      onChange={(event) => {
                        setDurationSeconds(event.target.value);
                        setError((current) =>
                          current?.scope === 'timing' ? null : current,
                        );
                      }}
                      onClick={(event) => event.currentTarget.select()}
                      onFocus={(event) => event.currentTarget.select()}
                      type="text"
                      value={durationSeconds}
                    />
                    <span aria-hidden="true" className="dialogue-time-unit">
                      秒
                    </span>
                  </span>
                </label>
                <div
                  className="dialogue-compact-time-cell is-derived"
                  data-duration-ms={draftDurationMs ?? ''}
                  data-testid="dialogue-inspector-timing-summary"
                >
                  <span>结束</span>
                  <span
                    className="dialogue-compact-time-value dialogue-compact-time-derived"
                    data-read-only="true"
                    data-testid="dialogue-inspector-end"
                  >
                    <output
                      aria-label="结束"
                      aria-readonly="true"
                      aria-valuetext={draftEndTimecode}
                      data-display-time={draftEndTimecode}
                      data-persisted-timecode={formatTimecode(dialogue.endMs)}
                      data-testid="dialogue-inspector-end-readable"
                    >
                      {draftEndTimecode}
                    </output>
                    <span aria-hidden="true" className="dialogue-time-unit">
                      秒
                    </span>
                    <span className="dialogue-time-auto-badge">自动计算</span>
                  </span>
                </div>
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
                快速安排
              </button>
              <p className="dialogue-point-time">
                安排后即会在时间轴产生显示窗口。
              </p>
            </>
          )}
        </section>

        <section
          className="dialogue-properties-section dialogue-properties-speaker-section"
          data-testid="dialogue-inspector-speaker-section"
        >
          <div className="dialogue-properties-section-heading">
            <DecorativeIcon icon={UserRound} size={18} />
            <h3>角色</h3>
          </div>
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
          {error?.scope === 'speaker' ? (
            <p className="dialogue-editor-error" role="alert">
              {error.message}
            </p>
          ) : null}
        </section>

        <section
          className="dialogue-properties-section dialogue-properties-audio-section"
          data-testid="dialogue-inspector-audio-section"
        >
          <div className="dialogue-properties-section-heading">
            <DecorativeIcon icon={Volume2} size={18} />
            <h3>配音</h3>
          </div>
          {audioBindingControl}
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
          aria-label="字幕属性"
          className="dialogue-properties-identity-editor dialogue-landscape-properties-identity-editor"
          data-testid="dialogue-properties-header"
        >
          <DecorativeIcon icon={MessageSquareText} size={18} />
          <div
            className="dialogue-properties-identity-copy"
            data-testid="dialogue-inspector-copy-section"
          >
            <strong
              className="dialogue-properties-identity"
              data-testid="dialogue-inspector-speaker-name"
            >
              {character?.name ?? '未知角色'}
            </strong>
            <textarea
              aria-label="台词内容"
              className="dialogue-properties-inline-text dialogue-landscape-properties-textarea"
              data-testid="dialogue-inspector-text"
              value={text}
              rows={2}
              onChange={(event) => setText(event.target.value)}
              onFocus={() => {
                focusedRef.current = true;
              }}
              onBlur={commitText}
            />
          </div>
          {!timed ? <span className="dialogue-properties-status">待安排</span> : null}
        </header>
        <div className="dialogue-properties-inline-feedback">
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
        </div>

        <section
          className="dialogue-properties-section dialogue-landscape-properties-section dialogue-landscape-properties-timing-section"
          data-testid="dialogue-inspector-time-section"
        >
          <div className="dialogue-properties-section-heading">
            <DecorativeIcon icon={Clock3} size={18} />
            <h3>时间</h3>
            {timed ? (
              <button
                className="dialogue-properties-apply-timing"
                data-testid="dialogue-inspector-apply-timing"
                onClick={commitTiming}
                type="button"
              >
                应用
              </button>
            ) : null}
          </div>
          {timed ? (
            <>
              <div className="dialogue-compact-timing-grid">
                <label className="dialogue-compact-time-cell">
                  <span>开始（秒）</span>
                  <span className="dialogue-compact-time-value dialogue-compact-time-editable">
                    <output hidden data-testid="dialogue-inspector-start-readable">
                      {draftStartTimecode}
                    </output>
                    <input
                      className="dialogue-timing-seconds-input"
                      aria-label="开始（秒）"
                      aria-invalid={draftStartMs === null}
                      aria-valuetext={draftStartTimecode}
                      data-testid="dialogue-inspector-start"
                      data-display-time={draftStartTimecode}
                      data-persisted-timecode={formatTimecode(dialogue.startMs)}
                      inputMode="decimal"
                      onChange={(event) => {
                        setStartSeconds(event.target.value);
                        setError((current) =>
                          current?.scope === 'timing' ? null : current,
                        );
                      }}
                      onClick={(event) => event.currentTarget.select()}
                      onFocus={(event) => event.currentTarget.select()}
                      type="text"
                      value={startSeconds}
                    />
                    <span aria-hidden="true" className="dialogue-time-unit">
                      秒
                    </span>
                  </span>
                </label>
                <label className="dialogue-compact-time-cell">
                  <span>时长（秒）</span>
                  <span className="dialogue-compact-time-value dialogue-compact-time-editable">
                    <output hidden data-testid="dialogue-inspector-duration-readable">
                      {draftDurationTimecode}
                    </output>
                    <input
                      className="dialogue-timing-seconds-input"
                      aria-label="时长（秒）"
                      aria-invalid={draftDurationMs === null}
                      aria-valuetext={draftDurationTimecode}
                      data-display-time={draftDurationTimecode}
                      data-testid="dialogue-inspector-duration"
                      inputMode="decimal"
                      onChange={(event) => {
                        setDurationSeconds(event.target.value);
                        setError((current) =>
                          current?.scope === 'timing' ? null : current,
                        );
                      }}
                      onClick={(event) => event.currentTarget.select()}
                      onFocus={(event) => event.currentTarget.select()}
                      type="text"
                      value={durationSeconds}
                    />
                    <span aria-hidden="true" className="dialogue-time-unit">
                      秒
                    </span>
                  </span>
                </label>
                <div
                  className="dialogue-compact-time-cell is-derived"
                  data-duration-ms={Math.max(
                    0,
                    draftDurationMs ?? dialogue.endMs - dialogue.startMs,
                  )}
                  data-testid="dialogue-inspector-timing-summary"
                >
                  <span>结束</span>
                  <span
                    className="dialogue-compact-time-value dialogue-compact-time-derived"
                    data-read-only="true"
                    data-testid="dialogue-inspector-end"
                  >
                    <output
                      aria-label="结束"
                      aria-readonly="true"
                      aria-valuetext={draftEndTimecode}
                      data-display-time={draftEndTimecode}
                      data-persisted-timecode={formatTimecode(dialogue.endMs)}
                      data-testid="dialogue-inspector-end-readable"
                    >
                      {draftEndTimecode}
                    </output>
                    <span aria-hidden="true" className="dialogue-time-unit">
                      秒
                    </span>
                    <span className="dialogue-time-auto-badge">自动计算</span>
                  </span>
                </div>
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
                快速安排
              </button>
              <p className="dialogue-point-time">
                安排后即会在时间轴产生显示窗口。
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
            <h3>角色</h3>
          </div>
          <label className="dialogue-field">
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
            <h3>配音</h3>
          </div>
          {audioBindingControl}
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
              onClick={commitLegacyTiming}
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
