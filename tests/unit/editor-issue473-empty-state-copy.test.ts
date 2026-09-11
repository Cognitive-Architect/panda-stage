import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #473 first-use empty-state copy', () => {
  it('uses the approved creator-facing wording on all five surfaces', () => {
    const dialogue = source(
      'src/renderer/features/dialogue/DialogueSheet.tsx',
    );
    const canvas = source('src/renderer/features/canvas/CanvasStage.tsx');
    const assets = source('src/renderer/features/assets/AssetLibrary.tsx');
    const shots = source('src/renderer/features/shots/ShotList.tsx');
    const characters = source(
      'src/renderer/features/characters/CharacterList.tsx',
    );

    expect(dialogue).toContain('还没有字幕');
    expect(dialogue).toContain('还没有字幕，先写一句吧。');
    expect(dialogue).not.toContain('先写一句，之后再安排它什么时候出现。');
    expect(dialogue).not.toContain('暂无待安排字幕');

    expect(canvas).toContain('先往画布里放点东西吧。');
    expect(canvas).not.toContain('画布还是空的');
    expect(canvas).not.toContain(
      '从左边加个背景或角色，就能开始摆画面了。',
    );
    expect(canvas).not.toContain('当前镜头还没有图层');

    expect(assets).toContain('素材库还是空的');
    expect(assets).toContain(
      '拖进图片或音频，或者点上面的「导入素材」。',
    );
    expect(assets).toContain('counts.all === 0');

    expect(shots).toContain('还没有镜头');
    expect(shots).toContain('先新建一个吧。');
    expect(shots).not.toContain('先新建一个，我们从第一幕开始。');
    expect(shots).not.toContain('当前选择将自动指向它');

    expect(characters).toContain('还没有角色');
    expect(characters).toContain(
      '先准备 2 张角色图片，就能创建角色了。',
    );
    expect(characters).not.toContain('还没有角色。请先准备至少两张图片素材。');
  });
});
