import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { AudioClipService, ProjectSchema } from '../../../../src/domain';
import { buildProject, IDS } from '../../domain/testProject';
import { standaloneAudioPreview, canCommitStandaloneAudioGesture } from '../../../../src/renderer/features/timeline/standaloneAudioGesture';
import { standaloneAudioDrop } from '../../../../src/renderer/features/timeline/StandaloneAudioLane';
import { TimelineDock, type TimelineDockProps } from '../../../../src/renderer/features/timeline/TimelineDock';
import { editorProjectStore } from '../../../../src/renderer/stores/EditorProjectStore';
import { selectionStore } from '../../../../src/renderer/stores/selectionStore';
import { timelineUiStore } from '../../../../src/renderer/features/timeline/timelineUiStore';
import { audioClipSelectionStore } from '../../../../src/renderer/stores/audioClipSelectionStore';
import { audioClipStore } from '../../../../src/renderer/stores/audioClipStore';
import { shotStore } from '../../../../src/renderer/stores/shotStore';

const assetId = '10000000-0000-4000-8000-000000000658';
const clipId = '70000000-0000-4000-8000-000000000658';
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));
vi.mock('../../../../src/renderer/features/timeline/PendingDialoguePlacement', () => ({
  usePendingDialoguePlacement: () => ({ drag: null, registerDropTarget: () => undefined }),
}));
function fixture(role: 'sfx' | 'bgm' = 'sfx') {
  const project = buildProject();
  return new AudioClipService({ createId: () => clipId }).create(ProjectSchema.parse({ ...project, assets: [...project.assets, {
    id: assetId, name: 'Test audio', kind: 'audio', relativePath: 'audio.wav', mimeType: 'audio/wav', durationMs: 1500,
  }] }), { shotId: IDS.shot, assetId, role, startMs: 500 });
}
afterEach(() => { editorProjectStore.clear(); timelineUiStore.setExpanded(true); });

describe('A02 standalone audio Timeline', () => {
  it.each([['move', 200, 1500, 3000, 0], ['start', 100, 1000, 2000, 500], ['start', -500, 500, 2000, 0], ['end', -100, 500, 1500, 0], ['end', 999, 500, 2000, 0]] as const)(
    'projects legal %s draft without writing Project/History', (kind, dx, startMs, endMs, offsetMs) => {
      const project = fixture();
      editorProjectStore.open('D:/acceptance', project);
      const before = editorProjectStore.getSnapshot();
      expect(standaloneAudioPreview(project, IDS.shot, project.shots[0]!.audioClips[0]!, kind, dx, 0.2)).toMatchObject({ startMs, endMs, offsetMs });
      expect(editorProjectStore.getSnapshot()).toBe(before);
      expect(before?.revision).toBe(0);
    },
  );
  it.each([1, 2, 4, 8])('uses content coordinates after horizontal scroll at zoom %s', zoom => {
    const scale = 0.1 * zoom;
    expect(standaloneAudioDrop(JSON.stringify({ version: 2, type: 'audio', assetId }), 250, 250 - 1000 * scale, scale, 3000)).toEqual({ assetId, startMs: 1000 });
  });
  it('rejects non-audio payload and unavailable geometry; clamps edge drops', () => {
    expect(() => standaloneAudioDrop(JSON.stringify({ version: 2, type: 'image', assetId }), 100, 0, 1, 3000)).toThrow();
    expect(() => standaloneAudioDrop('bad', 100, 0, 1, 3000)).toThrow();
    expect(() => standaloneAudioDrop(JSON.stringify({ version: 2, type: 'audio', assetId }), 100, 0, 0, 3000)).toThrow();
    expect(standaloneAudioDrop(JSON.stringify({ version: 2, type: 'audio', assetId }), -100, 0, 1, 3000).startMs).toBe(0);
  });
  const identity = { projectInstanceId: 1, revision: 2, shotId: IDS.shot, clipId };
  it('allows exactly the live selected clip context', () => {
    expect(canCommitStandaloneAudioGesture(identity, { ...identity, selectedClipId: clipId })).toBe(true);
  });
  it.each([{ projectInstanceId: 2 }, { revision: 3 }, { shotId: 'another' }, { clipId: 'another' }, { selectedClipId: null }])('rejects stale/cancelled context %j', patch => {
    expect(canCommitStandaloneAudioGesture(identity, { ...identity, selectedClipId: clipId, ...patch })).toBe(false);
  });
  it.each([false, true])('renders ordered role lanes with Position=%s without touching editing state', position => {
    editorProjectStore.open('D:/acceptance', fixture());
    if (position) selectionStore.select(IDS.layerChar);
    const snapshot = editorProjectStore.getSnapshot();
    const html = renderToStaticMarkup(createElement(TimelineDock));
    const ordered = ['timeline-subtitle-track', 'timeline-audio-track', 'timeline-sfx-track', 'timeline-bgm-track'];
    const indices = ordered.map(name => html.indexOf(`data-testid="${name}"`));
    expect(indices.every(index => index >= 0)).toBe(true);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(html.includes('data-testid="position-lane"')).toBe(position);
    expect(html.match(/data-testid="timeline-ruler"/g)).toHaveLength(1);
    expect(html.match(/data-timeline-scroll-owner=/g)).toHaveLength(1);
    expect(html.match(/data-testid="standalone-audio-clip"/g)).toHaveLength(1);
    expect(html).toContain('>对白<');
    expect(editorProjectStore.getSnapshot()).toBe(snapshot);
  });
  it('keeps volume 0..2, mutations in A01 owner and media scrolling in local CSS', () => {
    const css = readFileSync('src/renderer/styles/features/timeline/standalone-audio.css', 'utf8');
    expect(css).toContain('overflow-y: auto');
    expect(css).toContain('var(--timeline-scroll-px');
    expect(css).not.toContain('--timeline-expanded-min-height');
    const controls = readFileSync('src/renderer/features/timeline/StandaloneAudioControls.tsx', 'utf8');
    expect(controls).toContain('min={0} max={2}');
    expect(controls).toContain('audioClipStore.setVolume');
    expect(controls).toContain('audioClipStore.remove');
    const dock = readFileSync('src/renderer/features/timeline/TimelineDock.tsx', 'utf8');
    expect(dock).toContain("clip.role === 'dialogue'");
    expect(dock).toContain('!productPreviewOpen');
  });
  it.each(['bgm', 'sfx'] as const)('renders selected %s identity inline before the far-right zoom', role => {
    editorProjectStore.open('D:/acceptance', fixture(role));
    audioClipSelectionStore.select(clipId);
    const before = editorProjectStore.getSnapshot();
    const html = renderToStaticMarkup(createElement(TimelineDock));
    const header = html.match(/<header\b[^>]*>(.*?)<\/header>/)![1]!;
    expect(header).toContain(`${role === 'bgm' ? 'BGM' : '音效'} · Test audio`);
    expect(header).toContain('aria-label="音频片段音量"');
    expect(header).toContain('aria-label="删除音频片段"');
    expect(header.indexOf('timeline-return-to-start')).toBeLessThan(header.indexOf('standalone-audio-controls'));
    expect(header.indexOf('standalone-audio-controls')).toBeLessThan(header.indexOf('timeline-zoom'));
    expect(html.match(/data-testid="standalone-audio-controls"/g)).toHaveLength(1);
    expect(editorProjectStore.getSnapshot()).toBe(before);
  });
  it.each(['deselect', 'delete', 'shot-change', 'project-reopen'] as const)('removes contextual controls on %s', action => {
    const project = fixture();
    editorProjectStore.open('D:/acceptance', project);
    audioClipSelectionStore.select(clipId);
    expect(renderToStaticMarkup(createElement(TimelineDock))).toContain('data-testid="standalone-audio-controls"');
    if (action === 'deselect') audioClipSelectionStore.clear();
    else if (action === 'delete') audioClipStore.remove(clipId);
    else if (action === 'shot-change') shotStore.duplicate(IDS.shot);
    else editorProjectStore.open('D:/acceptance', project);
    expect(renderToStaticMarkup(createElement(TimelineDock))).not.toContain('data-testid="standalone-audio-controls"');
  });
  it.each(['collapsed', 'preview'] as const)('isolates contextual controls when %s', mode => {
    editorProjectStore.open('D:/acceptance', fixture());
    audioClipSelectionStore.select(clipId);
    if (mode === 'collapsed') timelineUiStore.setExpanded(false);
    expect(renderToStaticMarkup(createElement<TimelineDockProps>(TimelineDock, { productPreviewOpen: mode === 'preview' }))).not.toContain('data-testid="standalone-audio-controls"');
  });
  it('does not retain any selected-audio portal placement and truncates names locally', () => {
    const source = readFileSync('src/renderer/features/timeline/StandaloneAudioControls.tsx', 'utf8');
    expect(source).not.toContain('createPortal');
    expect(source).not.toContain('document.body');
    expect(source).not.toContain('getBoundingClientRect');
    const css = readFileSync('src/renderer/styles/features/timeline/standalone-audio.css', 'utf8');
    const group = css.slice(css.indexOf('.timeline-toolbar .standalone-audio-controls {'), css.indexOf('.standalone-audio-identity {'));
    expect(group).not.toMatch(/position:\s*(fixed|absolute)/);
    expect(css).toContain('text-overflow: ellipsis');
    expect(css).toContain('min-width: 0');
    expect(css).toContain('.standalone-audio-controls + .timeline-zoom');
  });
});
