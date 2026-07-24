import { describe, expect, it } from 'vitest';
import { PathService } from '../../src/main/services/PathService';

describe('PathService Windows normalization', () => {
  const paths = new PathService('win32');

  it('normalizes dot segments, slash direction, case, and trailing separators', () => {
    const canonical = 'D:\\Projects\\a.pandastage';
    const alias = 'd:/projects/temp/../a.pandastage/';

    expect(paths.resolve(alias)).toBe('d:\\projects\\a.pandastage');
    expect(paths.same(canonical, alias)).toBe(true);
    expect(paths.comparisonKey(canonical)).toBe(
      'd:\\projects\\a.pandastage',
    );
  });

  it('normalizes UNC roots while preserving Unicode and spaces', () => {
    const canonical =
      '\\\\Server\\Share\\熊猫 项目\\故事.pandastage';
    const alias =
      '//server/share/熊猫 项目/temp/../故事.pandastage/';

    expect(paths.same(canonical, alias)).toBe(true);
    expect(paths.resolve(alias)).toContain('熊猫 项目');
    expect(paths.resolve(alias).startsWith('\\\\server\\share\\')).toBe(
      true,
    );
  });

  it('rejects empty paths explicitly', () => {
    expect(() => paths.resolve('   ')).toThrow('Path must not be empty');
  });
});
