import { useState } from 'react';
import type { FlaVideoMetadata } from '../../shared/fla-import-api';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { shotStore } from '../stores/shotStore';
import { importFlaEmbeddedVideoToEditor } from '../features/fla-import/importFlaEmbeddedVideo';
import { Button } from '../ui/Button';

export function FlaVideoReview({
  sessionId,
  videos,
  snapshot,
  importing,
  onImporting,
}: {
  sessionId: string;
  videos: readonly FlaVideoMetadata[];
  snapshot: EditorProjectSnapshot | null;
  importing: boolean;
  onImporting: (importing: boolean) => void;
}): React.JSX.Element {
  const [selectedName, setSelectedName] = useState(videos[0]?.name ?? '');
  const [playbackMode, setPlaybackMode] = useState<'play-once' | 'loop' | 'single-frame'>('play-once');
  const [includeAudio, setIncludeAudio] = useState(true);
  const [error, setError] = useState('');
  const [diagnostics, setDiagnostics] = useState<readonly string[]>([]);
  const [importedNames, setImportedNames] = useState<Set<string>>(() => new Set());
  const selected = videos.find((video) => video.name === selectedName) ?? videos[0];
  const targetShotId = shotStore.getCurrentShotId() ?? snapshot?.project.shots[0]?.id ?? null;

  async function importVideo(): Promise<void> {
    if (!selected || !snapshot || !targetShotId || importing) return;
    setError('');
    setDiagnostics([]);
    onImporting(true);
    try {
      const response = await importFlaEmbeddedVideoToEditor({
        sessionId,
        videoName: selected.name,
        shotId: targetShotId,
        playbackMode,
        includeAudio,
      });
      if (!response.ok) {
        setError(response.error.message);
        return;
      }
      setDiagnostics(response.diagnostics ?? []);
      setImportedNames((current) => new Set(current).add(selected.name));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '未能导入所选嵌入视频。');
    } finally {
      onImporting(false);
    }
  }

  return (
    <div className="fla-sound-review" data-testid="fla-video-review">
      <label>
        视频
        <select
          value={selected?.name ?? ''}
          disabled={importing}
          onChange={(event) => {
            setError('');
            setDiagnostics([]);
            setSelectedName(event.target.value);
          }}
        >
          {videos.map((video) => (
            <option key={video.name} value={video.name}>
              {video.name}
              {video.width > 0 && video.height > 0 ? ` (${video.width}×${video.height})` : ''}
            </option>
          ))}
        </select>
      </label>
      <label>
        播放模式
        <select
          value={playbackMode}
          disabled={importing}
          onChange={(event) =>
            setPlaybackMode(event.target.value as 'play-once' | 'loop' | 'single-frame')
          }
        >
          <option value="play-once">单次播放</option>
          <option value="loop">循环播放</option>
          <option value="single-frame">定格单帧</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={includeAudio}
          disabled={importing}
          onChange={(event) => setIncludeAudio(event.target.checked)}
        />
        同步导入音轨
      </label>
      <div>
        <Button
          type="button"
          disabled={!snapshot || !selected || !targetShotId || importing}
          onClick={() => void importVideo()}
        >
          {importing
            ? '正在导入…'
            : selected && importedNames.has(selected.name)
              ? '再次导入到当前镜头'
              : '导入视频到当前镜头'}
        </Button>
      </div>
      {diagnostics.length > 0 ? (
        <ul>
          {diagnostics.map((item, idx) => (
            <li key={`${idx}-${item}`}>{item}</li>
          ))}
        </ul>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
