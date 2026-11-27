import { Volume2 } from 'lucide-react';
import {
  formatAudioDurationMs,
  isAudioAssetReady,
  type AudioAsset,
  type DialogueAudioMatchRow,
  type PlannedDialogueAudioRow,
} from '../../../domain';

function formatAudioOptionLabel(asset: AudioAsset): string {
  if (!isAudioAssetReady(asset)) {
    return `${asset.name}（未就绪）`;
  }
  return `${asset.name}（${formatAudioDurationMs(asset.durationMs!)}）`;
}

export interface DialogueBatchAudioRowProps {
  lineNumber: number;
  matchRow: DialogueAudioMatchRow;
  plannedRow?: PlannedDialogueAudioRow;
  audioAssets: readonly AudioAsset[];
  onSelectAudio: (assetId: string | null) => void;
}

export function DialogueBatchAudioRow({
  lineNumber,
  matchRow,
  plannedRow,
  audioAssets,
  onSelectAudio,
}: DialogueBatchAudioRowProps): React.JSX.Element {
  return (
    <div
      className="dialogue-batch-audio-row"
      data-testid={`dialogue-batch-audio-row-${lineNumber}`}
    >
      <Volume2
        aria-hidden="true"
        className="dialogue-batch-audio-icon"
        size={14}
        strokeWidth={1.8}
      />
      <select
        aria-label={`第 ${lineNumber} 行配音`}
        className="dialogue-batch-audio-select"
        data-testid={`dialogue-batch-audio-${lineNumber}`}
        value={matchRow.audioAssetId ?? ''}
        onChange={(event) => {
          const value = event.target.value;
          onSelectAudio(value === '' ? null : value);
        }}
      >
        <option value="">未选择配音（留草稿）</option>
        {audioAssets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {formatAudioOptionLabel(asset)}
          </option>
        ))}
      </select>
      {matchRow.ready && matchRow.durationMs !== null ? (
        <span
          className="dialogue-batch-audio-timing"
          data-testid={`dialogue-batch-audio-timing-${lineNumber}`}
        >
          {plannedRow
            ? `${formatAudioDurationMs(plannedRow.startMs)}–${formatAudioDurationMs(plannedRow.endMs)} · ${formatAudioDurationMs(matchRow.durationMs)}`
            : formatAudioDurationMs(matchRow.durationMs)}
        </span>
      ) : matchRow.issueMessage ? (
        <span
          className="dialogue-batch-audio-issue"
          data-testid={`dialogue-batch-audio-issue-${lineNumber}`}
        >
          {matchRow.issueMessage}
        </span>
      ) : null}
    </div>
  );
}
