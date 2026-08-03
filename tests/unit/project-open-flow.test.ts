import { describe, expect, it } from 'vitest';
import {
  projectOpenErrorMessage,
  validateProjectOpenCandidate,
} from '../../src/renderer/shell/projectOpenFlow';

describe('project open flow', () => {
  it.each([
    ['', '请输入 .pandastage 项目文件夹路径。'],
    ['?', '项目文件夹路径包含 Windows 不允许的字符。'],
    ['D:\\Projects\\missing', '请选择以 .pandastage 结尾的项目文件夹。'],
    [
      'D:\\Projects\\bad?.pandastage',
      '项目文件夹路径包含 Windows 不允许的字符。',
    ],
  ])('rejects invalid candidate %j', (candidate, message) => {
    expect(validateProjectOpenCandidate(candidate)).toEqual({
      valid: false,
      message,
    });
  });

  it.each([
    'D:\\Projects\\story.pandastage',
    'D:/项目/故事.pandastage/',
    '\\\\server\\share\\story.pandastage',
  ])('accepts a complete .pandastage folder path %j', (candidate) => {
    expect(validateProjectOpenCandidate(candidate).valid).toBe(true);
  });

  it('localizes project service errors preserved as the switch error cause', () => {
    expect(
      projectOpenErrorMessage({
        code: 'OPEN_FAILED',
        cause: { code: 'PROJECT_NOT_FOUND' },
      }),
    ).toBe('项目文件夹不存在，请检查路径后重试。');
    expect(
      projectOpenErrorMessage({ code: 'CURRENT_PROJECT_DIRTY' }),
    ).toBe('当前项目有未保存的更改，无法重复打开。');
    expect(
      projectOpenErrorMessage({
        code: 'OPEN_FAILED',
        cause: { code: 'PROJECT_FILE_NOT_FOUND' },
      }),
    ).toBe('该文件夹不是有效的 Panda Stage 项目：缺少 project.json。');
    expect(
      projectOpenErrorMessage({
        code: 'OPEN_FAILED',
        cause: { code: 'INVALID_PROJECT' },
      }),
    ).toBe('project.json 的项目数据不完整或格式无效。');
  });
});
