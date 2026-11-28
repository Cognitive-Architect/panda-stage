import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  AutoSubtitleAudioService,
  attachDialogueManifestIdentities,
  buildAudioAssetFileNameIndex,
  createDraftRowIdGenerator,
  dialogueAudioManifestTextHash,
  dialogueDraftSpeakerKey,
  formatAudioDurationMs,
  matchDialogueAudioRows,
  parseDialogueAudioManifestCsv,
  pickDialogueAudioManifestLineBreak,
  reconcileDialogueDraftRows,
  resolveAudioAssetFileNameCandidates,
  resolveDialogueAudioManifestRows,
  restoreDialogueAudioManifestLineBreaks,
  serializeDialogueAudioManifestCsv,
  DialogueAudioManifestError,
  type AudioAsset,
  type Character,
  type DialogueAudioManifestRow,
  type DialogueManifestPendingIdentity,
  type DialogueAudioMatchRequest,
  type DialogueAudioScheduleRowInput,
  type DialogueDraftRowSeed,
  type StableDialogueDraftRow,
} from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { shotStore } from '../../stores/shotStore';
import { dialogueStore } from '../../stores/dialogueStore';
import { useTimelineUi } from '../timeline/timelineUiStore';
import {
  CharacterAvatar,
  CharacterIdentityPicker,
  getCharacterDefaultExpression,
  useCharacterAvatarThumbnails,
} from '../characters/CharacterIdentity';
import { CirclePlus, Download, Mic, Upload, Volume2 } from 'lucide-react';
import {
  parseDialoguePaste,
  resolveDialoguePaste,
  type ParsedDialogueLine,
} from './parseDialoguePaste';
import { NARRATOR_SPEAKER_NAME } from './dialogueSpeaker';
import type { DialogueAuthoringDraft } from './dialogueAuthoringDraft';
import { DialogueBatchAudioRow } from './DialogueBatchAudioRow';

interface ManualAudioOverride {
  assetId: string | null;
  speakerKey: string;
  sourceStartMs?: number;
  sourceEndMs?: number;
}

type PendingManifestLine = DialogueManifestPendingIdentity;

interface ImportedAudioBinding {
  readonly assetId: string | null;
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly textHash?: string;
}

const autoSubtitleAudioService = new AutoSubtitleAudioService();

function createManifestLineKey(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `line-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function safeDownloadName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/gu, '-').trim() || '配音清单';
}

function downloadCsvFile(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exceptionHeading(line: ParsedDialogueLine): string {
  if (line.status === 'malformed') return '这一行格式不对';
  if (line.status === 'invalid') {
    return line.reason === 'empty-speaker' ? '缺少角色名称' : '缺少台词内容';
  }
  return line.speaker ?? '未识别角色';
}

function exceptionDetail(line: ParsedDialogueLine): string | null {
  if (line.status === 'malformed') return '请写成「角色：台词」';
  if (line.status === 'unknown' || line.status === 'ambiguous') {
    return line.text ?? line.raw;
  }
  return null;
}

function mappingIssueCopy(line: ParsedDialogueLine): string {
  if (line.reason === 'narrator-name-conflict') {
    return '“旁白”与项目角色同名，请选择角色';
  }
  if (line.status === 'ambiguous') {
    return `“${line.speaker ?? '未识别角色'}”对应多个角色，请确认`;
  }
  return `未找到“${line.speaker ?? '未识别角色'}”`;
}

/**
 * Production batch authoring surface. Parsing, speaker mapping, stable draft
 * row identity, audio matching, and real-duration timing preview remain
 * transient draft state; DialogueStore.createMany or DialogueStore.applyAudioBatch
 * performs the sole, atomic Project/History commit.
 */
export function DialogueBatchPaste({
  draft,
  onSuccess,
  showDefaultExpression = true,
}: {
  draft: DialogueAuthoringDraft;
  onSuccess: () => void;
  showDefaultExpression?: boolean;
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const currentShotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
  );
  const timelineUi = useTimelineUi();
  const characters: readonly Character[] = snapshot?.project.characters ?? [];
  const audioAssets: readonly AudioAsset[] = useMemo(
    () =>
      (snapshot?.project.assets ?? []).filter(
        (asset): asset is AudioAsset => asset.kind === 'audio',
      ),
    [snapshot?.project.assets],
  );
  const {
    onThumbnailError: onCharacterThumbnailError,
    thumbnails: characterThumbnails,
  } = useCharacterAvatarThumbnails(snapshot, characters);
  const draftState = useSyncExternalStore(draft.subscribe, draft.getSnapshot);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [manifestNotice, setManifestNotice] = useState<string | null>(null);
  const manifestInputRef = useRef<HTMLInputElement | null>(null);
  const pendingManifestByLineNumberRef = useRef<Map<number, PendingManifestLine>>(
    new Map(),
  );
  const importedAudioByLineKeyRef = useRef<Map<string, ImportedAudioBinding>>(
    new Map(),
  );
  const lineKeyByDraftRowIdRef = useRef<Map<string, string>>(new Map());
  const manifestLineBreakRef = useRef<string | null>(null);
  const [manualAudioState, setManualAudioState] = useState<{
    sessionKey: string;
    entries: Record<string, ManualAudioOverride>;
  }>({ sessionKey: '', entries: {} });
  const [confirmedExtensionToMs, setConfirmedExtensionToMs] = useState<
    number | null
  >(null);
  const previousStableRowsRef = useRef<readonly StableDialogueDraftRow[]>([]);
  const confirmedAudioByRowIdRef = useRef<
    Record<string, { assetId: string; speakerKey: string }>
  >({});
  const nextDraftRowIdRef = useRef<() => string>(createDraftRowIdGenerator());
  const preservedLineOrdinalsRef = useRef<
    readonly { raw: string; logicalOrdinal: number }[] | null
  >(null);
  const committedMaxOrdinalRef = useRef<number>(0);
  const sessionKey = `${snapshot?.projectRoot ?? ''}::${currentShotId ?? ''}`;
  const lastSessionKeyRef = useRef<string>(sessionKey);

  // Synchronously reset transient session refs before reconciliation when the
  // active project or shot changes so no stale draft IDs or audio bindings leak
  // into the first render of the new session.
  if (lastSessionKeyRef.current !== sessionKey) {
    lastSessionKeyRef.current = sessionKey;
    previousStableRowsRef.current = [];
    confirmedAudioByRowIdRef.current = {};
    nextDraftRowIdRef.current = createDraftRowIdGenerator();
    preservedLineOrdinalsRef.current = null;
    committedMaxOrdinalRef.current = 0;
    pendingManifestByLineNumberRef.current = new Map();
    importedAudioByLineKeyRef.current = new Map();
    lineKeyByDraftRowIdRef.current = new Map();
    manifestLineBreakRef.current = null;
  }

  const manualAudioByRowId = useMemo(
    () =>
      manualAudioState.sessionKey === sessionKey
        ? manualAudioState.entries
        : {},
    [manualAudioState, sessionKey],
  );

  useEffect(() => {
    setManualAudioState({ sessionKey, entries: {} });
    setConfirmedExtensionToMs(null);
    setCommitError(null);
    setManifestError(null);
    setManifestNotice(null);
  }, [sessionKey]);

  const parsed = useMemo(
    () => parseDialoguePaste(draftState.batchRaw, characters),
    [draftState.batchRaw, characters],
  );
  const resolution = useMemo(
    () => resolveDialoguePaste(parsed, draftState.batchMapping, characters),
    [characters, draftState.batchMapping, parsed],
  );
  const hasContent = draftState.batchRaw.trim().length > 0;
  const pendingCount = Math.max(parsed.lines.length - resolution.readyCount, 0);

  // Preserve original 1-based logical ordinals across unresolved lines and
  // across partial commits so remaining draft lines are never re-numbered onto
  // already-committed audio ordinals.
  const logicalOrdinalsByLineNumber = useMemo(() => {
    const map = new Map<number, number>();
    if (parsed.lines.length === 0) {
      preservedLineOrdinalsRef.current = null;
      committedMaxOrdinalRef.current = 0;
      return map;
    }

    const preserved = preservedLineOrdinalsRef.current;
    if (preserved && preserved.length > 0) {
      const available = new Set(preserved.map((_, idx) => idx));
      const matchedOrdinals: Array<number | null> = parsed.lines.map(() => null);
      parsed.lines.forEach((line, idx) => {
        for (const prevIdx of available) {
          if (preserved[prevIdx]!.raw === line.raw) {
            matchedOrdinals[idx] = preserved[prevIdx]!.logicalOrdinal;
            available.delete(prevIdx);
            break;
          }
        }
      });

      let nextOrdinal = Math.max(
        committedMaxOrdinalRef.current,
        ...matchedOrdinals.filter((val): val is number => val !== null),
        0,
      );
      const nextPreserved: Array<{ raw: string; logicalOrdinal: number }> = [];
      parsed.lines.forEach((line, idx) => {
        let ordinal = matchedOrdinals[idx] ?? null;
        if (ordinal === null) {
          nextOrdinal += 1;
          ordinal = nextOrdinal;
        }
        map.set(line.lineNumber, ordinal);
        nextPreserved.push({ raw: line.raw, logicalOrdinal: ordinal });
      });
      preservedLineOrdinalsRef.current = nextPreserved;
      return map;
    }

    parsed.lines.forEach((line, index) => {
      map.set(line.lineNumber, index + 1);
    });
    return map;
  }, [parsed.lines]);

  const stableDraftRows = useMemo(() => {
    const seeds: DialogueDraftRowSeed[] = [];
    parsed.lines.forEach((line, index) => {
      const resolved = resolution.resolvedLines[index];
      if (!resolved) return;
      const isNarrator = resolved.speakerType === 'narrator';
      const character = resolved.characterId
        ? characters.find((candidate) => candidate.id === resolved.characterId)
        : undefined;
      if (!isNarrator && !character) return;
      const logicalOrdinal =
        logicalOrdinalsByLineNumber.get(line.lineNumber) ?? index + 1;
      seeds.push({
        sourceLineNumber: line.lineNumber,
        logicalOrdinal,
        text: restoreDialogueAudioManifestLineBreaks(
          resolved.text,
          manifestLineBreakRef.current,
        ),
        speakerType: isNarrator ? 'narrator' : 'character',
        ...(character ? { characterId: character.id } : {}),
        speakerName: isNarrator ? NARRATOR_SPEAKER_NAME : character!.name,
      });
    });
    const reconciled = reconcileDialogueDraftRows(
      previousStableRowsRef.current,
      seeds,
      nextDraftRowIdRef.current,
    );

    // Manifest identity is a one-shot positional bridge: a row only takes the
    // identity of its own CSV slot, so an identical line from another shot can
    // never walk into it.
    const attached = attachDialogueManifestIdentities(
      reconciled,
      pendingManifestByLineNumberRef.current,
    );

    previousStableRowsRef.current = attached;
    for (const row of attached) {
      if (row.lineKey) {
        lineKeyByDraftRowIdRef.current.set(row.draftRowId, row.lineKey);
      }
    }

    // Immediately prune confirmed audio cache for any deleted draft rows so
    // retired row IDs leave no stale bindings behind.
    const activeIds = new Set(attached.map((row) => row.draftRowId));
    const prunedConfirmed: Record<string, { assetId: string; speakerKey: string }> = {};
    for (const [rowId, binding] of Object.entries(confirmedAudioByRowIdRef.current)) {
      if (activeIds.has(rowId)) {
        prunedConfirmed[rowId] = binding;
      }
    }
    confirmedAudioByRowIdRef.current = prunedConfirmed;

    return attached;
  }, [
    characters,
    logicalOrdinalsByLineNumber,
    parsed.lines,
    resolution.resolvedLines,
  ]);

  // Prune manual audio overrides for deleted draft rows.
  useEffect(() => {
    const activeIds = new Set(stableDraftRows.map((row) => row.draftRowId));
    setManualAudioState((prev) => {
      if (prev.sessionKey !== sessionKey) return prev;
      const keys = Object.keys(prev.entries);
      if (keys.every((id) => activeIds.has(id))) return prev;
      const nextEntries: Record<string, ManualAudioOverride> = {};
      for (const id of keys) {
        if (activeIds.has(id)) {
          nextEntries[id] = prev.entries[id]!;
        }
      }
      return { sessionKey, entries: nextEntries };
    });
  }, [sessionKey, stableDraftRows]);

  const matchReport = useMemo(() => {
    if (!snapshot || audioAssets.length === 0 || stableDraftRows.length === 0) {
      return null;
    }
    const requests: DialogueAudioMatchRequest[] = stableDraftRows.map(
      (row, index) => {
        const speakerKey = dialogueDraftSpeakerKey(row);
        const manual = manualAudioByRowId[row.draftRowId];
        const activeManual =
          manual && manual.speakerKey === speakerKey ? manual : undefined;
        const confirmed = confirmedAudioByRowIdRef.current[row.draftRowId];
        const activeConfirmedAssetId = row.explicitAudioUnselected
          ? undefined
          : row.confirmedAudioAssetId ??
            (confirmed && confirmed.speakerKey === speakerKey
              ? confirmed.assetId
              : undefined);
        const lineKey =
          row.lineKey ?? lineKeyByDraftRowIdRef.current.get(row.draftRowId);
        const imported = lineKey
          ? importedAudioByLineKeyRef.current.get(lineKey)
          : undefined;
        const importedTextMatches =
          !imported?.textHash ||
          imported.textHash ===
            dialogueAudioManifestTextHash(row.speakerName, row.text);
        const manualAssetId = activeManual
          ? activeManual.assetId
          : imported
            ? importedTextMatches
              ? imported.assetId
              : null
            : row.explicitAudioUnselected
              ? null
              : undefined;
        const sourceStartMs = activeManual
          ? activeManual.sourceStartMs
          : imported && importedTextMatches
            ? imported.sourceStartMs
            : undefined;
        const sourceEndMs = activeManual
          ? activeManual.sourceEndMs
          : imported && importedTextMatches
            ? imported.sourceEndMs
            : undefined;
        return {
          draftRowId: row.draftRowId,
          ordinal: row.logicalOrdinal ?? index + 1,
          sourceLineNumber: row.sourceLineNumber,
          text: row.text,
          speakerType: row.speakerType,
          ...(row.characterId ? { characterId: row.characterId } : {}),
          speakerName: row.speakerName,
          ...(row.existingDialogueId
            ? { existingDialogueId: row.existingDialogueId }
            : {}),
          ...(activeConfirmedAssetId !== undefined
            ? { confirmedAudioAssetId: activeConfirmedAssetId }
            : {}),
          ...(manualAssetId !== undefined
            ? { manualAudioAssetId: manualAssetId }
            : {}),
          ...(sourceStartMs !== undefined ? { sourceStartMs } : {}),
          ...(sourceEndMs !== undefined ? { sourceEndMs } : {}),
        };
      },
    );
    return matchDialogueAudioRows(snapshot.project, requests, {
      shotId: currentShotId ?? undefined,
    });
  }, [
    audioAssets.length,
    currentShotId,
    manualAudioByRowId,
    snapshot,
    stableDraftRows,
  ]);

  useEffect(() => {
    if (!matchReport) {
      if (stableDraftRows.length === 0) {
        confirmedAudioByRowIdRef.current = {};
      }
      return;
    }
    const nextConfirmed: Record<string, { assetId: string; speakerKey: string }> = {};
    for (const row of matchReport.rows) {
      if (row.ready && row.audioAssetId) {
        nextConfirmed[row.draftRowId] = {
          assetId: row.audioAssetId,
          speakerKey: dialogueDraftSpeakerKey(row),
        };
      }
    }
    confirmedAudioByRowIdRef.current = nextConfirmed;
  }, [matchReport, stableDraftRows.length]);

  const matchRowByLineNumber = useMemo(() => {
    const map = new Map<
      number,
      NonNullable<typeof matchReport>['rows'][number]
    >();
    matchReport?.rows.forEach((row) => {
      map.set(row.sourceLineNumber, row);
    });
    return map;
  }, [matchReport]);

  const readyScheduleRows: readonly DialogueAudioScheduleRowInput[] = useMemo(
    () =>
      (matchReport?.readyRows ?? []).map((row) => ({
        draftRowId: row.draftRowId,
        sourceLineNumber: row.sourceLineNumber,
        text: row.text,
        speakerType: row.speakerType,
        ...(row.characterId ? { characterId: row.characterId } : {}),
        ...(row.existingDialogueId
          ? { existingDialogueId: row.existingDialogueId }
          : {}),
        audioAssetId: row.audioAssetId!,
        sourceStartMs: row.sourceStartMs ?? 0,
        sourceEndMs: row.sourceEndMs ?? row.durationMs!,
      })),
    [matchReport],
  );

  const schedulePlan = useMemo(() => {
    if (!snapshot || !currentShotId || readyScheduleRows.length === 0) {
      return null;
    }
    return autoSubtitleAudioService.plan(snapshot.project, {
      shotId: currentShotId,
      startMs: timelineUi.currentTimeMs,
      rows: readyScheduleRows,
    });
  }, [currentShotId, readyScheduleRows, snapshot, timelineUi.currentTimeMs]);

  const plannedRowByDraftId = useMemo(() => {
    const map = new Map<
      string,
      NonNullable<typeof schedulePlan>['rows'][number]
    >();
    schedulePlan?.rows.forEach((row) => {
      map.set(row.draftRowId, row);
    });
    return map;
  }, [schedulePlan]);

  useEffect(() => {
    if (
      confirmedExtensionToMs !== null &&
      confirmedExtensionToMs !== schedulePlan?.extensionToMs
    ) {
      setConfirmedExtensionToMs(null);
    }
  }, [confirmedExtensionToMs, schedulePlan?.extensionToMs]);

  const handleCommit = (): void => {
    if (!resolution.allResolved) return;
    try {
      // The plain-subtitle path must restore real line breaks exactly like the
      // audio path; the batch textarea packs multi-line cells behind a marker.
      dialogueStore.createMany(
        resolution.resolvedLines
          .filter((line): line is NonNullable<typeof line> => line !== null)
          .map((line) => ({
            ...line,
            text: restoreDialogueAudioManifestLineBreaks(
              line.text,
              manifestLineBreakRef.current,
            ),
          })),
      );
      setCommitError(null);
      onSuccess();
    } catch (nextError) {
      setCommitError(
        nextError instanceof Error ? nextError.message : '批量添加失败。',
      );
    }
  };

  const handleAudioCommit = (): void => {
    if (!schedulePlan || !schedulePlan.ready || !matchReport) return;
    if (
      schedulePlan.needsShotExtension &&
      confirmedExtensionToMs !== schedulePlan.extensionToMs
    ) {
      return;
    }
    try {
      const { plan: committedPlan } = dialogueStore.applyAudioBatch({
        startMs: schedulePlan.startMs,
        rows: readyScheduleRows,
        ...(schedulePlan.needsShotExtension &&
        schedulePlan.extensionToMs !== null
          ? { extendShotToMs: schedulePlan.extensionToMs }
          : {}),
      });
      setCommitError(null);
      setConfirmedExtensionToMs(null);

      // Retire committed identities before reconciling the compacted text.
      // Identical remaining lines must match their own previous identities.
      const committedRowIds = new Set(
        committedPlan.rows.map((row) => row.draftRowId),
      );
      previousStableRowsRef.current = previousStableRowsRef.current.filter(
        (row) => !committedRowIds.has(row.draftRowId),
      );
      for (const rowId of committedRowIds) {
        delete confirmedAudioByRowIdRef.current[rowId];
      }
      setManualAudioState((prev) => {
        if (prev.sessionKey !== sessionKey) return prev;
        const entries = { ...prev.entries };
        for (const rowId of committedRowIds) {
          delete entries[rowId];
        }
        return { sessionKey, entries };
      });

      const committedLineNumbers = new Set(
        committedPlan.rows.map((row) => row.sourceLineNumber),
      );
      const remainingLines = parsed.lines.filter(
        (line) => !committedLineNumbers.has(line.lineNumber),
      );
      if (remainingLines.length === 0) {
        preservedLineOrdinalsRef.current = null;
        committedMaxOrdinalRef.current = 0;
        onSuccess();
      } else {
        // Preserve original logical ordinals for all remaining draft lines so
        // partial commit never re-numbers remaining rows onto already-committed
        // numbered audio files.
        const committedMax = Math.max(
          committedMaxOrdinalRef.current,
          ...committedPlan.rows.map(
            (row) => logicalOrdinalsByLineNumber.get(row.sourceLineNumber) ?? 0,
          ),
        );
        committedMaxOrdinalRef.current = committedMax;
        preservedLineOrdinalsRef.current = remainingLines.map((line, idx) => ({
          raw: line.raw,
          logicalOrdinal:
            logicalOrdinalsByLineNumber.get(line.lineNumber) ?? idx + 1,
        }));

        // Keep any not-yet-attached manifest identity aligned with the compacted
        // text, so a line that was still unresolved keeps its own CSV slot.
        const pendingAfterCommit = new Map<number, PendingManifestLine>();
        remainingLines.forEach((line, idx) => {
          const identity = pendingManifestByLineNumberRef.current.get(
            line.lineNumber,
          );
          if (identity) pendingAfterCommit.set(idx + 1, identity);
        });
        pendingManifestByLineNumberRef.current = pendingAfterCommit;

        // Re-index existing manual speaker mappings to match the compacted line numbers.
        const remainingMappings: Record<number, string> = {};
        remainingLines.forEach((line, idx) => {
          const mappedCharId = draftState.batchMapping[line.lineNumber];
          if (mappedCharId) {
            remainingMappings[idx + 1] = mappedCharId;
          }
        });
        draft.setBatchRaw(
          remainingLines.map((line) => line.raw).join('\n'),
          remainingMappings,
        );
      }
    } catch (nextError) {
      setCommitError(
        nextError instanceof Error
          ? nextError.message
          : '生成字幕与配音失败。',
      );
    }
  };

  const handleExportManifest = (): void => {
    if (!snapshot || !currentShotId || stableDraftRows.length === 0) return;
    const shot = snapshot.project.shots.find(
      (candidate) => candidate.id === currentShotId,
    );
    const matchByDraftRowId = new Map(
      (matchReport?.rows ?? []).map((row) => [row.draftRowId, row]),
    );
    const rows: DialogueAudioManifestRow[] = stableDraftRows.map(
      (row, index) => {
        let lineKey =
          row.lineKey ?? lineKeyByDraftRowIdRef.current.get(row.draftRowId);
        if (!lineKey) {
          lineKey = createManifestLineKey();
          lineKeyByDraftRowIdRef.current.set(row.draftRowId, lineKey);
        }
        const match = matchByDraftRowId.get(row.draftRowId);
        return {
          version: 1,
          projectId: snapshot.project.id,
          shotId: currentShotId,
          lineKey,
          ...(row.existingDialogueId
            ? { dialogueId: row.existingDialogueId }
            : {}),
          ordinal: row.logicalOrdinal ?? index + 1,
          speaker: row.speakerName,
          text: row.text,
          ...(match?.fileName ? { audioFilename: match.fileName } : {}),
          ...(match?.sourceStartMs !== null &&
          match?.sourceStartMs !== undefined
            ? { sourceStartMs: match.sourceStartMs }
            : {}),
          ...(match?.sourceEndMs !== null && match?.sourceEndMs !== undefined
            ? { sourceEndMs: match.sourceEndMs }
            : {}),
          textHash: dialogueAudioManifestTextHash(row.speakerName, row.text),
        };
      },
    );
    downloadCsvFile(
      safeDownloadName(
        `${snapshot.project.name}-${shot?.name ?? '镜头'}-配音清单.csv`,
      ),
      serializeDialogueAudioManifestCsv(rows),
    );
    setManifestError(null);
    setManifestNotice(`已导出 ${rows.length} 条配音清单。`);
  };

  const handleManifestFile = async (file: File): Promise<void> => {
    if (!snapshot || !currentShotId) return;
    setManifestError(null);
    setManifestNotice(null);
    try {
      const parsedManifest = parseDialogueAudioManifestCsv(await file.text());
      if (parsedManifest.rows.length === 0) {
        setManifestError(
          parsedManifest.issues[0]?.message ?? '清单中没有可导入的对白。',
        );
        return;
      }
      const shot = snapshot.project.shots.find(
        (candidate) => candidate.id === currentShotId,
      );
      const resolvedRows = resolveDialogueAudioManifestRows(
        parsedManifest.rows,
        snapshot.project.id,
        currentShotId,
        new Set((shot?.dialogues ?? []).map((dialogue) => dialogue.id)),
      );
      if (resolvedRows.every((entry) => !entry.inScope)) {
        setManifestError(
          '这份配音清单属于其他工程或镜头，未导入任何内容。',
        );
        return;
      }

      // Candidate sets, not last-write-wins: two assets sharing a name must be
      // reported as ambiguous instead of silently binding whichever came last.
      const audioNameIndex = buildAudioAssetFileNameIndex(audioAssets);
      const findAudioCandidates = (fileName: string): readonly AudioAsset[] =>
        resolveAudioAssetFileNameCandidates(audioNameIndex, fileName);

      const marker = pickDialogueAudioManifestLineBreak(
        resolvedRows.map((entry) => entry.row.text),
      );
      const rawLines: string[] = [];
      const pending = new Map<number, PendingManifestLine>();
      const bindings = new Map<string, ImportedAudioBinding>();
      let missingAudio = 0;
      let ambiguousAudio = 0;
      let changedText = 0;
      let outOfScope = 0;
      let droppedDialogueId = 0;

      resolvedRows.forEach(({ row, inScope, issues }, index) => {
        const lineNumber = index + 1;
        rawLines.push(
          `${row.speaker}：${row.text.replaceAll(/\r\n?|\n/gu, marker)}`,
        );
        if (!inScope) {
          outOfScope += 1;
          pending.set(lineNumber, {
            speaker: row.speaker,
            text: row.text,
            explicitAudioUnselected: true,
          });
          return;
        }
        if (issues.some((issue) => issue.code === 'DIALOGUE_ID_MISSING')) {
          droppedDialogueId += 1;
        }
        pending.set(lineNumber, {
          lineKey: row.lineKey,
          ...(row.dialogueId ? { dialogueId: row.dialogueId } : {}),
          speaker: row.speaker,
          text: row.text,
        });

        const emptyBinding: ImportedAudioBinding = {
          assetId: null,
          sourceStartMs: 0,
          sourceEndMs: 0,
          ...(row.textHash ? { textHash: row.textHash } : {}),
        };
        if (!row.audioFilename) {
          bindings.set(row.lineKey, emptyBinding);
          return;
        }
        const candidates = findAudioCandidates(row.audioFilename);
        const textMatches =
          !row.textHash ||
          row.textHash === dialogueAudioManifestTextHash(row.speaker, row.text);
        if (candidates.length === 0) {
          missingAudio += 1;
          bindings.set(row.lineKey, emptyBinding);
          return;
        }
        if (candidates.length > 1) {
          ambiguousAudio += 1;
          bindings.set(row.lineKey, emptyBinding);
          return;
        }
        if (!textMatches) {
          changedText += 1;
          bindings.set(row.lineKey, emptyBinding);
          return;
        }
        const asset = candidates[0]!;
        const durationMs = asset.durationMs ?? row.sourceEndMs ?? 0;
        bindings.set(row.lineKey, {
          assetId: asset.id,
          sourceStartMs: row.sourceStartMs ?? 0,
          sourceEndMs: row.sourceEndMs ?? durationMs,
          ...(row.textHash ? { textHash: row.textHash } : {}),
        });
      });

      manifestLineBreakRef.current = marker;
      pendingManifestByLineNumberRef.current = pending;
      importedAudioByLineKeyRef.current = bindings;
      lineKeyByDraftRowIdRef.current = new Map();
      previousStableRowsRef.current = [];
      confirmedAudioByRowIdRef.current = {};
      preservedLineOrdinalsRef.current = null;
      committedMaxOrdinalRef.current = 0;
      setManualAudioState({ sessionKey, entries: {} });
      setConfirmedExtensionToMs(null);
      setCommitError(null);
      draft.setBatchRaw(rawLines.join('\n'), {});
      const notices = [
        `已导入 ${resolvedRows.length - outOfScope} 条配音清单`,
        ...(outOfScope > 0 ? [`${outOfScope} 条属于其他镜头未绑定`] : []),
        ...(missingAudio > 0 ? [`${missingAudio} 条音频未找到`] : []),
        ...(ambiguousAudio > 0 ? [`${ambiguousAudio} 条音频同名需手动选择`] : []),
        ...(changedText > 0 ? [`${changedText} 条台词已变更待确认`] : []),
        ...(droppedDialogueId > 0
          ? [`${droppedDialogueId} 条原对白已不存在按新台词处理`]
          : []),
        ...(parsedManifest.issues.length > 0
          ? [`${parsedManifest.issues.length} 条格式提示`]
          : []),
      ];
      setManifestNotice(`${notices.join('，')}。`);
    } catch (error) {
      setManifestError(
        error instanceof DialogueAudioManifestError
          ? error.message
          : '无法读取配音清单，请确认文件为 UTF-8 CSV。',
      );
    }
  };

  const extensionConfirmed =
    !schedulePlan?.needsShotExtension ||
    confirmedExtensionToMs === schedulePlan.extensionToMs;
  const canCommitAudio =
    Boolean(schedulePlan?.ready) &&
    readyScheduleRows.length > 0 &&
    extensionConfirmed;
  const hasAudioMode = audioAssets.length > 0;

  return (
    <div
      aria-labelledby="dialogue-authoring-tab-batch"
      className="dialogue-authoring-mode dialogue-authoring-batch"
      data-testid="dialogue-batch"
      id="dialogue-authoring-panel-batch"
      role="tabpanel"
    >
      <section className="dialogue-batch-input-section">
        <label id="dialogue-batch-format-hint" htmlFor="dialogue-batch-input">
          每行一条，格式：角色：台词 或 旁白：台词
        </label>
        <textarea
          aria-describedby="dialogue-batch-format-hint"
          aria-label="批量字幕原始文本"
          className="dialogue-batch-input"
          data-testid="dialogue-batch-input"
          id="dialogue-batch-input"
          placeholder={'Panda：你好呀\n旁白：十年前……'}
          rows={7}
          value={draftState.batchRaw}
          onChange={(event) => {
            setCommitError(null);
            setManifestError(null);
            setManifestNotice(null);
            draft.setBatchRaw(event.target.value);
          }}
        />
        <div className="dialogue-batch-manifest-actions">
          <button
            className="dialogue-batch-manifest-action"
            data-testid="dialogue-batch-manifest-export"
            disabled={stableDraftRows.length === 0}
            type="button"
            onClick={handleExportManifest}
          >
            <Download aria-hidden="true" size={14} focusable="false" />
            <span>导出配音清单</span>
          </button>
          <button
            className="dialogue-batch-manifest-action"
            data-testid="dialogue-batch-manifest-import"
            type="button"
            onClick={() => manifestInputRef.current?.click()}
          >
            <Upload aria-hidden="true" size={14} focusable="false" />
            <span>导入配音清单</span>
          </button>
          <input
            accept=".csv,text/csv"
            data-testid="dialogue-batch-manifest-file"
            hidden
            ref={manifestInputRef}
            type="file"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void handleManifestFile(file);
            }}
          />
        </div>
        {manifestError ? (
          <p className="dialogue-batch-manifest-error" role="alert">
            {manifestError}
          </p>
        ) : null}
        {manifestNotice ? (
          <p className="dialogue-batch-manifest-notice" role="status">
            {manifestNotice}
          </p>
        ) : null}
      </section>

      {hasContent ? (
        <>
          <div
            aria-label="批量字幕识别结果"
            className="dialogue-batch-recognition"
            data-testid="dialogue-batch-recognition"
            role="status"
          >
            <strong>识别结果</strong>
            <span className="dialogue-batch-recognition-ready">
              <span aria-hidden="true">✓</span>
              {`${resolution.readyCount} 条已识别`}
            </span>
            <span className="dialogue-batch-recognition-pending">
              <span aria-hidden="true">⚠</span>
              {`${pendingCount} 条待确认`}
            </span>
            {matchReport && matchReport.readyCount > 0 ? (
              <span
                className="dialogue-batch-recognition-audio"
                data-testid="dialogue-batch-audio-summary"
              >
                {`已配音 ${matchReport.readyCount} 条 · ${formatAudioDurationMs(matchReport.totalDurationMs)}`}
              </span>
            ) : null}
            {parsed.ignoredEmpty > 0 ? (
              <span className="dialogue-batch-recognition-ignored">
                {`已忽略 ${parsed.ignoredEmpty} 个空行`}
              </span>
            ) : null}
          </div>

          <ol
            aria-label="批量字幕识别结果"
            className="dialogue-batch-preview"
            data-testid="dialogue-batch-preview"
          >
            {parsed.lines.map((line, index) => {
              const resolved = resolution.resolvedLines[index];
              const needsMapping =
                line.status === 'unknown' || line.status === 'ambiguous';
              const resolvedNarration = resolved?.speakerType === 'narrator';
              const resolvedCharacter = resolved?.characterId
                ? characters.find(
                    (candidate) => candidate.id === resolved.characterId,
                  )
                : undefined;
              const resolvedRow =
                resolved && (resolvedNarration || resolvedCharacter)
                  ? { character: resolvedCharacter, line: resolved }
                  : null;
              const matchRow = matchRowByLineNumber.get(line.lineNumber);
              const plannedRow = matchRow
                ? plannedRowByDraftId.get(matchRow.draftRowId)
                : undefined;
              const rowSpeakerKey = matchRow
                ? dialogueDraftSpeakerKey(matchRow)
                : '';

              return (
                <li
                  data-audio-ready={
                    matchRow ? String(matchRow.ready) : undefined
                  }
                  data-status={
                    resolvedRow
                      ? needsMapping
                        ? 'mapped'
                        : 'valid'
                      : line.status
                  }
                  data-testid="dialogue-batch-line"
                  key={matchRow?.draftRowId ?? `line-${line.lineNumber}`}
                >
                  {resolvedRow ? (
                    <div className="dialogue-batch-row-result dialogue-batch-row-result-resolved">
                      <span
                        aria-label="已识别"
                        className="dialogue-batch-row-status"
                      >
                        ✓
                      </span>
                      {resolvedRow.character ? (
                        <CharacterAvatar
                          character={resolvedRow.character}
                          className="dialogue-batch-row-avatar"
                          onThumbnailError={onCharacterThumbnailError}
                          thumbnail={
                            characterThumbnails[
                              getCharacterDefaultExpression(
                                resolvedRow.character,
                              )?.assetId ?? ''
                            ]
                          }
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="dialogue-batch-row-avatar dialogue-batch-row-avatar-narrator"
                        >
                          <Mic size={16} strokeWidth={1.8} />
                        </span>
                      )}
                      <div className="dialogue-batch-row-copy">
                        <strong>
                          {resolvedRow.character?.name ?? NARRATOR_SPEAKER_NAME}
                        </strong>
                        <span>
                          {restoreDialogueAudioManifestLineBreaks(
                            resolvedRow.line.text,
                            manifestLineBreakRef.current,
                          )}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="dialogue-batch-row-result dialogue-batch-row-result-exception">
                      <span
                        aria-hidden="true"
                        className="dialogue-batch-row-status"
                      >
                        ⚠
                      </span>
                      <div className="dialogue-batch-row-copy">
                        <strong>{exceptionHeading(line)}</strong>
                        {exceptionDetail(line) ? (
                          <span>{exceptionDetail(line)}</span>
                        ) : null}
                      </div>
                    </div>
                  )}

                  {hasAudioMode && matchRow ? (
                    <DialogueBatchAudioRow
                      audioAssets={audioAssets}
                      lineNumber={line.lineNumber}
                      matchRow={matchRow}
                      plannedRow={plannedRow}
                      onSelectAudio={(assetId) => {
                        setCommitError(null);
                        setManualAudioState((prev) => ({
                          sessionKey,
                          entries: {
                            ...(prev.sessionKey === sessionKey ? prev.entries : {}),
                            [matchRow.draftRowId]: {
                              assetId,
                              speakerKey: rowSpeakerKey,
                            },
                          },
                        }));
                      }}
                    />
                  ) : null}

                  {needsMapping && !resolvedRow ? (
                    <div className="dialogue-batch-row-resolution">
                      <p className="dialogue-batch-row-issue">
                        <strong>{mappingIssueCopy(line)}</strong>
                      </p>
                      <CharacterIdentityPicker
                        ariaLabel={`为${line.speaker ?? '未识别角色'}选择对应角色`}
                        characters={characters}
                        className="dialogue-batch-character-picker"
                        emptySummaryDescription={null}
                        emptySummaryLabel="请选择对应角色"
                        onClear={() => {
                          setCommitError(null);
                          draft.setBatchMapping(line.lineNumber, '');
                        }}
                        onSelect={(characterId) => {
                          setCommitError(null);
                          draft.setBatchMapping(line.lineNumber, characterId);
                        }}
                        onThumbnailError={onCharacterThumbnailError}
                        selectedCharacterId={
                          draftState.batchMapping[line.lineNumber] ?? null
                        }
                        selectedLabel="当前绑定"
                        showDefaultExpression={showDefaultExpression}
                        data-testid={`dialogue-batch-map-${line.lineNumber}`}
                        thumbnails={characterThumbnails}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>

          {schedulePlan && schedulePlan.blockers.length > 0 ? (
            <div
              className="dialogue-batch-audio-alerts"
              data-testid="dialogue-batch-audio-conflict"
              role="alert"
            >
              {schedulePlan.blockers.map((blocker, idx) => (
                <p key={`${blocker.code}-${blocker.sourceLineNumber ?? idx}`}>
                  {blocker.message}
                </p>
              ))}
            </div>
          ) : null}

          {schedulePlan?.needsShotExtension &&
          schedulePlan.extensionToMs !== null ? (
            <label
              className="dialogue-batch-extend-confirm"
              data-testid="dialogue-batch-extend-confirm"
            >
              <input
                checked={
                  confirmedExtensionToMs === schedulePlan.extensionToMs
                }
                type="checkbox"
                onChange={(event) => {
                  setCommitError(null);
                  setConfirmedExtensionToMs(
                    event.target.checked ? schedulePlan.extensionToMs : null,
                  );
                }}
              />
              <span>
                {`当前镜头时长 ${formatAudioDurationMs(schedulePlan.shotDurationMs)} 不足，确认延长至 ${formatAudioDurationMs(schedulePlan.extensionToMs)}`}
              </span>
            </label>
          ) : null}

          {matchReport &&
          matchReport.hasCommitableSubset &&
          matchReport.draftCount > 0 ? (
            <p
              className="dialogue-batch-subset-note"
              data-testid="dialogue-batch-subset-note"
            >
              {`可先生成 ${matchReport.readyCount} 条就绪配音，其余 ${matchReport.draftCount} 条将保留在草稿。`}
            </p>
          ) : null}

          {commitError ? (
            <p className="dialogue-authoring-error" role="alert">
              {commitError}
            </p>
          ) : null}

          <footer
            className="dialogue-authoring-footer dialogue-batch-footer-actions"
            data-testid="dialogue-authoring-footer"
          >
            {hasAudioMode ? (
              <button
                className="dialogue-authoring-submit dialogue-batch-submit dialogue-batch-audio-submit"
                data-testid="dialogue-batch-audio-commit"
                disabled={!canCommitAudio}
                type="button"
                onClick={handleAudioCommit}
              >
                <Volume2
                  aria-hidden="true"
                  className="ui-icon"
                  focusable="false"
                  size={18}
                />
                <span>
                  {matchReport && matchReport.readyCount > 0
                    ? matchReport.draftCount > 0
                      ? `生成 ${matchReport.readyCount} 条有效字幕与配音`
                      : `生成 ${matchReport.readyCount} 条字幕与配音`
                    : '生成字幕与配音'}
                </span>
              </button>
            ) : null}
            <button
              className={`dialogue-authoring-submit dialogue-batch-submit${
                hasAudioMode ? ' dialogue-batch-plain-submit' : ''
              }`}
              data-testid="dialogue-batch-commit"
              disabled={!resolution.allResolved}
              type="button"
              onClick={handleCommit}
            >
              {resolution.allResolved ? (
                <>
                  <CirclePlus
                    aria-hidden="true"
                    className="ui-icon"
                    focusable="false"
                    size={18}
                  />
                  <span>{`添加 ${resolution.readyCount} 条字幕`}</span>
                </>
              ) : (
                <span>{`还有 ${pendingCount} 条待确认`}</span>
              )}
            </button>
          </footer>
        </>
      ) : null}
    </div>
  );
}
