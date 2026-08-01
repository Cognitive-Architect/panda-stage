import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  projectCreateErrorMessage,
  validateNewProjectInput,
  validateNewProjectName,
  validateNewProjectParentDirectory,
} from '../../src/renderer/shell/projectCreateFlow';

const RENDERER_CREATE_SOURCES = [
  'src/renderer/shell/projectCreateFlow.ts',
  'src/renderer/shell/NewProjectDialog.tsx',
  'src/renderer/shell/NewProjectEntry.tsx',
  'src/renderer/shell/StartScreen.tsx',
  'src/renderer/shell/EditorShell.tsx',
] as const;

function rendererCreateSource(): string {
  return RENDERER_CREATE_SOURCES.map((path) =>
    readFileSync(path, 'utf8'),
  ).join('\n');
}

describe('renderer project creation flow', () => {
  it('requires a complete Windows parent directory', () => {
    expect(validateNewProjectParentDirectory('').valid).toBe(false);
    expect(validateNewProjectParentDirectory('   ').message).toContain(
      '请先选择新项目的存放文件夹',
    );
    expect(validateNewProjectParentDirectory('作品').valid).toBe(false);
    expect(validateNewProjectParentDirectory('D:\\作品|x').message).toContain(
      'Windows 不允许的字符',
    );
    expect(validateNewProjectParentDirectory('D:\\作品').valid).toBe(true);
    expect(
      validateNewProjectParentDirectory('\\\\nas\\share\\作品').valid,
    ).toBe(true);
  });

  it('rejects names that would escape the selected parent directory', () => {
    for (const projectName of [
      '..',
      '..\\..\\系统',
      '子目录/短片',
      '子目录\\短片',
    ]) {
      const validation = validateNewProjectName(projectName);
      expect(validation.valid).toBe(false);
      expect(validation.message.length).toBeGreaterThan(0);
    }
    expect(validateNewProjectName('子目录\\短片').message).toContain(
      '不能包含斜杠或反斜杠',
    );
    expect(validateNewProjectName('..').message).toContain('相对路径片段');
  });

  it('explains illegal characters, reserved names, and redundant suffixes', () => {
    expect(validateNewProjectName('短片?').message).toContain(
      'Windows 不允许的字符',
    );
    expect(validateNewProjectName('COM1').message).toContain('保留的设备名');
    expect(validateNewProjectName('短片 ').valid).toBe(true);
    expect(validateNewProjectName('短片.').message).toContain(
      '不能以句点或空格结尾',
    );
    expect(validateNewProjectName('短片.pandastage').message).toContain(
      '无需自行添加',
    );
    expect(validateNewProjectName('短片').valid).toBe(true);
  });

  it('combines both fields into a single submit gate', () => {
    expect(validateNewProjectInput('', '').valid).toBe(false);
    expect(validateNewProjectInput('D:\\作品', '').valid).toBe(false);
    expect(validateNewProjectInput('', '短片').valid).toBe(false);
    const ready = validateNewProjectInput('D:\\作品', '短片');
    expect(ready.valid).toBe(true);
    expect(ready.parentDirectory.valid).toBe(true);
    expect(ready.projectName.valid).toBe(true);
  });

  it('maps main-process failures to actionable Chinese guidance', () => {
    expect(
      projectCreateErrorMessage({ code: 'PROJECT_ALREADY_EXISTS' }),
    ).toContain('已存在同名项目');
    expect(
      projectCreateErrorMessage({ code: 'PROJECT_NOT_WRITABLE' }),
    ).toContain('没有写入权限');
    expect(
      projectCreateErrorMessage({ code: 'INVALID_PROJECT_ROOT' }),
    ).toContain('项目名称或存放文件夹无效');
    expect(projectCreateErrorMessage({ code: 'CREATE_FAILED' })).toContain(
      '创建项目失败',
    );
    expect(projectCreateErrorMessage(new Error('boom'))).toContain('boom');
    expect(projectCreateErrorMessage('unknown')).toContain('创建项目失败');
  });

  it('never assembles the final project root inside the Renderer', () => {
    const source = rendererCreateSource();

    expect(source).not.toMatch(/\+\s*['"`]\.pandastage/u);
    expect(source).not.toMatch(/\$\{[^}]*\}\.pandastage/u);
    expect(source).not.toMatch(/\bjoin\s*\(/u);
    expect(source).not.toContain('node:path');
    expect(source).not.toContain('PathService');
    expect(source).not.toMatch(
      /`\$\{[^`]*parentDirectory[^`]*\}[^`]*\$\{[^`]*projectName/u,
    );
  });

  it('submits only parentDirectory, projectName, and metadata over IPC', () => {
    const shell = readFileSync('src/renderer/shell/EditorShell.tsx', 'utf8');

    expect(shell).toMatch(
      /project\.createAt\(\{[\s\S]{0,240}?parentDirectory,[\s\S]{0,240}?projectName,[\s\S]{0,240}?metadata:[\s\S]{0,240}?\}\)/u,
    );
    expect(shell).not.toMatch(/createAt\(\{[\s\S]{0,240}?projectRoot/u);
    expect(shell).toContain(
      'await switchToProject(\n          response.value.projectRoot,',
    );
    expect(shell).not.toContain('editorProjectStore.open(');
  });
});
