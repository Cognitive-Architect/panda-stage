import { AudioLines, Users } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type {
  Dialogue,
  DialogueBatchMovePlan,
  Project,
  Shot,
} from '../../../domain';
import { Button, DecorativeIcon } from '../../ui';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { shotStore } from '../../stores/shotStore';
import { dialogueStore } from '../../stores/dialogueStore';

interface BatchMoveCandidate {
  readonly dialogueId: string;
  readonly label: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly hasAudio: boolean;
}

const MAX_LABEL_LENGTH = 12;

type BatchMovePreview =
  | { readonly ok: true; readonly plan: DialogueBatchMovePlan }
  | { readonly ok: false; readonly message: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '批量移动失败，请重试。';
}

/** Read-only domain validation; the panel never writes to the Project here. */
function planPreview(
  dialogueIds: readonly string[],
  deltaMs: number | null,
): BatchMovePreview | null {
  if (dialogueIds.length < 2 || deltaMs === null) return null;
  try {
    return { ok: true, plan: dialogueStore.planMoveMany(dialogueIds, deltaMs) };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/** "1.00" — the tool speaks seconds, the domain only speaks integer ms. */
function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

function parseDeltaSeconds(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const seconds = Number(trimmed);
  if (!Number.isFinite(seconds)) return null;
  return Math.round(seconds * 1000);
}

function clampLabel(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_LABEL_LENGTH
    ? `${trimmed.slice(0, MAX_LABEL_LENGTH)}…`
    : trimmed;
}

/** Timed Dialogues of the current Shot, in Timeline order. */
function listCandidates(project: Project, shot: Shot | null): BatchMoveCandidate[] {
  if (!shot) return [];
  const characterName = (characterId: string): string =>
    project.characters.find((candidate) => candidate.id === characterId)?.name ??
    '对白';
  return [...shot.dialogues]
    .filter((dialogue) => dialogue.endMs > dialogue.startMs)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)
    .map((dialogue: Dialogue) => ({
      dialogueId: dialogue.id,
      label: clampLabel(characterName(dialogue.characterId)),
      startMs: dialogue.startMs,
      endMs: dialogue.endMs,
      hasAudio: Boolean(dialogue.audioClipId),
    }));
}

/**
 * Batch Adjust (AUTO-02 V0): shift several Timed Dialogues and their own bound
 * voice clips by one offset. The panel is a thin view over the domain plan; it
 * keeps only local checkbox and delta state and commits through one Store call.
 */
export function BatchDialogueMovePanel(): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const currentShotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
  );
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [deltaInput, setDeltaInput] = useState('0.50');
  const [status, setStatus] = useState('');

  const shot = snapshot?.project.shots.find(
    (candidate) => candidate.id === currentShotId,
  ) ?? null;
  const candidates = useMemo(
    () => (snapshot ? listCandidates(snapshot.project, shot) : []),
    [shot, snapshot],
  );
  const candidateIds = useMemo(
    () => new Set(candidates.map((candidate) => candidate.dialogueId)),
    [candidates],
  );
  // A deleted, retyped, or undone Dialogue must not stay selected.
  useEffect(() => {
    setSelectedIds((current) =>
      current.every((id) => candidateIds.has(id))
        ? current
        : current.filter((id) => candidateIds.has(id)),
    );
  }, [candidateIds]);

  const selection = selectedIds.filter((id) => candidateIds.has(id));
  const deltaMs = parseDeltaSeconds(deltaInput);
  const preview = planPreview(selection, deltaMs);
  const canApply = preview?.ok === true;
  const blockedMessage =
    candidates.length < 2
      ? '当前镜头至少要有两条已定时的对白才能批量调整。'
      : selection.length < 2
        ? '至少勾选两条对白才能整体移动。'
        : deltaMs === null
          ? '请输入有效的秒数，例如 0.50 或 -0.50。'
          : preview && !preview.ok
            ? preview.message
            : '';

  const toggle = (dialogueId: string): void => {
    setStatus('');
    setSelectedIds((current) =>
      current.includes(dialogueId)
        ? current.filter((id) => id !== dialogueId)
        : [...current, dialogueId],
    );
  };

  const apply = (): void => {
    if (!canApply || deltaMs === null) return;
    try {
      dialogueStore.moveMany(selection, deltaMs);
      setStatus(`已整体移动 ${selection.length} 条对白。`);
    } catch (error) {
      setStatus(messageOf(error));
    }
  };

  return (
    <section
      aria-label="批量调整"
      className="batch-adjust"
      data-testid="batch-adjust-panel"
    >
      <p className="batch-adjust-shot" data-testid="batch-adjust-shot">
        {shot ? shot.name : '未选择镜头'}
      </p>
      {candidates.length === 0 ? (
        <p className="batch-adjust-empty">
          当前镜头还没有已定时的对白，先去时间轴安排对白时长。
        </p>
      ) : (
        <>
          <ul className="batch-adjust-list">
            {candidates.map((candidate) => {
              const checked = selectedIds.includes(candidate.dialogueId);
              const next = preview?.ok
                ? preview.plan.entries.find(
                    (entry) => entry.dialogueId === candidate.dialogueId,
                  )
                : undefined;
              return (
                <li key={candidate.dialogueId}>
                  <label
                    className="batch-adjust-row"
                    data-has-audio={candidate.hasAudio ? 'true' : 'false'}
                  >
                    <input
                      checked={checked}
                      className="batch-adjust-check"
                      onChange={() => toggle(candidate.dialogueId)}
                      type="checkbox"
                    />
                    <span className="batch-adjust-name">{candidate.label}</span>
                    <span className="batch-adjust-time">
                      {formatSeconds(candidate.startMs)} →{' '}
                      {formatSeconds(candidate.endMs)}
                    </span>
                    {next ? (
                      <span className="batch-adjust-next">
                        移到 {formatSeconds(next.startMs)}
                      </span>
                    ) : null}
                    {candidate.hasAudio ? (
                      <DecorativeIcon
                        className="batch-adjust-audio"
                        icon={AudioLines}
                        size={14}
                      />
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
          <button
            className="batch-adjust-select-all"
            data-testid="batch-adjust-select-all"
            onClick={() => {
              setStatus('');
              setSelectedIds(
                selection.length === candidates.length
                  ? []
                  : candidates.map((candidate) => candidate.dialogueId),
              );
            }}
            type="button"
          >
            {selection.length === candidates.length
              ? '取消全选'
              : '全选本镜头对白'}
          </button>

          <label className="batch-adjust-delta" htmlFor="batch-adjust-delta">
            <span>移动</span>
            <input
              className="batch-adjust-delta-input"
              data-testid="batch-adjust-delta"
              id="batch-adjust-delta"
              inputMode="decimal"
              onChange={(event) => {
                setStatus('');
                setDeltaInput(event.target.value);
              }}
              type="text"
              value={deltaInput}
            />
            <span>秒</span>
          </label>

          <p className="batch-adjust-summary" data-testid="batch-adjust-impact">
            影响：{selection.length} 条对白 · {preview?.ok ? preview.plan.audioClipCount : 0} 段配音
          </p>
          <p className="batch-adjust-summary" data-testid="batch-adjust-range">
            结果：
            {preview?.ok
              ? `最早 ${formatSeconds(preview.plan.earliestStartMs)} · 最晚 ${formatSeconds(preview.plan.latestEndMs)}`
              : '等待合法的移动量'}
          </p>

          {blockedMessage ? (
            <p
              className="batch-adjust-blocked"
              data-testid="batch-adjust-blocked"
              role="alert"
            >
              {blockedMessage}
            </p>
          ) : null}

          <Button
            className="batch-adjust-apply"
            data-testid="batch-adjust-apply"
            disabled={!canApply}
            onClick={apply}
            variant="primary"
          >
            <DecorativeIcon icon={Users} size={16} />
            <span>应用移动</span>
          </Button>
          {status ? (
            <p className="batch-adjust-status" role="status">
              {status}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
