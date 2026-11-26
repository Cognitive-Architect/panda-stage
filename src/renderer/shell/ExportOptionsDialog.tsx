import { useLayoutEffect, useRef, useState } from 'react';
import type { Project, Shot } from '../../domain';
import type { ExportPreferences } from '../../domain/models/exportPreferences';
import { EXPORT_PREPARATION_RENDER_SETTINGS, type PngSequenceOptions } from '../../shared/export-preparation-types';
import { planPngSequenceFrames, planSpriteSheetPages } from '../../shared/export-types';
import { DEFAULT_EXPORT_VIDEO_OPTIONS, ExportOutputFpsSchema, ExportVideoOptionsSchema } from '../../shared/export-output-profile';
import { Button } from '../ui/Button';
import './export-options-dialog.css';

export function ExportOptionsDialog({ project, shot, selectedLayerId, initial, playheadMs, onCancel, onExport }: {
  project: Project;
  shot: Shot | undefined;
  selectedLayerId?: string | null;
  initial: Readonly<ExportPreferences>;
  playheadMs: number;
  onCancel: () => void;
  onExport: (preferences: ExportPreferences, png?: PngSequenceOptions) => void;
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preferences, setPreferences] = useState<ExportPreferences>(initial);
  const [startMs, setStartMs] = useState(playheadMs < (shot?.durationMs ?? 0) ? playheadMs : 0);
  const [endMs, setEndMs] = useState(shot?.durationMs ?? 0);
  const [trimAlpha, setTrimAlpha] = useState(true);
  const [outputScale, setOutputScale] = useState(1);
  const [atlasFormat, setAtlasFormat] = useState<'pixi' | 'panda'>('pixi');
  const exportableLayers = (shot?.layers ?? []).filter(
    (layer) => layer.visible && layer.id !== shot?.backgroundLayerId,
  );
  const defaultLayerId =
    selectedLayerId && exportableLayers.some((layer) => layer.id === selectedLayerId)
      ? selectedLayerId
      : '';
  const [targetLayerId, setTargetLayerId] = useState<string>('');
  const [error, setError] = useState('');
  const spriteSheet = preferences.format === 'sprite-sheet';
  const gif = preferences.format === 'gif';
  const png = preferences.format === 'png-sequence' || spriteSheet;
  const videoOutput = preferences.videoOutput ?? DEFAULT_EXPORT_VIDEO_OPTIONS;
  const ranged = preferences.rangeMode === 'range';

  useLayoutEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => { if (node?.open) node.close(); };
  }, []);

  function begin(): void {
    try {
      if (!png) { onExport(preferences); return; }
      if (!shot) throw new Error('请选择一个可导出的镜头。');
      const selectedLayer = spriteSheet && targetLayerId
        ? exportableLayers.find((layer) => layer.id === targetLayerId)
        : undefined;
      const output: PngSequenceOptions = {
        shotId: shot.id,
        ...(selectedLayer ? { layerId: selectedLayer.id } : {}),
        transparent: spriteSheet || preferences.transparent,
        ...(spriteSheet
          ? {
              spriteSheet: true,
              spriteSheetOptions: {
                trim: trimAlpha,
                scale: outputScale,
                padding: 2,
                extrusion: 1,
                format: atlasFormat,
                ...(selectedLayer ? { animationName: selectedLayer.name } : {}),
              },
            }
          : {}),
        ...(ranged ? { range: { startMs, endMs } } : {}),
      };
      const { totalFrames } = planPngSequenceFrames(project, output);
      if (spriteSheet) {
        const { width, height } = EXPORT_PREPARATION_RENDER_SETTINGS;
        planSpriteSheetPages(totalFrames, width, height);
      }
      onExport(preferences, output);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法开始导出。');
    }
  }

  return <dialog ref={dialog} className="export-options-dialog" aria-labelledby="export-options-title"
    data-testid="export-options-dialog" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <form onSubmit={event => { event.preventDefault(); begin(); }}>
      <h2 id="export-options-title">导出设置</h2>
      <label>格式<select value={preferences.format} onChange={event => {
        setPreferences(value => ({ ...value, format: event.target.value as ExportPreferences['format'] })); setError('');
      }}>
        <option value="mp4">MP4 视频</option>
        <option value="webm">WebM 视频</option>
        <option value="gif">GIF 视频</option>
        <option value="png-sequence">PNG 序列</option>
        <option value="sprite-sheet">精灵图（PNG + JSON）</option>
      </select></label>
      {png ? <>
        <label>范围<select value={preferences.rangeMode} onChange={event => {
          setPreferences(value => ({ ...value, rangeMode: event.target.value as ExportPreferences['rangeMode'] })); setError('');
        }}>
          <option value="shot">当前镜头</option>
          <option value="range">当前镜头时间段</option>
        </select></label>
        {ranged ? <div className="export-options-range">
          <label>起点（毫秒）<input type="number" min={0} max={shot?.durationMs} value={startMs}
            onChange={event => { setStartMs(Number(event.target.value)); setError(''); }} /></label>
          <label>终点（毫秒）<input type="number" min={1} max={shot?.durationMs} value={endMs}
            onChange={event => { setEndMs(Number(event.target.value)); setError(''); }} /></label>
        </div> : null}
        {spriteSheet ? <>
          {exportableLayers.length > 0 ? <label>导出对象<select value={targetLayerId} onChange={event => {
            setTargetLayerId(event.target.value); setError('');
          }}>
            <option value="">当前镜头全部内容</option>
            {defaultLayerId ? <option value={defaultLayerId}>
              仅当前选中对象：{exportableLayers.find((layer) => layer.id === defaultLayerId)?.name}
            </option> : null}
            {exportableLayers
              .filter((layer) => layer.id !== defaultLayerId)
              .map((layer) => <option key={layer.id} value={layer.id}>仅对象：{layer.name}</option>)}
          </select></label> : null}
          {targetLayerId ? <p>仅导出选中对象的透明帧，不含背景及其他图层。</p> : null}
          <label>图集格式<select value={atlasFormat} onChange={event => {
            setAtlasFormat(event.target.value as 'pixi' | 'panda'); setError('');
          }}>
            <option value="pixi">PixiJS 多页图集（PNG + JSON）</option>
            <option value="panda">通用清单（PNG + JSON）</option>
          </select></label>
          <label>输出缩放<select value={String(outputScale)} onChange={event => {
            setOutputScale(Number(event.target.value)); setError('');
          }}>
            <option value="1">100%（原尺寸）</option>
            <option value="0.75">75%</option>
            <option value="0.5">50%</option>
            <option value="0.25">25%</option>
          </select></label>
          <label className="export-options-alpha"><input type="checkbox" checked={trimAlpha}
            onChange={event => setTrimAlpha(event.target.checked)} />透明裁边（2px 留白 / 1px 边缘扩展）</label>
        </> : <label className="export-options-alpha"><input type="checkbox" checked={preferences.transparent}
          onChange={event => setPreferences(value => ({ ...value, transparent: event.target.checked }))} />透明底</label>}
      </> : <>
        <label>分辨率<select value={videoOutput.width} onChange={event => {
          const next = ExportVideoOptionsSchema.parse({ ...videoOutput, width: Number(event.target.value) });
          setPreferences(value => ({ ...value, videoOutput: next })); setError('');
        }}>
          <option value="1920">1920 × 1080</option>
          <option value="1280">1280 × 720</option>
        </select></label>
        <label>帧率<select value={gif && videoOutput.fps === 60 ? 30 : videoOutput.fps} onChange={event => {
          const fps = ExportOutputFpsSchema.parse(Number(event.target.value));
          setPreferences(value => ({ ...value, videoOutput: { ...videoOutput, fps } })); setError('');
        }}>
          <option value="24">24 fps</option>
          <option value="30">30 fps</option>
          {gif ? null : <option value="60">60 fps</option>}
        </select></label>
        {gif ? <label className="export-options-alpha"><input type="checkbox" checked={preferences.gifLoop ?? true}
          onChange={event => setPreferences(value => ({ ...value, gifLoop: event.target.checked }))} />循环播放</label> : null}
      </>}
      {error ? <p role="alert">{error}</p> : null}
      <div className="export-options-actions">
        <Button type="button" onClick={onCancel} variant="secondary">取消</Button>
        <Button type="submit">选择输出位置</Button>
      </div>
    </form>
  </dialog>;
}
