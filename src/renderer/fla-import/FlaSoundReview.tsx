import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FlaInspectionIR, FlaSoundMetadata } from '../../shared/fla-import-api';
import type { AssetImportResponse } from '../../shared/asset-import-api';
import type { FlaSoundTimelineDiagnostic, FlaSoundTimelineImportResponse } from '../../shared/fla-sound-api';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { shotStore } from '../stores/shotStore';
import { Button } from '../ui/Button';

export function FlaSoundReview({
  sessionId,
  sounds,
  timelines = [],
  symbolTimelines = [],
  snapshot,
  importing,
  createPreviewUrl,
  onImporting,
  onImported,
  onSceneTimelineImported,
}: {
  sessionId: string;
  sounds: readonly FlaSoundMetadata[];
  timelines?: FlaInspectionIR['timelines'];
  symbolTimelines?: FlaInspectionIR['symbolTimelines'];
  snapshot: EditorProjectSnapshot | null;
  importing: boolean;
  createPreviewUrl: (bytes: Uint8Array<ArrayBuffer>, mimeType: string) => string;
  onImporting: (importing: boolean) => void;
  onImported: (response: AssetImportResponse) => Promise<void>;
  onSceneTimelineImported?: (response: FlaSoundTimelineImportResponse) => void;
}): React.JSX.Element {
  const [selectedId, setSelectedId] = useState(sounds[0]?.id ?? '');
  const [url, setUrl] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [imported, setImported] = useState<Set<string>>(() => new Set());
  const [selectedTimelineIndex, setSelectedTimelineIndex] = useState(0);
  const [timelineStatus, setTimelineStatus] = useState('');
  const [timelineDiagnostics, setTimelineDiagnostics] = useState<readonly FlaSoundTimelineDiagnostic[]>([]);
  const active = useRef<{ requestId: string; url?: string; audio?: HTMLAudioElement } | null>(null);
  const selected = sounds.find((sound) => sound.id === selectedId);
  const hasNestedSymbolAudio = symbolTimelines.length > 0;
  const scenesWithSound = useMemo(
    () =>
      timelines
        .map((timeline, index) => ({
          index,
          name: timeline.name || `Scene ${index + 1}`,
          eventCount: timeline.layers.reduce(
            (sum, layer) =>
              sum +
              layer.frames.filter(
                (frame) =>
                  Boolean(frame.sound) ||
                  (hasNestedSymbolAudio && (frame.symbolInstances?.length ?? 0) > 0),
              ).length,
            0,
          ),
        }))
        .filter((scene) => scene.eventCount > 0),
    [hasNestedSymbolAudio, timelines],
  );
  const activeTimelineIndex = scenesWithSound.some((scene) => scene.index === selectedTimelineIndex)
    ? selectedTimelineIndex
    : (scenesWithSound[0]?.index ?? 0);
  const targetShotId = shotStore.getCurrentShotId() ?? snapshot?.project.shots[0]?.id ?? null;

  const releasePreview = useCallback(() => {
    const request = active.current;
    if (!request) return;
    active.current = null;
    request.audio?.pause();
    if (request.url) URL.revokeObjectURL(request.url);
    else void window.pandaStage.fla.cancelSoundPreview({ sessionId, requestId: request.requestId }).catch(() => undefined);
  }, [sessionId]);

  useEffect(() => releasePreview, [releasePreview]);

  async function preview(): Promise<void> {
    if (!selected) return;
    releasePreview();
    setError('');
    setUrl(undefined);
    setLoading(true);
    const requestId = crypto.randomUUID();
    active.current = { requestId };
    try {
      const response = await window.pandaStage.fla.previewSound({ sessionId, requestId, soundId: selected.id });
      if (active.current?.requestId !== requestId) return;
      if (!response.ok) throw new Error(response.error.message);
      const objectUrl = createPreviewUrl(response.bytes, response.mimeType);
      active.current.url = objectUrl;
      setUrl(objectUrl);
    } catch (cause) {
      if (active.current?.requestId === requestId) {
        setError(cause instanceof Error ? cause.message : '无法试听所选声音。');
      }
    } finally {
      if (active.current?.requestId === requestId) setLoading(false);
    }
  }

  async function importSound(): Promise<void> {
    if (!selected || !snapshot || importing) return;
    setError('');
    onImporting(true);
    try {
      const response = await window.pandaStage.fla.importSound({
        sessionId,
        soundId: selected.id,
        projectRoot: snapshot.projectRoot,
        project: snapshot.project,
        baseRevision: snapshot.revision,
      });
      await onImported(response);
      if (!response.ok) throw new Error(response.error.message);
      if (response.status !== 'completed') return;
      const result = response.results[0];
      if (!result || (result.status !== 'imported' && result.status !== 'duplicate')) {
        throw new Error(result?.message ?? '未能导入所选声音。');
      }
      setImported((current) => new Set(current).add(selected.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '未能导入所选声音。');
    } finally {
      onImporting(false);
    }
  }

  async function importSceneTimeline(): Promise<void> {
    if (!snapshot || !targetShotId || importing || scenesWithSound.length === 0) return;
    setError('');
    setTimelineStatus('');
    setTimelineDiagnostics([]);
    onImporting(true);
    try {
      const response = await window.pandaStage.fla.importSceneSoundTimeline({
        sessionId,
        shotId: targetShotId,
        timelineIndex: activeTimelineIndex,
        projectRoot: snapshot.projectRoot,
        project: snapshot.project,
        baseRevision: snapshot.revision,
      });
      onSceneTimelineImported?.(response);
      if (!response.ok) throw new Error(response.error.message);
      setTimelineDiagnostics(response.diagnostics);
      setTimelineStatus(
        response.createdClipIds.length > 0
          ? `已恢复 ${response.createdClipIds.length} 段原声到当前镜头。`
          : '未生成可放置的原声片段。',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '未能恢复场景原声。');
    } finally {
      onImporting(false);
    }
  }

  return (
    <div className="fla-sound-review">
      <label>声音<select value={selectedId} disabled={importing} onChange={(event) => {
        releasePreview();
        setLoading(false);
        setUrl(undefined);
        setError('');
        setSelectedId(event.target.value);
      }}>
        {sounds.map((sound) => <option key={sound.id} value={sound.id}>{sound.name}</option>)}
      </select></label>
      <div>
        {url ? <audio ref={(node) => { if (node && active.current) active.current.audio = node; }} autoPlay controls src={url} onError={() => setError('无法播放所选声音。')} /> : (
          <Button type="button" variant="secondary" disabled={!selected || importing} onClick={() => {
            if (loading) {
              releasePreview();
              setLoading(false);
            } else void preview();
          }}>{loading ? '取消试听' : '试听'}</Button>
        )}
        <Button type="button" disabled={!snapshot || !selected || importing || imported.has(selectedId)}
          onClick={() => void importSound()}>
          {imported.has(selectedId) ? '已入库' : importing ? '正在导入…' : '导入声音'}
        </Button>
      </div>
      {scenesWithSound.length > 0 ? (
        <div className="fla-sound-scene-recovery">
          {scenesWithSound.length > 1 ? (
            <label>主场景<select
              value={activeTimelineIndex}
              disabled={importing}
              onChange={(event) => setSelectedTimelineIndex(Number(event.target.value))}
            >
              {scenesWithSound.map((scene) => (
                <option key={scene.index} value={scene.index}>
                  {scene.name} ({scene.eventCount})
                </option>
              ))}
            </select></label>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            disabled={!snapshot || !targetShotId || importing}
            onClick={() => void importSceneTimeline()}
          >
            恢复场景原声到当前镜头
          </Button>
          {timelineStatus ? <p>{timelineStatus}</p> : null}
          {timelineDiagnostics.length > 0 ? (
            <ul>
              {timelineDiagnostics.map((item, idx) => (
                <li key={`${item.code}-${item.frameIndex}-${idx}`}>{item.message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
