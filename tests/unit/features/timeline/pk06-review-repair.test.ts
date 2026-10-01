import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PositionLaneErrorNotice } from '../../../../src/renderer/features/timeline/PositionLane';

function readSource(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8').replaceAll('\r\n', '\n');
}

interface StopPropagationEvent {
  stopPropagation: () => void;
}

interface NoticeChild {
  props?: {
    'aria-label'?: string;
    className?: string;
    onClick?: (event: StopPropagationEvent) => void;
  };
}

interface NoticeElement {
  props: {
    children: Array<NoticeChild | null>;
    onClick: (event: StopPropagationEvent) => void;
    onPointerDown: (event: StopPropagationEvent) => void;
  };
}

function notice(onDismiss: () => void): NoticeElement {
  return PositionLaneErrorNotice({
    message: '这个位置点已发生变化，请重新操作。',
    onDismiss,
  }) as unknown as NoticeElement;
}

describe('Issue #648 Repair A — Delete keeps the shared touch target', () => {
  const css = readSource('src/renderer/styles/features/timeline/pk06-position-lane.css');

  it('removes the local 36px override on the shared Button primitive', () => {
    const block = /\.position-key-action \[data-ui-button\]\s*\{([^}]*)\}/u.exec(css)?.[1] ?? '';
    expect(block).not.toBe('');
    expect(block).not.toContain('min-height');
    expect(css).not.toContain('min-height: 36px');
    expect(css).not.toMatch(/min-height:\s*(?:[0-9]|[1-3][0-9]|4[0-3])px/u);
  });

  it('stays compact through the bubble container instead of shrinking the target', () => {
    const bubble = /\.position-key-action\s*\{([^}]*)\}/u.exec(css)?.[1] ?? '';
    expect(bubble).toContain('width: 104px');
    expect(bubble).toMatch(/padding: 3px;/u);
  });

  it('reuses the shared touch tokens rather than a PK-06 private one', () => {
    const tokens = readSource('src/renderer/styles/tokens.css');
    expect(tokens).toContain('--ui-touch-icon: 44px;');
    expect(tokens).toContain('--ui-touch-regular: 48px;');
    expect(css).not.toMatch(/--ui-touch-[a-z]+:\s*[0-9]/u);
  });
});

describe('Issue #648 Repair B — local error is pointer-safe and dismissible', () => {
  it('stops pointerdown and click before the parent Timeline seek owner', () => {
    let stopped = 0;
    const node = notice(() => undefined);
    node.props.onPointerDown({ stopPropagation: () => { stopped += 1; } });
    node.props.onClick({ stopPropagation: () => { stopped += 1; } });
    expect(stopped).toBe(2);
  });

  it('dismisses through a real button that is reachable and named for assistive tech', () => {
    let dismissed = 0;
    let stopped = 0;
    const node = notice(() => { dismissed += 1; });
    const button = node.props.children.find(
      (child) => child?.props?.['aria-label'] === '关闭提示',
    );
    expect(button).toBeTruthy();
    expect(button?.props?.className).toBe('position-lane-error-dismiss');
    button?.props?.onClick?.({ stopPropagation: () => { stopped += 1; } });
    expect(dismissed).toBe(1);
    expect(stopped).toBe(1);
  });

  it('keeps alert semantics on the message and renders one native button', () => {
    const markup = renderToStaticMarkup(createElement(PositionLaneErrorNotice, {
      message: '这个位置点已发生变化，请重新操作。',
      onDismiss: () => undefined,
    }));
    expect(markup).toContain('data-testid="position-lane-error"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('这个位置点已发生变化，请重新操作。');
    expect(markup).toMatch(/<button[^>]*aria-label="关闭提示"/u);
    expect(markup).toMatch(/<button[^>]*type="button"/u);
    expect(markup.match(/<button/gu)).toHaveLength(1);
  });

  it('keeps the error local to the Position lane with no toast or duplicate copy', () => {
    const lane = readSource('src/renderer/features/timeline/PositionLane.tsx');
    expect(lane).toContain('onError={setError}');
    expect(lane).toContain('PositionLaneErrorNotice');
    expect(lane).not.toMatch(/toast|statusBar|Inspector/u);
  });
});

describe('Issue #648 Repair D — Timeline group accessible name', () => {
  const dock = readSource('src/renderer/features/timeline/TimelineDock.tsx');

  it('renames the track group so it covers Position, Subtitle and Audio', () => {
    expect(dock).toContain('aria-label="时间轴轨道"');
    expect(dock).not.toContain('字幕和音频轨道');
  });

  it('keeps one group name and adds no extra visible copy', () => {
    expect(dock.match(/aria-label="时间轴轨道"/gu)).toHaveLength(1);
    expect(dock).toContain('data-testid="timeline-track-stack"');
    expect(dock).toContain('role="group"');
  });
});
