import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlaSoundMetadata } from '../../shared/fla-import-api';
import type { AssetImportResponse } from '../../shared/asset-import-api';
import type { EditorProjectSnapshot } from '../stores/EditorProjectStore';
import { Button } from '../ui/Button';

export function FlaSoundReview({ sessionId, sounds, snapshot, importing, createPreviewUrl, onImporting, onImported }: {
  sessionId: string;
  sounds: readonly FlaSoundMetadata[];
  snapshot: EditorProjectSnapshot | null;
  importing: boolean;
  createPreviewUrl: (bytes: Uint8Array<ArrayBuffer>, mimeType: string) => string;
  onImporting: (importing: boolean) => void;
  onImported: (response: AssetImportResponse) => Promise<void>;
}): React.JSX.Element {
  const [selectedId, setSelectedId] = useState(sounds[0]?.id ?? '');
  const [url, setUrl] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [imported, setImported] = useState<Set<string>>(() => new Set());
  const active = useRef<{ requestId: string; url?: string; audio?: HTMLAudioElement } | null>(null);
  const selected = sounds.find((sound) => sound.id === selectedId);

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
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
