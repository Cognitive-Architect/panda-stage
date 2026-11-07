import { AlertCircle, Check } from 'lucide-react';
import { useSyncExternalStore, useState } from 'react';
import {
  MultiSceneInputError,
  parseMultiSceneInput,
  resolveAudioMatches,
  resolveBackgroundSlot,
  resolveSpeakerBindings,
  collectSpeakerLabels,
  assetFileName,
  formatDurationMs,
  MULTI_SCENE_SHOT_DURATION_MS,
  type AudioMatchRow,
  type MultiSceneBlock,
  type MultiSceneSlotSelection,
} from '../../../domain';
import { MultiSceneDialogueService } from '../../../domain';
import {
  editorProjectStore,
  type EditorProjectSnapshot,
  type EditorProjectStore,
} from '../../stores/EditorProjectStore';
import {
  shotStore as defaultShotStore,
  type ShotStore,
} from '../../stores/shotStore';
import {
  commitMultiSceneDialoguePreview,
  prepareMultiSceneDialoguePreview,
} from './multiSceneDialoguePlan';
import { MultiSceneActionError } from './multiScenePlan';
import {
  EMPTY_MULTI_SCENE_DIALOGUE_BATCH,
  audioPicked,
  backgroundPicked,
  batchUpdated,
  checkApplied,
  choiceLabel,
  initialPanelState,
  inputChanged,
  speakerPicked,
  submissionBatch,
  type MultiSceneDialogueBatch,
  type MultiSceneDialoguePanelState,
} from './multiSceneDialoguePanelModel';

export interface MultiSceneDialoguePanelProps {
  /** Injected in tests; the panel defaults to the open editor Project. */
  snapshot?: EditorProjectSnapshot | null;
  editorStore?: Pick<
    EditorProjectStore,
    'getSnapshot' | 'subscribe' | 'getProjectInstanceId' | 'updateProject'
  >;
  shotStore?: Pick<ShotStore, 'getCurrentShotId' | 'select'>;
}

const INPUT_PLACEHOLDER = [
  '镜头：花园相遇',
  '背景：花园',
  '出场：张三、李四',
  '站位：双人对话',
  '对白：',
  '张三：你怎么来了？',
  '李四：我来找你。',
  '---',
  '镜头：宗门大厅',
  '背景：宗门大厅',
  '出场：张三、大长老',
  '站位：双人对话',
  '对白：',
  '大长老：你可知错？',
  '张三：弟子知错。',
].join('\n');

function rowsForBlock(
  rows: readonly AudioMatchRow[],
  block: MultiSceneBlock,
): AudioMatchRow[] {
  const first = block.dialogues[0]?.ordinal ?? -1;
  const last = block.dialogues.at(-1)?.ordinal ?? -1;
  return rows.filter((row) => row.ordinal >= first && row.ordinal <= last);
}

/**
 * AUTO-05 keeps the AUTO-04 flat batch surface: one group per Shot, one row per
 * dialogue, a picker only where a name or an audio file is unproven, and the
 * refusal written on the row it belongs to. One primary button at the bottom.
 */
export function MultiSceneDialoguePanel({
  snapshot: snapshotProp,
  editorStore = editorProjectStore,
  shotStore = defaultShotStore,
}: MultiSceneDialoguePanelProps): React.JSX.Element {
  const subscribed = useSyncExternalStore(
    editorStore.subscribe,
    editorStore.getSnapshot,
    editorStore.getSnapshot,
  );
  const snapshot = snapshotProp !== undefined ? snapshotProp : subscribed;
  const [state, setState] = useState<MultiSceneDialoguePanelState>(
    initialPanelState,
  );
  const { rawInput, batch } = state;
  const submittable = submissionBatch(state) !== null;
  const count = batch.preview?.plan.createdShotIds.length ?? batch.blocks.length;
  const generateLabel =
    count > 0 ? `生成 ${count} 个镜头与对白` : '生成镜头与对白';

  /** Resolve one batch in memory; nothing here writes the Project. */
  const buildBatch = (current: MultiSceneDialogueBatch): MultiSceneDialogueBatch => {
    if (!snapshot || current.blocks.length === 0) {
      return { ...EMPTY_MULTI_SCENE_DIALOGUE_BATCH, blocks: current.blocks };
    }
    const project = snapshot.project;
    const labels = collectSpeakerLabels(current.blocks);
    const bindings = resolveSpeakerBindings(
      project,
      labels,
      current.speakerBindings,
    );
    const characterName = (characterId: string): string =>
      project.characters.find((character) => character.id === characterId)?.name ??
      '';
    const audio = resolveAudioMatches(
      project,
      current.blocks.flatMap((block) =>
        block.dialogues.map((line) => ({
          ordinal: line.ordinal,
          characterName: characterName(
            bindings.bindings[line.speaker] ?? '',
          ),
        })),
      ),
      current.audioSelections,
    );
    const refused: MultiSceneDialogueBatch = {
      ...current,
      rows: audio.rows,
      unresolvedSpeakers: bindings.unresolved,
      preview: null,
      status: '',
    };
    if (!bindings.ready) {
      return {
        ...refused,
        status: `请先确认角色：${bindings.unresolved.join('、')}。`,
      };
    }
    if (!audio.ready) {
      return {
        ...refused,
        status: '配音未全部匹配，完整批次不可生成（本轮不生成草稿）。',
      };
    }
    try {
      const outcome = prepareMultiSceneDialoguePreview(
        current.blocks,
        current.selections,
        {
          editorStore: editorStore as EditorProjectStore,
          shotStore,
          service: new MultiSceneDialogueService({
            speakerBindings: current.speakerBindings,
            audioSelections: current.audioSelections,
          }),
        },
      );
      if (!outcome.ok) return { ...refused, status: outcome.message };
      return { ...refused, preview: outcome.preview };
    } catch (error) {
      return {
        ...refused,
        status:
          error instanceof MultiSceneActionError
            ? error.message
            : '检查这批镜头时出错了，请重试。',
      };
    }
  };

  const handleInput = (value: string): void => setState(inputChanged(value));

  const handleCheck = (): void => {
    try {
      const blocks = parseMultiSceneInput(rawInput);
      setState(
        checkApplied(
          rawInput,
          buildBatch({ ...EMPTY_MULTI_SCENE_DIALOGUE_BATCH, blocks }),
        ),
      );
    } catch (error) {
      setState(
        checkApplied(rawInput, {
          ...EMPTY_MULTI_SCENE_DIALOGUE_BATCH,
          status:
            error instanceof MultiSceneInputError
              ? error.message
              : '这批分镜无法解析，请检查格式。',
        }),
      );
    }
  };

  /** Every pick recomputes the batch under the same checked text. */
  const recompute = (next: MultiSceneDialoguePanelState): void => {
    setState(checkApplied(next.rawInput, buildBatch(next.batch)));
  };

  const handleGenerate = (): void => {
    const pending = submissionBatch(state);
    if (!pending?.preview) return;
    try {
      const committed = commitMultiSceneDialoguePreview(pending.preview, {
        editorStore: editorStore as EditorProjectStore,
        shotStore,
        service: new MultiSceneDialogueService({
          speakerBindings: pending.speakerBindings,
          audioSelections: pending.audioSelections,
        }),
      });
      setState(
        batchUpdated(state, {
          ...batch,
          preview: null,
          status: `已生成 ${committed.createdShotIds.length} 个镜头与对白。`,
        }),
      );
    } catch (error) {
      setState(
        batchUpdated(state, {
          ...batch,
          preview: null,
          status:
            error instanceof MultiSceneActionError
              ? error.message
              : '生成失败了，工程没有变化。',
        }),
      );
    }
  };

  const audioAssets = snapshot
    ? snapshot.project.assets.filter((asset) => asset.kind === 'audio')
    : [];

  return (
    <section
      aria-label="多镜头对白"
      className="multi-scene-dialogue-panel"
      data-testid="multi-scene-dialogue-panel"
      data-multi-scene-dialogue-ready={batch.preview ? 'true' : 'false'}
    >
      {!snapshot ? (
        <p
          className="multi-scene-dialogue-empty"
          data-testid="multi-scene-dialogue-no-project"
        >
          请先打开工程。
        </p>
      ) : (
        <div className="multi-scene-dialogue-body">
          <label className="multi-scene-dialogue-input-field">
            <span>分镜与对白</span>
            <textarea
              className="multi-scene-dialogue-input"
              data-testid="multi-scene-dialogue-input"
              onChange={(event) => handleInput(event.target.value)}
              placeholder={INPUT_PLACEHOLDER}
              rows={12}
              spellCheck={false}
              value={rawInput}
            />
          </label>

          <button
            className="multi-scene-dialogue-check"
            data-testid="multi-scene-dialogue-check"
            disabled={rawInput.trim().length === 0}
            onClick={handleCheck}
            type="button"
          >
            检查素材与配音
          </button>

          {batch.unresolvedSpeakers.length > 0 ? (
            <div
              className="multi-scene-dialogue-bindings"
              data-testid="multi-scene-dialogue-bindings"
            >
              {batch.unresolvedSpeakers.map((label) => (
                <label
                  className="multi-scene-dialogue-binding"
                  key={label}
                >
                  <span>{label}</span>
                  <select
                    aria-label={`确认角色 ${label}`}
                    data-testid={`multi-scene-dialogue-binding-${label}`}
                    onChange={(event) =>
                      recompute(
                        speakerPicked(state, label, event.target.value),
                      )
                    }
                    value={batch.speakerBindings[label] ?? ''}
                  >
                    <option value="">请选择角色</option>
                    {snapshot.project.characters.map((character) => (
                      <option key={character.id} value={character.id}>
                        {character.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          ) : null}

          {batch.blocks.length > 0 ? (
            <div
              className="multi-scene-dialogue-report"
              data-testid="multi-scene-dialogue-report"
            >
              {batch.blocks.map((block, blockOffset) => {
                const timing = batch.preview?.plan.dialogue.timings[blockOffset];
                const background = resolveBackgroundSlot(
                  snapshot.project,
                  block.backgroundName,
                  (batch.selections[blockOffset] as
                    | MultiSceneSlotSelection
                    | undefined)?.backgroundAssetId ?? null,
                ).resolution;
                return (
                  <div
                    className="multi-scene-dialogue-shot"
                    data-multi-scene-dialogue-block={block.index}
                    key={block.index}
                  >
                    <div className="multi-scene-dialogue-shot-heading">
                      <span>镜头 {block.index}</span>
                      <span>{block.shotName}</span>
                    </div>

                    {background.status === 'ambiguous' ||
                    (background.status === 'missing' &&
                      background.choices.length > 0) ? (
                      <label className="multi-scene-dialogue-background-picker">
                        <span>背景</span>
                        <select
                          aria-label={`镜头 ${block.index} 背景候选`}
                          data-testid={`multi-scene-dialogue-background-${block.index}`}
                          onChange={(event) =>
                            recompute(
                              backgroundPicked(
                                state,
                                blockOffset,
                                event.target.value,
                              ),
                            )
                          }
                          value={background.selectedId ?? ''}
                        >
                          <option value="">请选择</option>
                          {background.choices.map((choice, index) => (
                            <option
                              disabled={!choice.selectable}
                              key={choice.id}
                              value={choice.id}
                            >
                              {choiceLabel(
                                choice,
                                index,
                                background.choices.length,
                              )}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}

                    {block.dialogues.map((line, lineOffset) => {
                      const row = rowsForBlock(batch.rows, block)[lineOffset];
                      const ready = Boolean(row && row.issue === null);
                      return (
                        <div
                          className="multi-scene-dialogue-line"
                          data-multi-scene-dialogue-ordinal={line.ordinal}
                          data-multi-scene-dialogue-line-ready={
                            ready ? 'true' : 'false'
                          }
                          key={line.ordinal}
                        >
                          <span className="multi-scene-dialogue-speaker">
                            {line.speaker}
                          </span>
                          <span className="multi-scene-dialogue-text">
                            {line.text}
                          </span>
                          {row?.fileName ? (
                            <span className="multi-scene-dialogue-audio">
                              {row.fileName}
                              {ready && row.durationMs !== null
                                ? ` ${formatDurationMs(row.durationMs)}`
                                : ''}
                            </span>
                          ) : null}
                          <span
                            aria-hidden="true"
                            className="multi-scene-dialogue-mark"
                            data-multi-scene-dialogue-mark={
                              ready ? 'ok' : 'blocked'
                            }
                          >
                            {ready ? (
                              <Check className="ui-icon" size={16} />
                            ) : (
                              <AlertCircle className="ui-icon" size={16} />
                            )}
                          </span>
                          {!ready ? (
                            <select
                              aria-label={`第 ${line.ordinal} 句配音`}
                              className="multi-scene-dialogue-audio-picker"
                              data-testid={`multi-scene-dialogue-audio-${line.ordinal}`}
                              onChange={(event) =>
                                recompute(
                                  audioPicked(
                                    state,
                                    line.ordinal,
                                    event.target.value,
                                  ),
                                )
                              }
                              value=""
                            >
                              <option value="">请选择配音</option>
                              {audioAssets.map((asset) => (
                                <option key={asset.id} value={asset.id}>
                                  {assetFileName(asset)}
                                </option>
                              ))}
                            </select>
                          ) : null}
                          {row?.message ? (
                            <p className="multi-scene-dialogue-line-message">
                              {row.message}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}

                    <div className="multi-scene-dialogue-duration">
                      {`镜头时长 ${formatDurationMs(MULTI_SCENE_SHOT_DURATION_MS)} → ${formatDurationMs(timing?.nextDurationMs ?? MULTI_SCENE_SHOT_DURATION_MS)}`}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          <button
            className="multi-scene-dialogue-generate"
            data-testid="multi-scene-dialogue-generate"
            disabled={!submittable}
            onClick={handleGenerate}
            type="button"
          >
            {generateLabel}
          </button>

          {batch.status ? (
            <p
              className="multi-scene-dialogue-status"
              data-testid="multi-scene-dialogue-status"
              role="status"
            >
              {batch.status}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
