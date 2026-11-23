import { useEffect, useState } from 'react';
import {
  FLA_SOURCE_FRAME_SUGGESTION_PAGE_SIZE,
  type FlaRenderTarget,
  type FlaSourceFrameSuggestion,
} from '../../shared/fla-static-snapshot-api';
import { Button } from '../ui/Button';
import { flaStaticSnapshotClient } from './fla-static-snapshot-render';
import { readableFlaCandidateLabel } from './fla-workbench-candidates';

export function FlaSourceFrameSuggestions({ sessionId, target, disabled, onChooseFrame, onStartSequence }: {
  sessionId: string;
  target: FlaRenderTarget;
  disabled: boolean;
  onChooseFrame: (target: FlaRenderTarget, frameIndex: number, suggestedName?: string) => void;
  onStartSequence?: (target: FlaRenderTarget, frameIndex: number) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const currentFrame = (target.selectedFrameIndex ?? 0) + 1;
  const [pointFrame, setPointFrame] = useState<string>();
  const requestedFrame = Number(pointFrame ?? currentFrame);
  const validFrame = Number.isInteger(requestedFrame) && requestedFrame >= 1 && requestedFrame <= target.frameCount;
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<{ items: FlaSourceFrameSuggestion[]; hasMore: boolean }>();
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const { sourceLibraryItemName, sourceTimelineIndex, kind } = target;
  useEffect(() => {
    if (!open) return;
    setPage(undefined);
    setFailed(false);
    let current = true;
    const timer = window.setTimeout(() => {
      const source = kind === 'graphic-symbol' ? { sourceLibraryItemName } : { sourceTimelineIndex: sourceTimelineIndex ?? 0 };
      void flaStaticSnapshotClient.catalog(sessionId, {
        frameSuggestionsFor: { ...source, search, offset },
      }).then(response => {
        if (!current) return;
        if (response.ok && response.frameSuggestions) setPage(response.frameSuggestions);
        else setFailed(true);
      }).catch(() => {
        if (current) setFailed(true);
      });
    }, 160);
    return () => { current = false; window.clearTimeout(timer); };
  }, [open, sessionId, kind, sourceLibraryItemName, sourceTimelineIndex, search, offset, retry]);

  const sourceName = readableFlaCandidateLabel(sourceLibraryItemName ?? target.userLabel.replace(/ · 第 \d+ 帧$/u, ''));
  return (
    <details className="fla-c03-source-frames" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>查找或定位源帧</summary>
      {open ? <>
        {target.frameCount > 1 ? <div className="fla-c03-source-frame-pages">
          <label>源帧 <input type="number" aria-label="源帧号" min={1} max={target.frameCount}
            value={pointFrame ?? currentFrame} onChange={event => setPointFrame(event.target.value)} /></label>
          <Button variant="secondary" disabled={disabled || !validFrame}
            onClick={() => onChooseFrame(target, requestedFrame - 1)}>预览此帧</Button>
          {onStartSequence ? <Button variant="secondary" disabled={disabled || !validFrame}
            onClick={() => onStartSequence(target, requestedFrame - 1)}>从此帧取片段</Button> : null}
        </div> : null}
        <input type="search" aria-label="搜索当前元件的帧标签或帧号" placeholder="标签或帧号" maxLength={120}
          value={search} onChange={event => { setSearch(event.target.value); setOffset(0); }} />
        {failed ? <div role="alert">
          关键帧读取失败。
          <Button variant="secondary" onClick={() => setRetry(value => value + 1)}>重试</Button>
        </div> : null}
        {page && page.items.length === 0 ? <p>找不到对应关键帧。</p> : null}
        {page?.items.length ? (
          <ul className="fla-c03-source-frame-results">
            {page.items.map(({ sourceFrameIndex, label }) => {
              const name = label?.type === 'name' ? label.text : undefined;
              return (
                <li key={JSON.stringify([sourceFrameIndex, label?.type, label?.text])}>
                  <Button variant="secondary" disabled={disabled || sourceFrameIndex >= target.frameCount}
                    onClick={() => { setPointFrame(undefined); onChooseFrame(target, sourceFrameIndex, name); }}>
                    {name ? `${name} · ` : ''}{sourceName} · 第 {sourceFrameIndex + 1} 帧
                    {label && label.type !== 'name' ? `（${label.type === 'comment' ? '注释' : '锚点'}：${label.text}）` : ''}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {offset > 0 || page?.hasMore ? <div className="fla-c03-source-frame-pages">
          <Button variant="secondary" disabled={offset === 0 || !page}
            onClick={() => setOffset(value => value - FLA_SOURCE_FRAME_SUGGESTION_PAGE_SIZE)}>上一页</Button>
          <Button variant="secondary" disabled={!page?.hasMore}
            onClick={() => setOffset(value => value + FLA_SOURCE_FRAME_SUGGESTION_PAGE_SIZE)}>下一页</Button>
        </div> : null}
      </> : null}
    </details>
  );
}
