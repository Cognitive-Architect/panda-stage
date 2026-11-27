import { useEffect, useMemo, useRef, useState } from 'react';
import {
  applyScriptPerformancePlan,
  isAudioAssetReady,
  isScriptPerformancePlanStale,
  listUsableBackgroundCandidates,
  listUsableCharacterCandidates,
  listUsablePropCandidates,
  planScriptPerformance,
  type AudioAsset,
  type PlannedScriptDialogueRow,
  type Project,
  type SceneBackgroundRef,
  type ScenePlanOverrides,
  type ScenePropRef,
  type ScriptDialogueAudioOverride,
  type ScriptPerformanceBlockSummary,
  type ScriptPerformancePlan,
  type StableDialogueDraftRow,
} from '../../../domain';
import {
  editorProjectStore,
  type EditorProjectSnapshot,
} from '../../stores/EditorProjectStore';
import { scenePreviewStore } from '../../stores/scenePreviewStore';
import { shotStore } from '../../stores/shotStore';

export interface AutoScenePanelProps {
  snapshot: EditorProjectSnapshot | null;
  onBack: () => void;
}

function buildExampleTemplate(project: Project | null): string {
  const bg = project
    ? listUsableBackgroundCandidates(project).find((c) => c.usable)?.name
    : undefined;
  const chars = project
    ? listUsableCharacterCandidates(project)
        .filter((c) => c.usable)
        .map((c) => c.name)
    : [];
  const bgLine = bg ? `背景：${bg}` : '背景：无';
  const cast1 = chars[0] ? `出场：${chars[0]}` : '出场：无';
  const cast2 =
    chars.length >= 2
      ? `出场：${chars[0]}、${chars[1]}\n站位：双人对话`
      : chars[0]
        ? `出场：${chars[0]}\n站位：居中`
        : '出场：无';

  return [
    '镜头：开场空镜',
    bgLine,
    cast1,
    '时长：3s',
    '---',
    '镜头：对话镜头',
    bgLine,
    cast2,
    '时长：4s',
  ].join('\n');
}

function buildScriptPerformanceExample(project: Project | null): string {
  const bg = project
    ? listUsableBackgroundCandidates(project).find((c) => c.usable)?.name
    : undefined;
  const chars = project
    ? listUsableCharacterCandidates(project)
        .filter((c) => c.usable)
        .map((c) => c.name)
    : [];
  const c1 = chars[0] ?? '师兄';
  const c2 = chars[1] ?? c1;
  const bgLine = bg ? `背景：${bg}` : '背景：无';
  const castLine = chars.length >= 2 ? `出场：${c1}、${c2}\n站位：双人对话` : `出场：${c1}\n站位：居中`;

  return [
    '镜头：第一幕',
    bgLine,
    castLine,
    '对白：',
    `${c1}：听我解释。`,
    `${c2}：你又偷懒了！`,
    '表演：',
    '1｜左入场',
    '2｜抖动',
    '---',
    '镜头：第二幕',
    bgLine,
    castLine,
    '对白：',
    `${c2}：快去修炼。`,
    `${c1}：知道了。`,
    '表演：',
    '3｜淡入',
    '4｜移动｜x=1260｜y=760',
  ].join('\n');
}

function encodeBackgroundRef(ref: SceneBackgroundRef): string {
  if (ref.kind === 'empty') return 'empty';
  if (ref.kind === 'image') return `image:${ref.assetId}`;
  return `graphic:${ref.animationId}`;
}

function decodeBackgroundRef(value: string): SceneBackgroundRef {
  if (value === 'empty') return { kind: 'empty' };
  if (value.startsWith('image:')) {
    return { kind: 'image', assetId: value.slice('image:'.length) };
  }
  if (value.startsWith('graphic:')) {
    return { kind: 'graphic', animationId: value.slice('graphic:'.length) };
  }
  return { kind: 'empty' };
}

function encodePropRef(ref: ScenePropRef | null): string {
  if (!ref) return 'skip';
  if (ref.kind === 'image') return `image:${ref.assetId}`;
  return `animation:${ref.animationId}`;
}

function decodePropRef(value: string): ScenePropRef | 'skip' {
  if (value === 'skip') return 'skip';
  if (value.startsWith('image:')) {
    return { kind: 'image', assetId: value.slice('image:'.length) };
  }
  if (value.startsWith('animation:')) {
    return { kind: 'animation', animationId: value.slice('animation:'.length) };
  }
  return 'skip';
}

export function AutoScenePanel({
  snapshot,
  onBack,
}: AutoScenePanelProps): React.JSX.Element {
  const project = snapshot?.project ?? null;
  const [rawInput, setRawInput] = useState('');
  const [sceneOverrides, setSceneOverrides] = useState<ScenePlanOverrides>({});
  const [audioOverrides, setAudioOverrides] = useState<
    Readonly<Record<string, ScriptDialogueAudioOverride>>
  >({});
  const [excludedDirectiveIds, setExcludedDirectiveIds] = useState<readonly string[]>([]);
  const [extendShotForPerformance, setExtendShotForPerformance] = useState(false);
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState<number | null>(
    null,
  );
  const [pinnedEntry, setPinnedEntry] = useState<{
    readonly key: string;
    readonly plan: ScriptPerformancePlan | null;
  } | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const previousDialogueRowsRef = useRef<readonly StableDialogueDraftRow[]>([]);

  const inputKey = useMemo(
    () =>
      `${refreshNonce}::${extendShotForPerformance ? '1' : '0'}::${rawInput}::${JSON.stringify(sceneOverrides)}::${JSON.stringify(audioOverrides)}::${JSON.stringify(excludedDirectiveIds)}`,
    [
      audioOverrides,
      excludedDirectiveIds,
      extendShotForPerformance,
      rawInput,
      refreshNonce,
      sceneOverrides,
    ],
  );

  // Plan once per inputKey, pinning the plan to the project snapshot that
  // generated it so external project/reference mutations trigger stale-plan guard.
  const activePlan: ScriptPerformancePlan | null = useMemo(() => {
    if (!project || !rawInput.trim()) {
      return null;
    }
    if (pinnedEntry && pinnedEntry.key === inputKey) {
      return pinnedEntry.plan;
    }
    return planScriptPerformance(project, rawInput, {
      previousDialogueRows: previousDialogueRowsRef.current,
      overrides: {
        scene: sceneOverrides,
        audioByDraftRowId: audioOverrides,
        excludedDirectiveIds,
      },
      extendShotForPerformance,
    });
  }, [
    audioOverrides,
    excludedDirectiveIds,
    extendShotForPerformance,
    inputKey,
    pinnedEntry,
    project,
    rawInput,
    sceneOverrides,
  ]);

  useEffect(() => {
    if (!project || !rawInput.trim()) {
      previousDialogueRowsRef.current = [];
      if (pinnedEntry !== null) setPinnedEntry(null);
      return;
    }
    if (activePlan) {
      previousDialogueRowsRef.current = activePlan.dialogueDraftRows;
    }
    if (pinnedEntry?.key !== inputKey) {
      setPinnedEntry({
        key: inputKey,
        plan: activePlan,
      });
    }
  }, [activePlan, inputKey, pinnedEntry, project, rawInput]);

  const staleCheck = useMemo(() => {
    if (!project || !activePlan) return { stale: false };
    return isScriptPerformancePlanStale(project, activePlan);
  }, [activePlan, project]);

  const handleInputChange = (nextText: string): void => {
    setRawInput(nextText);
    setErrorMessage('');
  };

  const updateBlockOverride = (
    blockIndex: number,
    updater: (
      current: ScenePlanOverrides[number] | undefined,
    ) => ScenePlanOverrides[number],
  ): void => {
    setErrorMessage('');
    setSceneOverrides((current) => ({
      ...current,
      [blockIndex]: updater(current[blockIndex]),
    }));
  };

  const updateAudioOverride = (
    draftRowId: string,
    audioAssetId: string | null,
  ): void => {
    setErrorMessage('');
    setAudioOverrides((current) => ({
      ...current,
      [draftRowId]: { audioAssetId },
    }));
  };

  const toggleDirectiveExcluded = (directiveId: string): void => {
    setErrorMessage('');
    setExcludedDirectiveIds((current) =>
      current.includes(directiveId)
        ? current.filter((id) => id !== directiveId)
        : [...current, directiveId],
    );
  };

  const usableBackgrounds = useMemo(
    () => (project ? listUsableBackgroundCandidates(project).filter((c) => c.usable) : []),
    [project],
  );
  const usableCharacters = useMemo(
    () => (project ? listUsableCharacterCandidates(project).filter((c) => c.usable) : []),
    [project],
  );
  const usableProps = useMemo(
    () => (project ? listUsablePropCandidates(project).filter((c) => c.usable) : []),
    [project],
  );
  const readyAudioAssets = useMemo(
    () =>
      project
        ? project.assets.filter(
            (asset): asset is AudioAsset =>
              asset.kind === 'audio' && isAudioAssetReady(asset),
          )
        : [],
    [project],
  );

  const applicableBlocks = useMemo(
    () =>
      activePlan?.blocks.filter((b) => b.scene.applicable && b.scene.createdShotId) ??
      [],
    [activePlan],
  );

  const effectivePreviewBlock: ScriptPerformanceBlockSummary | null = useMemo(() => {
    if (applicableBlocks.length === 0) return null;
    if (selectedPreviewIndex !== null) {
      const matched = applicableBlocks.find(
        (b) => b.scene.blockIndex === selectedPreviewIndex,
      );
      if (matched) return matched;
    }
    return applicableBlocks[0] ?? null;
  }, [applicableBlocks, selectedPreviewIndex]);

  // Sync read-only preview to the main canvas without mutating EditorProjectStore.
  useEffect(() => {
    if (
      !activePlan ||
      !activePlan.candidateProject ||
      !effectivePreviewBlock?.scene.createdShotId ||
      staleCheck.stale
    ) {
      scenePreviewStore.clear();
      return;
    }
    const shotIndex = applicableBlocks.findIndex(
      (b) => b.scene.blockIndex === effectivePreviewBlock.scene.blockIndex,
    );
    scenePreviewStore.setPreview({
      previewProject: activePlan.candidateProject,
      previewShotId: effectivePreviewBlock.scene.createdShotId,
      previewShotName: effectivePreviewBlock.scene.shotName,
      shotIndex: Math.max(0, shotIndex),
      shotCount: applicableBlocks.length,
    });
  }, [activePlan, applicableBlocks, effectivePreviewBlock, staleCheck.stale]);

  // Always clear preview on unmount.
  useEffect(() => {
    return () => {
      scenePreviewStore.clear();
    };
  }, []);

  const handleCancel = (): void => {
    scenePreviewStore.clear();
    onBack();
  };

  const handleConfirm = (): void => {
    const currentSnapshot = editorProjectStore.getSnapshot();
    if (!currentSnapshot || !activePlan) return;
    const result = applyScriptPerformancePlan(currentSnapshot.project, activePlan, {
      allowPartialConfirm: true,
    });
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    scenePreviewStore.clear();
    const isScriptMode = activePlan.parsed.hasDialogueOrPerformance;
    const label = isScriptMode
      ? `剧本表演生成（${result.createdShotIds.length} 镜头 / ${result.scheduledDialogueCount} 对白 / ${result.readyPerformanceCount} 动作）`
      : result.createdShotIds.length > 1
        ? `自动布景（${result.createdShotIds.length} 个镜头）`
        : `自动布景：${result.blocks.find((b) => b.scene.applicable)?.scene.shotName ?? '新镜头'}`;
    editorProjectStore.updateProject(result.project, label);
    shotStore.select(result.firstShotId);
    onBack();
  };

  const handleRefreshStale = (): void => {
    setPinnedEntry(null);
    setRefreshNonce((n) => n + 1);
    setErrorMessage('');
  };

  const hasPerformanceOverflow = Boolean(
    activePlan?.performances.some((p) => p.issueCode === 'OUT_OF_SHOT_BOUNDS'),
  );
  const parseIssues = activePlan?.parsed.sceneParseIssues ?? [];
  const canConfirm = Boolean(
    snapshot &&
      activePlan &&
      activePlan.applicableBlockCount > 0 &&
      !staleCheck.stale,
  );

  return (
    <section
      aria-label="自动布景与剧本表演"
      className="auto-scene-panel"
      data-testid="auto-scene-panel"
    >
      <div className="auto-scene-toolbar">
        <div className="auto-scene-toolbar-actions">
          <button
            className="auto-scene-secondary-btn"
            data-testid="auto-scene-fill-example"
            disabled={!snapshot}
            onClick={() => handleInputChange(buildExampleTemplate(project))}
            type="button"
          >
            填入示例
          </button>
          <button
            className="auto-scene-secondary-btn"
            data-testid="auto-scene-fill-script-example"
            disabled={!snapshot}
            onClick={() =>
              handleInputChange(buildScriptPerformanceExample(project))
            }
            type="button"
          >
            剧本示例
          </button>
        </div>
        {activePlan && activePlan.applicableBlockCount > 0 ? (
          <span className="auto-scene-count" data-testid="auto-scene-summary">
            可生成 {activePlan.applicableBlockCount} / {activePlan.blocks.length}{' '}
            个镜头
            {activePlan.parsed.hasDialogueOrPerformance
              ? ` · ${activePlan.scheduledDialogueCount} 配音 · ${activePlan.readyPerformanceCount} 动作`
              : ''}
          </span>
        ) : null}
      </div>

      <textarea
        aria-label="布景或剧本结构化文本"
        className="auto-scene-input"
        data-testid="auto-scene-input"
        disabled={!snapshot}
        onChange={(event) => handleInputChange(event.target.value)}
        placeholder={
          '镜头：客厅开场\n背景：客厅\n出场：小明、小红\n站位：双人对话\n对白：\n小明：你好。\n表演：\n1｜抖动\n---\n镜头：第二镜头\n...'
        }
        rows={8}
        value={rawInput}
      />

      {parseIssues.length > 0 ? (
        <ul className="auto-scene-issues" data-testid="auto-scene-parse-issues">
          {parseIssues.map((issue, idx) => (
            <li key={`${issue.code}-${idx}`}>{issue.message}</li>
          ))}
        </ul>
      ) : null}

      {staleCheck.stale ? (
        <div className="auto-scene-stale" data-testid="auto-scene-stale-banner">
          <span>{staleCheck.reason ?? '工程内容已变更，请重新解析。'}</span>
          <button
            className="auto-scene-secondary-btn"
            onClick={handleRefreshStale}
            type="button"
          >
            重新解析
          </button>
        </div>
      ) : null}

      {hasPerformanceOverflow || extendShotForPerformance ? (
        <label className="auto-scene-option-row">
          <input
            checked={extendShotForPerformance}
            data-testid="auto-scene-extend-for-perf"
            onChange={(event) =>
              setExtendShotForPerformance(event.target.checked)
            }
            type="checkbox"
          />
          <span>表演超出镜头时长时自动延长镜头</span>
        </label>
      ) : null}

      {activePlan && activePlan.blocks.length > 0 ? (
        <div className="auto-scene-blocks" data-testid="auto-scene-blocks">
          {activePlan.blocks.map((blockSummary) => {
            const block = blockSummary.scene;
            const isPreviewing =
              effectivePreviewBlock?.scene.blockIndex === block.blockIndex;
            const bgNeedsPick =
              block.background.status === 'ambiguous' ||
              block.background.status === 'missing' ||
              block.background.status === 'unusable';

            return (
              <div
                className={`auto-scene-block${isPreviewing ? ' is-previewing' : ''}${block.applicable ? '' : ' is-unavailable'}`}
                data-block-index={block.blockIndex}
                data-testid={`auto-scene-block-${block.blockIndex}`}
                key={block.blockIndex}
              >
                <div className="auto-scene-block-header">
                  {activePlan.blocks.length > 1 ? (
                    <input
                      aria-label={`包含镜头 ${block.shotName}`}
                      checked={block.included}
                      onChange={(event) =>
                        updateBlockOverride(block.blockIndex, (cur) => ({
                          ...cur,
                          included: event.target.checked,
                        }))
                      }
                      type="checkbox"
                    />
                  ) : null}
                  <button
                    className="auto-scene-preview-trigger"
                    data-testid={`auto-scene-preview-${block.blockIndex}`}
                    disabled={!block.applicable}
                    onClick={() => setSelectedPreviewIndex(block.blockIndex)}
                    type="button"
                  >
                    <strong>{block.shotName || `镜头 ${block.blockIndex}`}</strong>
                    <span>
                      {(blockSummary.finalDurationMs / 1000).toFixed(1)}s
                      {blockSummary.extendedForAudio ? ' · 配音延长' : ''}
                      {blockSummary.extendedForPerformance ? ' · 动作延长' : ''}
                    </span>
                  </button>
                </div>

                <div className="auto-scene-row">
                  <span className="auto-scene-row-label">背景</span>
                  {bgNeedsPick ? (
                    <select
                      aria-label={`镜头 ${block.blockIndex} 背景选择`}
                      data-testid={`auto-scene-bg-select-${block.blockIndex}`}
                      onChange={(event) =>
                        updateBlockOverride(block.blockIndex, (cur) => ({
                          ...cur,
                          background: decodeBackgroundRef(event.target.value),
                        }))
                      }
                      value={encodeBackgroundRef(block.background.selectedRef)}
                    >
                      <option value="empty">空背景</option>
                      {(block.background.status === 'ambiguous'
                        ? block.background.candidates
                        : usableBackgrounds
                      ).map((candidate) => (
                        <option
                          key={candidate.id}
                          value={encodeBackgroundRef(candidate.ref)}
                        >
                          {candidate.name}
                          {candidate.kind === 'graphic' ? '（元件）' : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="auto-scene-row-value">
                      {block.background.selectedName ?? '空背景'}
                    </span>
                  )}
                </div>

                {block.cast.length > 0 ? (
                  <div className="auto-scene-row-group">
                    <span className="auto-scene-row-label">出场</span>
                    <div className="auto-scene-item-list">
                      {block.cast.map((castItem) => {
                        const needsPick =
                          castItem.match.status === 'ambiguous' ||
                          castItem.match.status === 'missing' ||
                          castItem.match.status === 'unusable';
                        return (
                          <div className="auto-scene-item" key={castItem.index}>
                            <span>{castItem.match.queryName}</span>
                            {needsPick ? (
                              <select
                                aria-label={`镜头 ${block.blockIndex} 角色 ${castItem.match.queryName} 选择`}
                                data-testid={`auto-scene-cast-select-${block.blockIndex}-${castItem.index}`}
                                onChange={(event) => {
                                  const val = event.target.value;
                                  updateBlockOverride(block.blockIndex, (cur) => ({
                                    ...cur,
                                    cast: {
                                      ...cur?.cast,
                                      [castItem.index]:
                                        val === 'skip'
                                          ? 'skip'
                                          : { characterId: val },
                                    },
                                  }));
                                }}
                                value={
                                  castItem.match.selectedRef?.characterId ?? 'skip'
                                }
                              >
                                <option value="skip">跳过此角色</option>
                                {(castItem.match.status === 'ambiguous'
                                  ? castItem.match.candidates
                                  : usableCharacters
                                ).map((candidate) => (
                                  <option
                                    key={candidate.characterId}
                                    value={candidate.characterId}
                                  >
                                    {candidate.name}
                                    {candidate.mode === 'adaptive-parts'
                                      ? '（分件）'
                                      : ''}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="auto-scene-item-status">
                                {castItem.match.status === 'skipped'
                                  ? '已跳过'
                                  : castItem.match.selectedName}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {block.props.length > 0 ? (
                  <div className="auto-scene-row-group">
                    <span className="auto-scene-row-label">道具</span>
                    <div className="auto-scene-item-list">
                      {block.props.map((propItem) => {
                        const needsPick =
                          propItem.match.status === 'ambiguous' ||
                          propItem.match.status === 'missing' ||
                          propItem.match.status === 'unusable';
                        return (
                          <div className="auto-scene-item" key={propItem.index}>
                            <span>{propItem.match.queryName}</span>
                            {needsPick ? (
                              <select
                                aria-label={`镜头 ${block.blockIndex} 道具 ${propItem.match.queryName} 选择`}
                                data-testid={`auto-scene-prop-select-${block.blockIndex}-${propItem.index}`}
                                onChange={(event) =>
                                  updateBlockOverride(block.blockIndex, (cur) => ({
                                    ...cur,
                                    props: {
                                      ...cur?.props,
                                      [propItem.index]: decodePropRef(
                                        event.target.value,
                                      ),
                                    },
                                  }))
                                }
                                value={encodePropRef(propItem.match.selectedRef)}
                              >
                                <option value="skip">跳过此道具</option>
                                {(propItem.match.status === 'ambiguous'
                                  ? propItem.match.candidates
                                  : usableProps
                                ).map((candidate) => (
                                  <option
                                    key={candidate.id}
                                    value={encodePropRef(candidate.ref)}
                                  >
                                    {candidate.name}
                                    {candidate.kind === 'animation'
                                      ? '（元件）'
                                      : ''}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="auto-scene-item-status">
                                {propItem.match.status === 'skipped'
                                  ? '已跳过'
                                  : propItem.match.selectedName}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {blockSummary.dialogues.length > 0 ? (
                  <div className="auto-scene-row-group">
                    <span className="auto-scene-row-label">对白与配音</span>
                    <div className="auto-scene-item-list">
                      {blockSummary.dialogues.map(
                        (dialogueRow: PlannedScriptDialogueRow) => {
                          const needsAudioPick =
                            dialogueRow.status === 'draft-unready' &&
                            readyAudioAssets.length > 0;
                          return (
                            <div
                              className={`auto-scene-script-row${dialogueRow.status !== 'scheduled' ? ' is-warning' : ''}`}
                              data-testid={`auto-scene-dialogue-${dialogueRow.ordinal}`}
                              key={dialogueRow.draftRowId}
                            >
                              <div className="auto-scene-item">
                                <span>
                                  {dialogueRow.ordinal}. {dialogueRow.speakerName}
                                  ：{dialogueRow.text}
                                </span>
                                {needsAudioPick ? (
                                  <select
                                    aria-label={`第 ${dialogueRow.ordinal} 句配音选择`}
                                    data-testid={`auto-scene-audio-select-${dialogueRow.ordinal}`}
                                    onChange={(event) =>
                                      updateAudioOverride(
                                        dialogueRow.draftRowId,
                                        event.target.value === 'none'
                                          ? null
                                          : event.target.value,
                                      )
                                    }
                                    value={
                                      dialogueRow.audioMatch?.audioAssetId ?? 'none'
                                    }
                                  >
                                    <option value="none">留作草稿</option>
                                    {readyAudioAssets.map((asset) => (
                                      <option key={asset.id} value={asset.id}>
                                        {asset.name}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="auto-scene-item-status">
                                    {dialogueRow.status === 'scheduled' &&
                                    dialogueRow.startMs !== null &&
                                    dialogueRow.endMs !== null
                                      ? `${(dialogueRow.startMs / 1000).toFixed(2)}–${(dialogueRow.endMs / 1000).toFixed(2)}s`
                                      : '未就绪'}
                                  </span>
                                )}
                              </div>
                              {dialogueRow.issueMessage ? (
                                <span className="auto-scene-row-issue">
                                  {dialogueRow.issueMessage}
                                </span>
                              ) : null}
                            </div>
                          );
                        },
                      )}
                    </div>
                  </div>
                ) : null}

                {blockSummary.performances.length > 0 ? (
                  <div className="auto-scene-row-group">
                    <span className="auto-scene-row-label">表演动作</span>
                    <div className="auto-scene-item-list">
                      {blockSummary.performances.map((perfRow) => {
                        const isExcluded = excludedDirectiveIds.includes(
                          perfRow.directiveId,
                        );
                        return (
                          <div
                            className={`auto-scene-script-row${perfRow.status === 'issue' ? ' is-warning' : ''}`}
                            data-perf-status={perfRow.status}
                            data-testid={`auto-scene-perf-${perfRow.directiveId}`}
                            key={perfRow.directiveId}
                          >
                            <div className="auto-scene-item">
                              <label className="auto-scene-perf-toggle">
                                <input
                                  aria-label={`包含表演 ${perfRow.raw}`}
                                  checked={!isExcluded}
                                  data-testid={`auto-scene-perf-toggle-${perfRow.directiveId}`}
                                  onChange={() =>
                                    toggleDirectiveExcluded(perfRow.directiveId)
                                  }
                                  type="checkbox"
                                />
                                <span>
                                  #{perfRow.dialogueOrdinal ?? '?'} ·{' '}
                                  {perfRow.actionLabel || perfRow.raw}
                                </span>
                              </label>
                              <span className="auto-scene-item-status">
                                {perfRow.status === 'ready' &&
                                perfRow.startMs !== null &&
                                perfRow.endMs !== null
                                  ? `${(perfRow.startMs / 1000).toFixed(2)}–${(perfRow.endMs / 1000).toFixed(2)}s`
                                  : perfRow.status === 'skipped'
                                    ? '已跳过'
                                    : '需处理'}
                              </span>
                            </div>
                            {perfRow.issueMessage ? (
                              <span className="auto-scene-row-issue">
                                {perfRow.issueMessage}
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {block.issues.length > 0 ? (
                  <ul className="auto-scene-block-issues">
                    {block.issues.map((issue, idx) => (
                      <li
                        className={`is-${issue.severity}`}
                        key={`${issue.scope}-${idx}`}
                      >
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {errorMessage ? (
        <p className="auto-scene-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <div className="auto-scene-actions">
        <button
          className="auto-scene-primary-btn"
          data-testid="auto-scene-confirm"
          disabled={!canConfirm}
          onClick={handleConfirm}
          type="button"
        >
          {activePlan?.hasIssues ? '确认生成合法子集' : '确认生成'}
          {activePlan && activePlan.applicableBlockCount > 0
            ? `（${activePlan.applicableBlockCount}）`
            : ''}
        </button>
        <button
          className="auto-scene-secondary-btn"
          data-testid="auto-scene-cancel"
          onClick={handleCancel}
          type="button"
        >
          取消
        </button>
      </div>
    </section>
  );
}
