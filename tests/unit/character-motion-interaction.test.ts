// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { evaluateShotAtTime, resolveLayerVisualParts, transformPointByVisualPart } from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { CharacterMotionGesture } from '../../src/renderer/features/canvas/characterMotionGesture';
import { CharacterMotionPart } from '../../src/renderer/features/canvas/CharacterMotionPart';
import { characterPartAnimationFixture } from '../helpers/characterPartAnimationFixture';
import { IDS } from './domain/testProject';

import { measureImageVisibleBounds } from '../../src/renderer/features/characters/measureImageVisibleBounds';
import { visibleImageRect } from '../../src/renderer/features/characters/characterAssemblyPreview';

const nodes = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock('react-konva', async () => {
  const { createElement: element } = await import('react');
  const primitive = (props: Record<string, unknown>) => {
    if (typeof props.name === 'string') nodes.set(props.name, props);
    return element('div', null, props.children as never);
  };
  return { Group: primitive, Rect: primitive, Circle: primitive, Line: primitive };
});

it('measures the opaque patch of a padded Image Part using the assembly alpha bounds', () => {
  const pixels = new Uint8ClampedArray(100 * 80 * 4);
  for (let y = 23; y < 28; y += 1) {
    for (let x = 41; x < 49; x += 1) pixels[(y * 100 + x) * 4 + 3] = 255;
  }
  const getImageData = vi.fn(() => ({ data: pixels }));
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({ drawImage: vi.fn(), getImageData } as never);
  try {
    const image = { complete: true, naturalWidth: 100, naturalHeight: 80 } as HTMLImageElement;
    const bounds = measureImageVisibleBounds(image);
    expect(visibleImageRect({ x: 0, y: 0, width: 200, height: 160 }, bounds))
      .toEqual({ x: 82, y: 46, width: 16, height: 10 });
    expect(measureImageVisibleBounds(image)).toBe(bounds);
    expect(getImageData).toHaveBeenCalledTimes(1);
  } finally {
    context.mockRestore();
  }
});

describe('Character Motion pointer gestures (#979 adaptation)', () => {
  it.each((['move', 'rotate', 'scale'] as const).flatMap(kind => (['image', 'graphic'] as const).map(source => ({ kind, source }))))('$source: 60 pointer updates for $kind produce one command and synchronized Undo/Redo', async ({ kind, source }) => {
    const fixture = characterPartAnimationFixture();
    const editor = new EditorProjectStore();
    editor.open('D:/test-motion', fixture.project);
    const before = editor.getSnapshot()!;
    const partId = source === 'image' ? fixture.imagePartId : fixture.graphicPartId;
    const input = { shotId: IDS.shot, layerId: fixture.layerId, partId, timeMs: 500, autoKey: true };
    const evaluated = evaluateShotAtTime(before.project.shots[0]!, 500, before.project);
    const visual = resolveLayerVisualParts(before.project, before.project.shots[0]!, evaluated.layers.find(l => l.id === fixture.layerId)!, 500);
    const part = visual.parts[source === 'image' ? 0 : 1]!;
    const paddedPart = { ...part, localRect: { ...part.localRect, width: 1920, height: 1080 } };
    const interactionBounds = { x: 840, y: 430, width: 20, height: 10 };
    const point = { x: 100, y: 100 };
    let pointer = { x: 100, y: 100 };
    const owner = { current: { getRelativePointerPosition: () => pointer } };
    const element = document.createElement('div');
    const root = createRoot(element);
    let position = { x: 0, y: 0 };
    const node = { position(next?: typeof position) { if (next) position = next; return position; }, stopDrag: vi.fn(), getLayer: () => ({ batchDraw: vi.fn() }) };
    const event = { cancelBubble: false, target: node };
    const call = (name: string, handler: string) => (nodes.get(name)![handler] as (event: unknown) => void)(event);
    const projection = (project = editor.getSnapshot()!.project) => {
      const shot = project.shots[0]!;
      return resolveLayerVisualParts(project, shot, evaluateShotAtTime(shot, 500, project).layers.find(l => l.id === fixture.layerId)!, 500);
    };
    try {
      await act(async () => root.render(createElement(CharacterMotionPart, {
        part: paddedPart, interactionBounds, motion: { selectedPartId: partId, contextKey: 'same-context', enabled: true,
          pivot: () => point, select: vi.fn(), begin: () => new CharacterMotionGesture(editor, input, () => true), error: error => { throw new Error(error); } },
        owner: owner as never, children: createElement('span'),
      })));
      const name = kind === 'move' ? 'character-motion-part' : `character-motion-${kind}`;
      expect(nodes.has('character-motion-move')).toBe(false);
      const { x, y, width, height } = interactionBounds;
      const corners = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]]
        .map(([x, y]) => transformPointByVisualPart({ x: x!, y: y! }, paddedPart));
      expect(nodes.get('character-motion-hit')).toMatchObject(interactionBounds);
      expect(nodes.get('character-motion-selection')!.points).toEqual(corners.flatMap(p => [p.x, p.y]));
      for (const [index, corner] of corners.entries()) {
        expect(nodes.get(index ? `character-motion-scale-${index}` : 'character-motion-scale')).toMatchObject(corner);
      }
      const top = { x: (corners[0]!.x + corners[1]!.x) / 2, y: (corners[0]!.y + corners[1]!.y) / 2 };
      const bottom = { x: (corners[2]!.x + corners[3]!.x) / 2, y: (corners[2]!.y + corners[3]!.y) / 2 };
      const length = Math.hypot(top.x - bottom.x, top.y - bottom.y);
      const rotate = nodes.get('character-motion-rotate')!;
      expect(rotate.x).toBeCloseTo(top.x + 28 * (top.x - bottom.x) / length);
      expect(rotate.y).toBeCloseTo(top.y + 28 * (top.y - bottom.y) / length);
      expect(nodes.get('character-motion-pivot')).toMatchObject({ points: [96, 100, 104, 100, 100, 100, 100, 96, 100, 104], listening: false });
      expect([...nodes.keys()].filter(name => /^character-motion-scale(?:-\d+)?$/.test(name))).toHaveLength(4);
      // Real Konva can emit dragend synchronously from stopDrag().
      node.stopDrag.mockImplementation(() => call(name, 'onDragEnd'));
      pointer = kind === 'rotate' ? { x: 100, y: 30 } : kind === 'scale' ? { x: 170, y: 100 } : { x: 100, y: 100 };
      await act(async () => call(name, 'onDragStart'));
      for (let step = 1; step <= 60; step += 1) {
        pointer = kind === 'rotate'
          ? { x: 100 + 70 * Math.cos(-Math.PI / 2 + Math.PI / 2 * step / 60), y: 100 + 70 * Math.sin(-Math.PI / 2 + Math.PI / 2 * step / 60) }
          : kind === 'scale' ? { x: 170 + 70 * step / 60, y: 100 } : { x: 100 + step, y: 100 + step / 2 };
        await act(async () => call(name, 'onDragMove'));
        expect(editor.getSnapshot()).toBe(before);
        expect(editor.history.getSnapshot().undoCount).toBe(0);
      }
      await act(async () => call(name, 'onDragEnd'));
      expect(editor.history.getSnapshot().undoCount).toBe(1);
      const after = editor.getSnapshot()!.project;
      const tracks = after.shots[0]!.layers.find(l => l.id === fixture.layerId)!.animationClip!.tracks;
      expect(tracks.map(t => t.property)).toEqual(kind === 'move' ? ['transform.offsetX', 'transform.offsetY'] : kind === 'rotate' ? ['transform.rotationDeg'] : ['transform.scaleX', 'transform.scaleY']);
      const expectedValue = kind === 'rotate' ? 90 : kind === 'scale' ? 2 : 60;
      expect(tracks[0]!.keys[1]!.value).toBeCloseTo(expectedValue);
      expect(projection()).not.toEqual(visual);
      editor.undo();
      expect(editor.getSnapshot()!.project).toEqual(before.project);
      expect(projection()).toEqual(visual);
      editor.redo();
      expect(editor.getSnapshot()!.project).toEqual(after);
      expect(after.animations).toEqual(before.project.animations);
    } finally { await act(async () => root.unmount()); }
  });
  it('uses pointer-down origin when quick rotation is coalesced into one move', async () => {
    const fixture = characterPartAnimationFixture(), editor = new EditorProjectStore();
    editor.open('D:/test-motion', fixture.project);
    const shot = fixture.project.shots[0]!;
    const part = resolveLayerVisualParts(fixture.project, shot, evaluateShotAtTime(shot, 500, fixture.project).layers.find(l => l.id === fixture.layerId)!, 500).parts[1]!;
    let pointer = { x: 0, y: -70 }, position = { x: 0, y: -70 };
    const node = { position(next?: typeof position) { if (next) position = next; return position; }, stopDrag: vi.fn(), getLayer: () => ({ batchDraw: vi.fn() }) };
    const root = createRoot(document.createElement('div'));
    const event = { target: node, cancelBubble: false };
    const call = (handler: string) => (nodes.get('character-motion-rotate')![handler] as (event: unknown) => void)(event);
    try {
      await act(async () => root.render(createElement(CharacterMotionPart, { part, interactionBounds: part.localRect,
        motion: { selectedPartId: fixture.graphicPartId, contextKey: 'fast', enabled: true, pivot: () => ({ x: 0, y: 0 }), select: vi.fn(),
          begin: () => new CharacterMotionGesture(editor, { shotId: IDS.shot, layerId: fixture.layerId, partId: fixture.graphicPartId, timeMs: 500, autoKey: true }, () => true), error: error => { throw new Error(error); } },
        owner: { current: { getRelativePointerPosition: () => pointer } } as never, children: null,
      })));
      await act(async () => call('onMouseDown'));
      pointer = { x: 70, y: 0 };
      await act(async () => { call('onDragStart'); call('onDragMove'); call('onDragEnd'); });
      const clip = editor.getSnapshot()!.project.shots[0]!.layers.find(l => l.id === fixture.layerId)!.animationClip!;
      expect(clip.tracks[0]!.keys[1]!.value).toBeCloseTo(90);
      expect(editor.history.getSnapshot().undoCount).toBe(1);
    } finally { await act(async () => root.unmount()); }
  });
  it('rejects stale time/selection/revision and keeps canceled gestures pristine', () => {
    const fixture = characterPartAnimationFixture();
    const editor = new EditorProjectStore(); editor.open('D:/test-motion', fixture.project);
    const input = { shotId: IDS.shot, layerId: fixture.layerId, partId: fixture.imagePartId, timeMs: 500, autoKey: true };
    const staleTime = new CharacterMotionGesture(editor, input, () => false);
    expect(() => staleTime.commit({ 'transform.offsetX': 10 })).toThrow(/变化/);
    expect(editor.history.getSnapshot().undoCount).toBe(0);
    const staleRevision = new CharacterMotionGesture(editor, input, () => true);
    editor.updateProject({ ...fixture.project, name: 'Other change' });
    expect(() => staleRevision.commit({ 'transform.rotationDeg': 90 })).toThrow(/变化/);
    expect(editor.history.getSnapshot().undoCount).toBe(1);
  });
});
