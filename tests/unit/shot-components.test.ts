import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import { ShotEditor } from '../../src/renderer/features/shots/ShotEditor';
import {
  nextAvailableShotName,
  ShotList,
} from '../../src/renderer/features/shots/ShotList';
import { ShotManager } from '../../src/renderer/features/shots/ShotManager';

const noop = () => undefined;
const rejectCreate = () => false;

describe('shot management components', () => {
  it('renders selection, drag ordering, duration, total duration, and save actions', () => {
    const project = migrateProject(exampleProject);
    const markup = renderToStaticMarkup(
      createElement(ShotManager, {
        snapshot: {
          projectRoot: 'D:\\镜头 项目.pandastage',
          project,
          dirty: true,
          revision: 3,
        },
      }),
    );

    expect(markup).toContain('镜头管理');
    expect(markup).toContain('拖拽排序');
    expect(markup).toContain('总时长 3000ms');
    expect(markup).not.toMatch(/<button[^>]*>保存整个项目/u);
    expect(markup).toContain('复制镜头');
    expect(markup).toContain('移除镜头');
    expect(markup).toContain('画布预览将在后续版本提供');
    expect(markup).not.toContain('时间轴编辑器');
  });

  it('renders an explicit empty-project creation path', () => {
    const project = migrateProject({
      ...exampleProject,
      shots: [],
    });
    const markup = renderToStaticMarkup(
      createElement(ShotList, {
        selectedShotId: null,
        shots: project.shots,
        onCreate: rejectCreate,
        onMove: noop,
        onSelect: noop,
      }),
    );

    expect(markup).toContain('项目还没有镜头');
    expect(markup).toContain('创建第一个镜头');
    expect(markup).toContain('创建镜头');
    expect(markup).toContain('0 个镜头');
    expect(markup).not.toContain('/5 验收样例');
  });

  it('derives an available default name from each current project', () => {
    expect(nextAvailableShotName([])).toBe('镜头 1');
    expect(
      nextAvailableShotName([
        { name: 'Opening' },
        { name: '镜头 3' },
      ]),
    ).toBe('镜头 4');
    expect(
      nextAvailableShotName([
        { name: '镜头 2' },
        { name: '镜头 3' },
      ]),
    ).toBe('镜头 4');
  });

  it('explains the duration boundary and renders only a placeholder thumbnail', () => {
    const project = migrateProject(exampleProject);
    const markup = renderToStaticMarkup(
      createElement(ShotEditor, {
        index: 0,
        shot: project.shots[0]!,
        onDuplicate: noop,
        onRemove: noop,
        onRename: noop,
        onSetDuration: noop,
      }),
    );
    expect(markup).toContain('最短 0.500 秒');
    expect(markup).toContain('不能短于镜头内已有内容');
    expect(markup).toContain('缩略图占位');
    expect(markup).not.toContain('<img');
  });
});
