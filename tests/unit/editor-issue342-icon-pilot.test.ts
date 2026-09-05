import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  calculateViewportTransform,
  migrateProject,
} from '../../src/domain';
import { CanvasToolbar } from '../../src/renderer/features/canvas/CanvasToolbar';
import { ShotEditor } from '../../src/renderer/features/shots/ShotEditor';
import { ShotListItem } from '../../src/renderer/features/shots/ShotListItem';
import { AdaptiveWorkspaceSwitcher } from '../../src/renderer/shell/AdaptiveWorkspaceSwitcher';
import { readFileSync } from 'node:fs';

function source(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

const project = migrateProject(exampleProject);
const shot = project.shots[0]!;

describe('Issue #342 Lucide icon pilot', () => {
  it('keeps readable labels while adding decorative Lucide icons to shared chrome', () => {
    const bar = source('src/renderer/shell/CompactProjectBar.tsx');
    const history = source('src/renderer/features/editor/HistoryControls.tsx');
    const switcher = source('src/renderer/shell/AdaptiveWorkspaceSwitcher.tsx');

    for (const name of ['MoreHorizontal', 'Save']) {
      expect(bar).toContain(name);
    }
    for (const name of ['Undo2', 'Redo2']) {
      expect(history).toContain(name);
    }
    for (const name of ['Images', 'PanelTop', 'Rows3', 'SlidersHorizontal']) {
      expect(switcher).toContain(name);
    }
    for (const component of [bar, history, switcher]) {
      expect(component).toContain('aria-hidden="true"');
      expect(component).toContain('className="ui-icon');
    }
    expect(bar).not.toContain('⋯');
  });

  it('keeps Canvas zoom semantics and labels intact', () => {
    const markup = renderToStaticMarkup(
      createElement(CanvasToolbar, {
        mode: 'actual',
        point: null,
        transform: calculateViewportTransform(
          { width: 800, height: 600 },
          'actual',
        ),
      }),
    );
    const toolbar = source('src/renderer/features/canvas/CanvasToolbar.tsx');
    const tools = source('src/renderer/shell/ProjectToolsDrawer.tsx');

    // Issue #436 LM-004: the Canvas feedback keeps the readable mode label
    // and the scale percentage; the three mode controls themselves now
    // live in the right-side 工具 surface (decorative icons there still
    // carry aria-hidden="true" per the shared chrome treatment).
    expect(markup).toContain('1:1 像素');
    expect(markup).toContain('100.0%');
    expect(markup).toContain('canvas-mode-feedback');
    expect(markup).toContain('canvas-pointer-coordinate');
    expect(toolbar).toContain('canvas-mode-feedback');
    expect(tools).toContain('适应窗口');
    expect(tools).toContain('50%');
    expect(tools).toContain('实际尺寸');
    expect(tools).toContain('canvas-mode-fit');
    expect(tools).toContain('canvas-mode-half');
    expect(tools).toContain('canvas-mode-actual');
    expect(tools).toContain('aria-hidden="true"');
  });

  it('keeps four workspace tabs and Shot behavior while adding the pilot icons', () => {
    const tabs = renderToStaticMarkup(
      createElement(AdaptiveWorkspaceSwitcher, {
        onChange: () => undefined,
        value: 'canvas',
      }),
    );
    const shotItem = renderToStaticMarkup(
      createElement(ShotListItem, {
        index: 0,
        onDropShot: () => undefined,
        onSelect: () => undefined,
        selected: true,
        shot,
      }),
    );
    const editor = renderToStaticMarkup(
      createElement(ShotEditor, {
        index: 0,
        onDuplicate: () => undefined,
        onRemove: () => undefined,
        onRename: () => undefined,
        onSetDuration: () => undefined,
        shot,
      }),
    );
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');
    const shotSource = source('src/renderer/features/shots/ShotEditor.tsx');
    const itemSource = source('src/renderer/features/shots/ShotListItem.tsx');

    expect(tabs.match(/data-ui-segmented-tab="true"/gu)).toHaveLength(4);
    expect(tabs).toContain('画布');
    expect(tabs).toContain('素材');
    expect(tabs).toContain('属性');
    expect(tabs).toContain('时间轴');
    expect(shotItem).toContain('拖拽排序');
    expect(shotItem).toContain('aria-hidden="true"');
    expect(shotItem).not.toContain('⋮⋮');
    for (const label of ['复制镜头', '移除镜头', '图层', '音频', '对白', '事件']) {
      expect(editor).toContain(label);
    }
    for (const name of ['CirclePlus', 'Copy', 'Trash2', 'GripVertical', 'Layers3', 'Music2', 'MessageSquareText', 'Zap']) {
      expect(`${dock}\n${shotSource}\n${itemSource}`).toContain(name);
    }
    expect(dock).toContain("label: '新建镜头'");
  });

  it('defines a shared 16–20px icon treatment without changing touch targets', () => {
    const primitives = source('src/renderer/styles/primitives.css');
    const styles = source('src/renderer/styles.css');

    expect(primitives).toContain('.ui-icon-label');
    expect(primitives).toContain('width: 18px;');
    expect(primitives).toContain('.ui-icon-tab');
    expect(primitives).toContain('width: 20px;');
    expect(primitives).toContain('min-height: var(--ui-touch-icon);');
    expect(styles).toContain('.shot-drag-handle');
    expect(styles).toContain('min-height: 26px;');
  });
});
