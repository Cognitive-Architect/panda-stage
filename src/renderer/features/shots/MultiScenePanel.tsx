import { AlertCircle, Check } from 'lucide-react';
import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  inspectMultiScene,
  parseMultiSceneInput,
  MultiSceneInputError,
  type MultiSceneBlock,
  type MultiSceneReport,
  type MultiSceneSelections,
  type MultiSceneSlotSelection,
  type SceneSlotResolution,
} from '../../../domain';
import {
  editorProjectStore,
  type EditorProjectSnapshot,
  type EditorProjectStore,
} from '../../stores/EditorProjectStore';
import {
  shotStore as defaultShotStore,
  type ShotStore,
} from '../../stores/shotStore';
import { ShotThumbnail } from './ShotThumbnailView';
import {
  commitMultiScenePreview,
  prepareMultiScenePreview,
  MultiSceneActionError,
  type MultiScenePreview,
} from './multiScenePlan';

export interface MultiScenePanelProps {
  /** Injected in tests; the panel defaults to the open editor Project. */
  snapshot?: EditorProjectSnapshot | null;
  editorStore?: Pick<
    EditorProjectStore,
    'getSnapshot' | 'subscribe' | 'getProjectInstanceId' | 'updateProject'
  >;
  shotStore?: Pick<ShotStore, 'getCurrentShotId' | 'select'>;
}

const SLOT_LABELS = {
  background: '背景',
  'left-character': '左角色',
  'right-character': '右角色',
} as const;

type SlotKey = keyof typeof SLOT_LABELS;

const SLOT_KEYS: readonly SlotKey[] = [
  'background',
  'left-character',
  'right-character',
];

const INPUT_PLACEHOLDER = [
  '镜头：花园相遇',
  '背景：花园',
  '出场：张三、李四',
  '站位：双人对话',
  '---',
  '镜头：宗门大厅',
  '背景：宗门大厅',
  '出场：张三、大长老',
  '站位：双人对话',
].join('\n');

function slotOf(
  block: MultiSceneReport['blocks'][number],
  slot: SlotKey,
): SceneSlotResolution {
  if (slot === 'background') return block.background;
  return slot === 'left-character' ? block.left : block.right;
}

function selectionField(slot: SlotKey): keyof MultiSceneSlotSelection {
  if (slot === 'background') return 'backgroundAssetId';
  return slot === 'left-character' ? 'leftCharacterId' : 'rightCharacterId';
}

/**
 * AUTO-04 keeps the batch surface flat: one row per mirror block, one row per
 * slot, a picker only where a name is ambiguous, and the refusal said in place.
 */
export function MultiScenePanel({
  snapshot: snapshotProp,
  editorStore = editorProjectStore,
  shotStore = defaultShotStore,
}: MultiScenePanelProps): React.JSX.Element {
  const subscribedSnapshot = useSyncExternalStore(
    editorStore.subscribe,
    editorStore.getSnapshot,
    editorStore.getSnapshot,
  );
  const snapshot =
    snapshotProp !== undefined ? snapshotProp : subscribedSnapshot;

  const [rawInput, setRawInput] = useState('');
  const [blocks, setBlocks] = useState<readonly MultiSceneBlock[]>([]);
  const [selections, setSelections] = useState<MultiSceneSelections>([]);
  const [report, setReport] = useState<MultiSceneReport | null>(null);
  const [preview, setPreview] = useState<MultiScenePreview | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [status, setStatus] = useState('');

  const previewShots = useMemo(() => preview?.plan.shots ?? [], [preview]);
  const plannedCount = preview?.plan.createdShotIds.length ?? blocks.length;
  const generateLabel =
    plannedCount > 0 ? `生成 ${plannedCount} 个镜头` : '生成镜头';
  const activePreview = previewShots[previewIndex] ?? null;
  const activeShot = activePreview
    ? preview?.plan.candidateProject.shots.find(
        (shot) => shot.id === activePreview.shotId,
      ) ?? null
    : null;

  const applyBatch = (
    nextBlocks: readonly MultiSceneBlock[],
    nextSelections: MultiSceneSelections,
  ): void => {
    if (!snapshot) return;
    const nextReport = inspectMultiScene(
      snapshot.project,
      nextBlocks,
      nextSelections,
    );
    setReport(nextReport);
    if (!nextReport.ready) {
      setPreview(null);
      setStatus('');
      return;
    }
    try {
      const outcome = prepareMultiScenePreview(nextBlocks, nextSelections, {
        editorStore: editorStore as EditorProjectStore,
        shotStore,
      });
      if (!outcome.ok) {
        setPreview(null);
        setStatus(outcome.message);
        return;
      }
      setPreview(outcome.preview);
      setPreviewIndex(0);
      setStatus('');
    } catch (error) {
      setPreview(null);
      setStatus(
        error instanceof MultiSceneActionError
          ? error.message
          : '检查这批镜头时出错了，请重试。',
      );
    }
  };

  const handleCheck = (): void => {
    try {
      const nextBlocks = parseMultiSceneInput(rawInput);
      setBlocks(nextBlocks);
      setSelections([]);
      applyBatch(nextBlocks, []);
    } catch (error) {
      setBlocks([]);
      setSelections([]);
      setReport(null);
      setPreview(null);
      setStatus(
        error instanceof MultiSceneInputError
          ? error.message
          : '这批分镜无法解析，请检查格式。',
      );
    }
  };

  const handleSelect = (
    blockOffset: number,
    slot: SlotKey,
    value: string,
  ): void => {
    const nextSelections = Array.from(
      { length: blocks.length },
      (_, index) => ({ ...selections[index] }),
    ) as MultiSceneSlotSelection[];
    const target = nextSelections[blockOffset] ?? {};
    nextSelections[blockOffset] = {
      ...target,
      [selectionField(slot)]: value || null,
    };
    setSelections(nextSelections);
    applyBatch(blocks, nextSelections);
  };

  const handleGenerate = (): void => {
    if (!preview) return;
    try {
      const committed = commitMultiScenePreview(preview, {
        editorStore: editorStore as EditorProjectStore,
        shotStore,
      });
      setPreview(null);
      setStatus(`已生成 ${committed.createdShotIds.length} 个镜头。`);
    } catch (error) {
      setPreview(null);
      setStatus(
        error instanceof MultiSceneActionError
          ? error.message
          : '生成这批镜头失败了，工程没有变化。',
      );
    }
  };

  return (
    <section
      aria-label="多镜头布景"
      className="multi-scene-panel"
      data-testid="multi-scene-panel"
      data-multi-scene-ready={report?.ready ? 'true' : 'false'}
    >
      {!snapshot ? (
        <p className="multi-scene-empty" data-testid="multi-scene-no-project">
          请先打开工程。
        </p>
      ) : (
        <div className="multi-scene-body">
          <label className="multi-scene-input-field">
            <span>分镜</span>
            <textarea
              className="multi-scene-input"
              data-testid="multi-scene-input"
              onChange={(event) => setRawInput(event.target.value)}
              placeholder={INPUT_PLACEHOLDER}
              rows={10}
              spellCheck={false}
              value={rawInput}
            />
          </label>

          <button
            className="multi-scene-check"
            data-testid="multi-scene-check"
            disabled={rawInput.trim().length === 0}
            onClick={handleCheck}
            type="button"
          >
            检查素材
          </button>

          {report ? (
            <div className="multi-scene-report" data-testid="multi-scene-report">
              {report.blocks.map((block) => (
                <div
                  className="multi-scene-shot"
                  data-multi-scene-block={block.index}
                  data-multi-scene-shot-ready={block.ready ? 'true' : 'false'}
                  key={block.index}
                >
                  <div className="multi-scene-shot-heading">
                    <span className="multi-scene-shot-index">
                      镜头 {block.index}
                    </span>
                    <span className="multi-scene-shot-name">
                      {block.shotName}
                    </span>
                    <span
                      aria-hidden="true"
                      className="multi-scene-mark"
                      data-multi-scene-mark={block.ready ? 'ok' : 'blocked'}
                    >
                      {block.ready ? (
                        <Check className="ui-icon" size={16} />
                      ) : (
                        <AlertCircle className="ui-icon" size={16} />
                      )}
                    </span>
                  </div>
                  {SLOT_KEYS.map((slot) => {
                    const resolution = slotOf(block, slot);
                    const testId = `multi-scene-slot-${block.index}-${slot}`;
                    return (
                      <div
                        className="multi-scene-slot"
                        data-multi-scene-slot={slot}
                        data-multi-scene-slot-status={resolution.status}
                        data-testid={testId}
                        key={slot}
                      >
                        <span className="multi-scene-slot-label">
                          {SLOT_LABELS[slot]}
                        </span>
                        {resolution.status === 'ambiguous' ? (
                          <select
                            aria-label={`镜头 ${block.index} ${SLOT_LABELS[slot]}候选`}
                            className="multi-scene-slot-picker"
                            data-testid={`${testId}-picker`}
                            onChange={(event) =>
                              handleSelect(
                                block.index - 1,
                                slot,
                                event.target.value,
                              )
                            }
                            value={resolution.selectedId ?? ''}
                          >
                            <option value="">请选择</option>
                            {resolution.choices.map((choice) => (
                              <option
                                disabled={!choice.selectable}
                                key={choice.id}
                                value={choice.id}
                              >
                                {choice.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="multi-scene-slot-value">
                            {resolution.requestedName}
                          </span>
                        )}
                        <span
                          aria-hidden="true"
                          className="multi-scene-mark"
                          data-multi-scene-mark={
                            resolution.status === 'ready' ? 'ok' : 'blocked'
                          }
                        >
                          {resolution.status === 'ready' ? (
                            <Check className="ui-icon" size={16} />
                          ) : (
                            <AlertCircle className="ui-icon" size={16} />
                          )}
                        </span>
                        {resolution.message ? (
                          <p className="multi-scene-slot-message">
                            {resolution.message}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : null}

          {preview && activeShot ? (
            <div className="multi-scene-preview" data-testid="multi-scene-preview">
              <div
                aria-label="预览镜头"
                className="multi-scene-preview-tabs"
                role="group"
              >
                {previewShots.map((shot, index) => (
                  <button
                    aria-pressed={index === previewIndex}
                    className="multi-scene-preview-tab"
                    data-testid={`multi-scene-preview-${shot.index}`}
                    key={shot.shotId}
                    onClick={() => setPreviewIndex(index)}
                    type="button"
                  >
                    {shot.index}
                  </button>
                ))}
              </div>
              <ShotThumbnail
                index={previewIndex}
                name={activePreview?.shotName ?? ''}
                project={preview.plan.candidateProject}
                projectRoot={snapshot.projectRoot}
                shot={activeShot}
              />
            </div>
          ) : null}

          <button
            className="multi-scene-generate"
            data-testid="multi-scene-generate"
            disabled={!preview}
            onClick={handleGenerate}
            type="button"
          >
            {generateLabel}
          </button>

          {status ? (
            <p
              className="multi-scene-status"
              data-testid="multi-scene-status"
              role="status"
            >
              {status}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
