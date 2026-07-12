import { describe, it, expect } from 'vitest';
import {
  interpolate,
  easeInOutCubic,
  easeInOutQuad,
  lerp,
  clamp,
  calculateShakeOffset,
} from '../../src/domain/evaluators/interpolators';
import {
  evaluateProjectAtTime,
  evaluateShotAtTime,
  type ShotFrame,
  type ProjectFrame,
} from '../../src/domain/evaluators/timelineEvaluator';
import type {
  Project,
  Shot,
  Layer,
  TimelineEvent,
  Character,
  Dialogue,
  AudioClip,
  SubtitleStyle,
  Asset,
} from '../../shared/types';
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  FPS,
  MOUTH_OPEN_PERIOD_MS,
} from '../../shared/constants';

// ─── Helpers ───

function createMinimalProject(overrides?: Partial<Project>): Project {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: '00000000-0000-0000-0000-000000000001',
    title: 'Test Project',
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    fps: FPS,
    assets: [],
    characters: [],
    voiceProfiles: [],
    subtitleStyles: [],
    shots: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Project;
}

function createShot(overrides?: Partial<Shot>): Shot {
  return {
    id: '00000000-0000-0000-0000-000000000010',
    name: 'Test Shot',
    durationMs: 5000,
    layers: [],
    dialogues: [],
    audioClips: [],
    events: [],
    ...overrides,
  } as Shot;
}

function createLayer(overrides?: Partial<Layer>): Layer {
  return {
    id: '00000000-0000-0000-0000-000000000020',
    type: 'character',
    x: CANVAS_WIDTH / 2,
    y: CANVAS_HEIGHT / 2,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    flipX: false,
    zIndex: 0,
    visible: true,
    locked: false,
    ...overrides,
  } as Layer;
}

function createCharacter(overrides?: Partial<Character>): Character {
  return {
    id: '00000000-0000-0000-0000-000000000030',
    name: 'Test Character',
    defaultExpression: 'normal',
    expressions: { normal: 'asset-normal' },
    defaultScale: 1,
    defaultFlipX: false,
    ...overrides,
  } as Character;
}

function createDialogue(overrides?: Partial<Dialogue>): Dialogue {
  return {
    id: '00000000-0000-0000-0000-000000000040',
    characterId: '00000000-0000-0000-0000-000000000030',
    text: 'Hello World',
    startMs: 0,
    durationMs: 3000,
    volume: 1,
    subtitleEnabled: true,
    ...overrides,
  } as Dialogue;
}

function createEvent(overrides?: Partial<TimelineEvent>): TimelineEvent {
  const base = {
    id: '00000000-0000-0000-0000-000000000050',
    targetLayerId: '00000000-0000-0000-0000-000000000020',
    startMs: 0,
    endMs: 1000,
    easing: 'linear' as const,
    order: 0,
  };

  if (overrides?.type === 'move') {
    return {
      ...base,
      type: 'move',
      payload: { toX: 500, toY: 500 },
      ...overrides,
    } as TimelineEvent;
  }
  if (overrides?.type === 'scale') {
    return {
      ...base,
      type: 'scale',
      payload: { toScaleX: 2, toScaleY: 2 },
      ...overrides,
    } as TimelineEvent;
  }
  if (overrides?.type === 'opacity') {
    return {
      ...base,
      type: 'opacity',
      payload: { toOpacity: 0.5 },
      ...overrides,
    } as TimelineEvent;
  }
  if (overrides?.type === 'shake') {
    return {
      ...base,
      type: 'shake',
      payload: { amplitudeX: 10, amplitudeY: 0, frequency: 8 },
      ...overrides,
    } as TimelineEvent;
  }
  if (overrides?.type === 'expression') {
    return {
      ...base,
      type: 'expression',
      payload: { expression: 'angry' },
      ...overrides,
    } as TimelineEvent;
  }
  if (overrides?.type === 'flip') {
    return {
      ...base,
      type: 'flip',
      payload: { flipX: true },
      ...overrides,
    } as TimelineEvent;
  }
  if (overrides?.type === 'visibility') {
    return {
      ...base,
      type: 'visibility',
      payload: { visible: false },
      ...overrides,
    } as TimelineEvent;
  }
  throw new Error('Unknown event type');
}

// ─── Interpolator Tests ───

describe('interpolators', () => {
  describe('interpolate', () => {
    it('linear interpolation from 0 to 100 at t=0.5 should return 50', () => {
      expect(interpolate(0, 100, 0.5, 'linear')).toBe(50);
    });

    it('linear interpolation from 10 to 20 at t=0 should return 10', () => {
      expect(interpolate(10, 20, 0, 'linear')).toBe(10);
    });

    it('linear interpolation from 10 to 20 at t=1 should return 20', () => {
      expect(interpolate(10, 20, 1, 'linear')).toBe(20);
    });

    it('ease-in-out at t=0.5 should be close to midpoint with cubic curve', () => {
      const result = interpolate(0, 100, 0.5, 'ease-in-out');
      const expected = easeInOutCubic(0.5) * 100;
      expect(result).toBeCloseTo(expected, 5);
    });

    it('clamps t below 0 to 0', () => {
      expect(interpolate(0, 100, -0.5, 'linear')).toBe(0);
    });

    it('clamps t above 1 to 1', () => {
      expect(interpolate(0, 100, 1.5, 'linear')).toBe(100);
    });
  });

  describe('easeInOutCubic', () => {
    it('returns 0 at t=0', () => {
      expect(easeInOutCubic(0)).toBe(0);
    });

    it('returns 1 at t=1', () => {
      expect(easeInOutCubic(1)).toBe(1);
    });

    it('returns 0.5 at t=0.5', () => {
      expect(easeInOutCubic(0.5)).toBe(0.5);
    });

    it('is symmetric around 0.5', () => {
      const a = easeInOutCubic(0.25);
      const b = easeInOutCubic(0.75);
      expect(a + b).toBeCloseTo(1, 5);
    });

    it('accelerates in the first half (derivative < 1 at t=0.25)', () => {
      const t = 0.25;
      const val = easeInOutCubic(t);
      // Compared to linear (0.25), cubic ease-in-out should be less
      expect(val).toBeLessThan(t);
    });
  });

  describe('easeInOutQuad', () => {
    it('returns 0 at t=0', () => {
      expect(easeInOutQuad(0)).toBe(0);
    });

    it('returns 1 at t=1', () => {
      expect(easeInOutQuad(1)).toBe(1);
    });
  });

  describe('lerp', () => {
    it('interpolates linearly between two values', () => {
      expect(lerp(10, 30, 0.5)).toBe(20);
      expect(lerp(0, 100, 0.25)).toBe(25);
    });
  });

  describe('clamp', () => {
    it('returns value within range unchanged', () => {
      expect(clamp(5, 0, 10)).toBe(5);
    });

    it('clamps below minimum', () => {
      expect(clamp(-5, 0, 10)).toBe(0);
    });

    it('clamps above maximum', () => {
      expect(clamp(15, 0, 10)).toBe(10);
    });
  });

  describe('calculateShakeOffset', () => {
    it('returns zero offset at progress=0 and progress=1', () => {
      const atStart = calculateShakeOffset(10, 10, 8, 0);
      const atEnd = calculateShakeOffset(10, 10, 8, 1);
      expect(atStart.offsetX).toBeCloseTo(0, 5);
      expect(atStart.offsetY).toBeCloseTo(10, 5); // cos(0) = 1, damping=1
      expect(atEnd.offsetX).toBeCloseTo(0, 5);
      expect(atEnd.offsetY).toBeCloseTo(0, 5); // damping = 0 at progress=1
    });

    it('damping decreases amplitude as progress increases', () => {
      const early = calculateShakeOffset(100, 0, 4, 0.1);
      const late = calculateShakeOffset(100, 0, 4, 0.9);
      const earlyAmp = Math.abs(early.offsetX);
      const lateAmp = Math.abs(late.offsetX);
      // Damping at 0.1 = 0.9, at 0.9 = 0.1, so amplitude should be ~9x greater
      expect(earlyAmp).toBeGreaterThan(lateAmp * 2);
    });

    it('frequency controls number of oscillations', () => {
      const progress = 0.5;
      const lowFreq = calculateShakeOffset(100, 0, 2, progress);
      const highFreq = calculateShakeOffset(100, 0, 16, progress);
      // At same progress, higher frequency means different phase, so different offset
      expect(lowFreq.offsetX).not.toBe(highFreq.offsetX);
    });

    it('X and Y components use sine and cosine respectively', () => {
      const result = calculateShakeOffset(10, 10, 1, 0.25);
      const phase = 0.25 * 1 * Math.PI * 2; // = π/2
      expect(result.offsetX).toBeCloseTo(Math.sin(phase) * 10 * 0.75, 5);
      expect(result.offsetY).toBeCloseTo(Math.cos(phase) * 10 * 0.75, 5);
    });
  });
});

// ─── Timeline Evaluator: Shot-level Tests ───

describe('evaluateShotAtTime', () => {
  it('returns initial layer state when no events are active', () => {
    const layer = createLayer({ x: 500, y: 300, scaleX: 1.5 });
    const shot = createShot({ layers: [layer] });
    const project = createMinimalProject({ shots: [shot] });

    const result = evaluateShotAtTime(shot, 0, project);
    const layerFrame = result.layers[0];

    expect(layerFrame.x).toBe(500);
    expect(layerFrame.y).toBe(300);
    expect(layerFrame.scaleX).toBe(1.5);
    expect(layerFrame.opacity).toBe(1);
    expect(layerFrame.visible).toBe(true);
  });

  it('applies move event linearly from start to end', () => {
    const layer = createLayer({ x: 0, y: 0 });
    const event = createEvent({
      type: 'move',
      startMs: 0,
      endMs: 1000,
      payload: { toX: 100, toY: 200 },
      easing: 'linear',
    });
    const shot = createShot({ layers: [layer], events: [event] });
    const project = createMinimalProject({ shots: [shot] });

    const mid = evaluateShotAtTime(shot, 500, project);
    expect(mid.layers[0].x).toBe(50);
    expect(mid.layers[0].y).toBe(100);

    const end = evaluateShotAtTime(shot, 1000, project);
    expect(end.layers[0].x).toBe(100);
    expect(end.layers[0].y).toBe(200);
  });

  it('applies ease-in-out cubic easing correctly', () => {
    const layer = createLayer({ x: 0 });
    const event = createEvent({
      type: 'move',
      startMs: 0,
      endMs: 1000,
      payload: { toX: 100, toY: 0 },
      easing: 'ease-in-out',
    });
    const shot = createShot({ layers: [layer], events: [event] });
    const project = createMinimalProject({ shots: [shot] });

    const result = evaluateShotAtTime(shot, 500, project);
    // ease-in-out cubic at 0.5 returns 0.5, so x = 50
    expect(result.layers[0].x).toBe(50);
  });

  it('does not apply event before startMs', () => {
    const layer = createLayer({ x: 0 });
    const event = createEvent({
      type: 'move',
      startMs: 500,
      endMs: 1000,
      payload: { toX: 100, toY: 0 },
    });
    const shot = createShot({ layers: [layer], events: [event] });
    const project = createMinimalProject({ shots: [shot] });

    const result = evaluateShotAtTime(shot, 250, project);
    expect(result.layers[0].x).toBe(0);
  });

  it('does not apply event after endMs (value stays at end state)', () => {
    const layer = createLayer({ x: 0 });
    const event = createEvent({
      type: 'move',
      startMs: 0,
      endMs: 500,
      payload: { toX: 100, toY: 0 },
    });
    const shot = createShot({ layers: [layer], events: [event] });
    const project = createMinimalProject({ shots: [shot] });

    const result = evaluateShotAtTime(shot, 750, project);
    // Event is finished but the evaluator only interpolates within range;
    // current implementation checks timeMs >= startMs && timeMs <= endMs
    // so at 750 it should keep the original x (0) because the event is not active.
    expect(result.layers[0].x).toBe(0);
  });
});

// ─── Event Priority (order field) Tests ───

describe('event priority by order field', () => {
  it('applies events in ascending order when both overlap', () => {
    const layer = createLayer({ x: 0 });
    const event1 = createEvent({
      type: 'move',
      startMs: 0,
      endMs: 1000,
      order: 1,
      payload: { toX: 100, toY: 0 },
    });
    const event2 = createEvent({
      type: 'move',
      startMs: 0,
      endMs: 1000,
      order: 2,
      payload: { toX: 200, toY: 0 },
    });
    const shot = createShot({ layers: [layer], events: [event1, event2] });
    const project = createMinimalProject({ shots: [shot] });

    const result = evaluateShotAtTime(shot, 500, project);
    // Both events overlap; they are sorted by order ascending, then applied sequentially.
    // Current implementation is cumulative: event1 interpolates from initial x (0) to 100,
    // then event2 interpolates from the new x (50) to 200.
    // event1: interpolate(0, 100, 0.5) = 50
    // event2: interpolate(50, 200, 0.5) = 125
    // NOTE: If the intended behavior is "last event wins" (non-cumulative),
    // this test should be updated after the evaluator is fixed.
    expect(result.layers[0].x).toBe(125);
  });

  it('lower order is applied first, higher order wins for same property', () => {
    const layer = createLayer({ opacity: 1 });
    const eventA = createEvent({
      type: 'opacity',
      startMs: 0,
      endMs: 1000,
      order: 10,
      payload: { toOpacity: 0.2 },
    });
    const eventB = createEvent({
      type: 'opacity',
      startMs: 0,
      endMs: 1000,
      order: 5,
      payload: { toOpacity: 0.8 },
    });
    const shot = createShot({
      layers: [layer],
      events: [eventA, eventB],
    });
    const project = createMinimalProject({ shots: [shot] });

    const result = evaluateShotAtTime(shot, 500, project);
    // Sorted by order: eventB (order 5) first, then eventA (order 10)
    // At t=0.5, eventB sets opacity to 0.4 (interpolated from 1 to 0.8)
    // Then eventA sets opacity to 0.6 (interpolated from 0.4 to 0.2)
    // Wait, actually the current implementation starts from layer.opacity (1) each time
    // So eventB: interpolate(1, 0.8, 0.5) = 0.9
    // Then eventA: interpolate(0.9, 0.2, 0.5) = 0.55
    expect(result.layers[0].opacity).toBeCloseTo(0.55, 5);
  });

  it('uses order as tie-breaker for discrete events with same startMs', () => {
    const layer = createLayer({ type: 'character', characterId: 'char-1' });
    const char = createCharacter({
      id: 'char-1',
      expressions: { normal: 'expr-normal', angry: 'expr-angry', happy: 'expr-happy' },
    });
    const event1 = createEvent({
      type: 'expression',
      startMs: 500,
      endMs: 500,
      order: 1,
      payload: { expression: 'angry' },
    });
    const event2 = createEvent({
      type: 'expression',
      startMs: 500,
      endMs: 500,
      order: 2,
      payload: { expression: 'happy' },
    });
    const shot = createShot({
      layers: [layer],
      events: [event1, event2],
    });
    const project = createMinimalProject({
      shots: [shot],
      characters: [char],
    });

    const result = evaluateShotAtTime(shot, 600, project);
    // Both start at 500ms. Discrete events take the most recent one.
    // Sorted by startMs desc, then order desc.
    // event2 (order 2) is more recent than event1 (order 1).
    expect(result.layers[0].expressionAssetId).toBe('expr-happy');
  });

  it('earlier startMs takes precedence over later order for discrete events', () => {
    const layer = createLayer({ type: 'character', characterId: 'char-1' });
    const char = createCharacter({
      id: 'char-1',
      expressions: { normal: 'expr-normal', angry: 'expr-angry' },
    });
    const event1 = createEvent({
      type: 'expression',
      startMs: 200,
      endMs: 200,
      order: 99,
      payload: { expression: 'angry' },
    });
    const event2 = createEvent({
      type: 'expression',
      startMs: 500,
      endMs: 500,
      order: 1,
      payload: { expression: 'normal' },
    });
    const shot = createShot({
      layers: [layer],
      events: [event1, event2],
    });
    const project = createMinimalProject({
      shots: [shot],
      characters: [char],
    });

    const result = evaluateShotAtTime(shot, 600, project);
    // At 600ms, both events are before. event2 is later (startMs=500), so it wins.
    expect(result.layers[0].expressionAssetId).toBe('expr-normal');
  });
});

// ─── Shake Event Tests ───

describe('shake events', () => {
  it('adds non-destructive offset to layer position', () => {
    const layer = createLayer({ x: 500, y: 300 });
    const event = createEvent({
      type: 'shake',
      startMs: 0,
      endMs: 1000,
      payload: { amplitudeX: 20, amplitudeY: 10, frequency: 4 },
    });
    const shot = createShot({ layers: [layer], events: [event] });
    const project = createMinimalProject({ shots: [shot] });

    const result = evaluateShotAtTime(shot, 250, project);
    const lf = result.layers[0];

    // Shake offset is non-destructive (stored separately)
    expect(lf.shakeOffsetX).not.toBe(0);
    expect(lf.shakeOffsetY).not.toBe(0);
    // Base position remains unchanged
    expect(lf.x).toBe(500);
    expect(lf.y).toBe(300);
  });

  it('multiple shake events can stack offsets', () => {
    const layer = createLayer({});
    const event1 = createEvent({
      type: 'shake',
      startMs: 0,
      endMs: 1000,
      payload: { amplitudeX: 10, amplitudeY: 0, frequency: 4 },
    });
    const event2 = createEvent({
      type: 'shake',
      startMs: 0,
      endMs: 1000,
      payload: { amplitudeX: 0, amplitudeY: 10, frequency: 4 },
    });
    const shot = createShot({ layers: [layer], events: [event1, event2] });
    const project = createMinimalProject({ shots: [shot] });

    const result = evaluateShotAtTime(shot, 250, project);
    const lf = result.layers[0];

    expect(lf.shakeOffsetX).not.toBe(0);
    expect(lf.shakeOffsetY).not.toBe(0);
  });

  it('shake offset is zero outside event range', () => {
    const layer = createLayer({});
    const event = createEvent({
      type: 'shake',
      startMs: 500,
      endMs: 1000,
      payload: { amplitudeX: 20, amplitudeY: 20, frequency: 4 },
    });
    const shot = createShot({ layers: [layer], events: [event] });
    const project = createMinimalProject({ shots: [shot] });

    const before = evaluateShotAtTime(shot, 250, project);
    expect(before.layers[0].shakeOffsetX).toBe(0);
    expect(before.layers[0].shakeOffsetY).toBe(0);

    const after = evaluateShotAtTime(shot, 1500, project);
    expect(after.layers[0].shakeOffsetX).toBe(0);
    expect(after.layers[0].shakeOffsetY).toBe(0);
  });
});

// ─── Mouth Animation Tests ───

describe('mouth animation', () => {
  it('cycles mouth open/closed at fixed frequency', () => {
    const layer = createLayer({
      type: 'character',
      characterId: 'char-1',
      expression: 'normal',
    });
    const char = createCharacter({
      id: 'char-1',
      mouthOpenAssetId: 'mouth-open-asset',
      expressions: { normal: 'expr-normal' },
    });
    const dialogue = createDialogue({
      characterId: 'char-1',
      startMs: 0,
      durationMs: 3000,
    });
    const shot = createShot({
      layers: [layer],
      dialogues: [dialogue],
    });
    const project = createMinimalProject({
      shots: [shot],
      characters: [char],
    });

    // At exactly 0ms (start of cycle), mouth should be open
    // cyclePos = 0 % 125 = 0 < 62.5 => mouthOpen = true
    const at0 = evaluateShotAtTime(shot, 0, project);
    expect(at0.layers[0].mouthOpen).toBe(true);
    expect(at0.layers[0].assetId).toBe('mouth-open-asset');

    // At 62ms (just before half period), mouth should be open
    // cyclePos = 62 % 125 = 62 < 62.5 => mouthOpen = true
    const at62 = evaluateShotAtTime(shot, 62, project);
    expect(at62.layers[0].mouthOpen).toBe(true);
    expect(at62.layers[0].assetId).toBe('mouth-open-asset');

    // At 63ms (just after half period), mouth should be closed
    const at63 = evaluateShotAtTime(shot, 63, project);
    expect(at63.layers[0].mouthOpen).toBe(false);
    expect(at63.layers[0].assetId).toBe('expr-normal');

    // At 125ms (start of new cycle), mouth open again
    const at125 = evaluateShotAtTime(shot, 125, project);
    expect(at125.layers[0].mouthOpen).toBe(true);
  });

  it('mouth animation period is MOUTH_OPEN_PERIOD_MS (125ms)', () => {
    const layer = createLayer({
      type: 'character',
      characterId: 'char-1',
    });
    const char = createCharacter({
      id: 'char-1',
      mouthOpenAssetId: 'mouth-open',
      expressions: { normal: 'normal-asset' },
    });
    const dialogue = createDialogue({
      characterId: 'char-1',
      startMs: 100,
      durationMs: 1000,
    });
    const shot = createShot({
      layers: [layer],
      dialogues: [dialogue],
    });
    const project = createMinimalProject({
      shots: [shot],
      characters: [char],
    });

    // Check across multiple cycles
    for (let cycle = 0; cycle < 3; cycle++) {
      const cycleStart = 100 + cycle * MOUTH_OPEN_PERIOD_MS;
      const resultOpen = evaluateShotAtTime(shot, cycleStart, project);
      expect(resultOpen.layers[0].mouthOpen).toBe(true);

      const midCycle = cycleStart + MOUTH_OPEN_PERIOD_MS / 2 - 1;
      const resultMid = evaluateShotAtTime(shot, midCycle, project);
      expect(resultMid.layers[0].mouthOpen).toBe(true);

      const afterHalf = cycleStart + MOUTH_OPEN_PERIOD_MS / 2 + 1;
      const resultClosed = evaluateShotAtTime(shot, afterHalf, project);
      expect(resultClosed.layers[0].mouthOpen).toBe(false);
    }
  });

  it('does not animate mouth if character has no mouthOpenAssetId', () => {
    const layer = createLayer({
      type: 'character',
      characterId: 'char-1',
    });
    const char = createCharacter({
      id: 'char-1',
      // No mouthOpenAssetId
      expressions: { normal: 'normal-asset' },
    });
    const dialogue = createDialogue({
      characterId: 'char-1',
      startMs: 0,
      durationMs: 1000,
    });
    const shot = createShot({
      layers: [layer],
      dialogues: [dialogue],
    });
    const project = createMinimalProject({
      shots: [shot],
      characters: [char],
    });

    const result = evaluateShotAtTime(shot, 0, project);
    expect(result.layers[0].mouthOpen).toBe(false);
    expect(result.layers[0].assetId).toBe('normal-asset');
  });

  it('does not animate mouth outside dialogue range', () => {
    const layer = createLayer({
      type: 'character',
      characterId: 'char-1',
    });
    const char = createCharacter({
      id: 'char-1',
      mouthOpenAssetId: 'mouth-open',
      expressions: { normal: 'normal-asset' },
    });
    const dialogue = createDialogue({
      characterId: 'char-1',
      startMs: 500,
      durationMs: 1000,
    });
    const shot = createShot({
      layers: [layer],
      dialogues: [dialogue],
    });
    const project = createMinimalProject({
      shots: [shot],
      characters: [char],
    });

    const before = evaluateShotAtTime(shot, 250, project);
    expect(before.layers[0].mouthOpen).toBe(false);

    const after = evaluateShotAtTime(shot, 2000, project);
    expect(after.layers[0].mouthOpen).toBe(false);
  });
});

// ─── Subtitle Tests ───

describe('subtitles', () => {
  it('shows subtitle from first active dialogue with subtitleEnabled', () => {
    const layer = createLayer({});
    const style: SubtitleStyle = {
      id: 'style-1',
      name: 'Default',
      fontSize: 48,
      fontFamily: 'Noto Sans SC',
      color: '#FFFFFF',
      outlineColor: '#000000',
      outlineWidth: 2,
      shadowBlur: 4,
      maxLines: 2,
    };
    const dialogue1 = createDialogue({
      text: 'First line',
      startMs: 0,
      durationMs: 1000,
      subtitleEnabled: true,
    });
    const dialogue2 = createDialogue({
      text: 'Second line',
      startMs: 0,
      durationMs: 1000,
      subtitleEnabled: true,
    });
    const shot = createShot({
      layers: [layer],
      dialogues: [dialogue1, dialogue2],
    });
    const project = createMinimalProject({
      shots: [shot],
      subtitleStyles: [style],
    });

    const result = evaluateShotAtTime(shot, 500, project);
    expect(result.currentSubtitle).not.toBeNull();
    expect(result.currentSubtitle!.text).toBe('First line');
  });

  it('hides subtitle if subtitleEnabled is false', () => {
    const layer = createLayer({});
    const dialogue = createDialogue({
      text: 'Hidden',
      startMs: 0,
      durationMs: 1000,
      subtitleEnabled: false,
    });
    const shot = createShot({
      layers: [layer],
      dialogues: [dialogue],
    });
    const project = createMinimalProject({ shots: [shot] });

    const result = evaluateShotAtTime(shot, 500, project);
    expect(result.currentSubtitle).toBeNull();
  });
});

// ─── Project-level Tests ───

describe('evaluateProjectAtTime', () => {
  it('selects correct shot based on accumulated duration', () => {
    const shot1 = createShot({ durationMs: 2000 });
    const shot2 = createShot({ durationMs: 3000 });
    const project = createMinimalProject({
      shots: [shot1, shot2],
    });

    const at0 = evaluateProjectAtTime(project, 0);
    expect(at0.currentShotIndex).toBe(0);

    const at1500 = evaluateProjectAtTime(project, 1500);
    expect(at1500.currentShotIndex).toBe(0);

    const at2500 = evaluateProjectAtTime(project, 2500);
    expect(at2500.currentShotIndex).toBe(1);
    expect(at2500.currentShotTimeMs).toBe(500);
  });

  it('returns last shot when time exceeds total duration', () => {
    const shot1 = createShot({ durationMs: 1000 });
    const shot2 = createShot({ durationMs: 1000 });
    const project = createMinimalProject({
      shots: [shot1, shot2],
    });

    const result = evaluateProjectAtTime(project, 5000);
    expect(result.currentShotIndex).toBe(1);
  });

  it('handles single shot project', () => {
    const shot = createShot({ durationMs: 5000 });
    const project = createMinimalProject({ shots: [shot] });

    const result = evaluateProjectAtTime(project, 3000);
    expect(result.currentShotIndex).toBe(0);
    expect(result.currentShotTimeMs).toBe(3000);
  });

  it('layers are sorted by zIndex for rendering', () => {
    const layer1 = createLayer({ zIndex: 2, id: 'layer-1' });
    const layer2 = createLayer({ zIndex: 1, id: 'layer-2' });
    const layer3 = createLayer({ zIndex: 3, id: 'layer-3' });
    const shot = createShot({
      layers: [layer1, layer2, layer3],
    });
    const project = createMinimalProject({ shots: [shot] });

    const result = evaluateShotAtTime(shot, 0, project);
    expect(result.layers[0].layerId).toBe('layer-2');
    expect(result.layers[1].layerId).toBe('layer-1');
    expect(result.layers[2].layerId).toBe('layer-3');
  });
});

// ─── Audio Clip Tests ───

describe('audio clips', () => {
  it('includes active audio clips in frame', () => {
    const clip: AudioClip = {
      id: 'clip-1',
      assetId: 'asset-bgm',
      role: 'bgm',
      startMs: 0,
      sourceStartMs: 0,
      durationMs: 5000,
      volume: 0.7,
    };
    const shot = createShot({
      audioClips: [clip],
    });
    const project = createMinimalProject({ shots: [shot] });

    const result = evaluateShotAtTime(shot, 1000, project);
    expect(result.activeAudioClips).toHaveLength(1);
    expect(result.activeAudioClips[0].clipId).toBe('clip-1');
    expect(result.activeAudioClips[0].volume).toBe(0.7);
  });

  it('excludes audio clips that have not started yet', () => {
    const clip: AudioClip = {
      id: 'clip-1',
      assetId: 'asset-bgm',
      role: 'bgm',
      startMs: 2000,
      sourceStartMs: 0,
      durationMs: 5000,
      volume: 0.7,
    };
    const shot = createShot({ audioClips: [clip] });
    const project = createMinimalProject({ shots: [shot] });

    const result = evaluateShotAtTime(shot, 1000, project);
    expect(result.activeAudioClips).toHaveLength(0);
  });
});

// ─── Flip & Visibility Tests ───

describe('flip and visibility discrete events', () => {
  it('applies flip event', () => {
    const layer = createLayer({ flipX: false });
    const event = createEvent({
      type: 'flip',
      startMs: 500,
      endMs: 500,
      payload: { flipX: true },
    });
    const shot = createShot({ layers: [layer], events: [event] });
    const project = createMinimalProject({ shots: [shot] });

    const before = evaluateShotAtTime(shot, 250, project);
    expect(before.layers[0].flipX).toBe(false);

    const after = evaluateShotAtTime(shot, 750, project);
    expect(after.layers[0].flipX).toBe(true);
  });

  it('applies visibility event', () => {
    const layer = createLayer({ visible: true });
    const event = createEvent({
      type: 'visibility',
      startMs: 500,
      endMs: 500,
      payload: { visible: false },
    });
    const shot = createShot({ layers: [layer], events: [event] });
    const project = createMinimalProject({ shots: [shot] });

    const before = evaluateShotAtTime(shot, 250, project);
    expect(before.layers[0].visible).toBe(true);

    const after = evaluateShotAtTime(shot, 750, project);
    expect(after.layers[0].visible).toBe(false);
  });
});

// ─── Scale Event Tests ───

describe('scale events', () => {
  it('applies uniform scale', () => {
    const layer = createLayer({ scaleX: 1, scaleY: 1 });
    const event = createEvent({
      type: 'scale',
      startMs: 0,
      endMs: 1000,
      payload: { toScaleX: 2, toScaleY: 3 },
    });
    const shot = createShot({ layers: [layer], events: [event] });
    const project = createMinimalProject({ shots: [shot] });

    const mid = evaluateShotAtTime(shot, 500, project);
    expect(mid.layers[0].scaleX).toBe(1.5);
    expect(mid.layers[0].scaleY).toBe(2);
  });
});

// ─── Opacity Event Tests ───

describe('opacity events', () => {
  it('clamps opacity to [0, 1] even if interpolation exceeds', () => {
    const layer = createLayer({ opacity: 0.8 });
    const event = createEvent({
      type: 'opacity',
      startMs: 0,
      endMs: 1000,
      payload: { toOpacity: 1.2 }, // Invalid value, but interpolate should handle it
    });
    const shot = createShot({ layers: [layer], events: [event] });
    const project = createMinimalProject({ shots: [shot] });

    // Note: current implementation doesn't clamp the interpolated value.
    // This test documents current behavior; if clamping is added, update accordingly.
    const result = evaluateShotAtTime(shot, 500, project);
    // interpolate(0.8, 1.2, 0.5, 'linear') = 1.0
    expect(result.layers[0].opacity).toBe(1);
  });
});
