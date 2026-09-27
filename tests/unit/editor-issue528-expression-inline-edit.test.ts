import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Expression inline picker and Issue #633 compact edit workspace', () => {
  it('keeps the editing card compact and moves the edit surface outside the list', () => {
    const editor = source(
      'src/renderer/features/characters/ExpressionEditor.tsx',
    );
    const styles = readOrderedStylesheetSource();
    const polishStart = styles.indexOf('/* Issue #633:');
    const polish = styles.slice(polishStart);

    expect(polishStart).toBeGreaterThanOrEqual(0);
    expect(polish).toContain('.expression-card.expression-card-editing');
    expect(polish).toContain('grid-column: auto;');
    expect(polish).toContain(
      'grid-template-columns: minmax(0, 1fr) auto;',
    );
    expect(polish).toContain('grid-template-columns: 64px minmax(0, 1fr);');
    expect(polish).toContain('width: 64px;');
    expect(polish).toContain('height: 64px;');
    expect(styles).toContain(
      'grid-template-columns: repeat(2, minmax(0, 1fr));',
    );
    expect(editor).toContain('data-expression-editing={isEditing}');
    expect(editor).toContain('setEditingExpressionId(expression.id)');
    expect(editor.indexOf('className="expression-edit-panel expression-edit-workspace"'))
      .toBeLessThan(editor.indexOf('<ul className="expression-card-list">'));
    expect(polish).toContain('max-height: none;');
    expect(polish).toContain('overflow-y: visible;');
  });

  it('uses the shared picker inline seam without changing selection ownership', () => {
    const editor = source(
      'src/renderer/features/characters/ExpressionEditor.tsx',
    );
    const picker = source(
      'src/renderer/features/characters/ImageAssetPicker.tsx',
    );
    const styles = readOrderedStylesheetSource();
    const polish = styles.slice(styles.indexOf('/* Issue #633:'));

    expect(editor).toContain('label="图片"');
    expect(editor).toContain('presentation="inline"');
    expect(editor).not.toContain('当前素材');
    expect(editor).not.toContain('更换素材会立即应用；名称修改请点击应用。');
    expect(picker).toContain("presentation?: 'default' | 'inline'");
    expect(picker).toContain('data-image-asset-picker-presentation={presentation}');
    expect(picker).toContain('const selectAsset = (assetId: string | null)');
    expect(styles).toContain('.image-asset-picker-inline');
    expect(styles).toContain('min-height: 52px;');
    expect(polish).toContain('.character-expression-workspace');
    expect(polish).toContain('max-height: none;');
    expect(polish).not.toContain('.character-settings-workspace');
  });

  it('keeps Cancel/Apply rename semantics and removes the redundant edit-state exit action', () => {
    const editor = source(
      'src/renderer/features/characters/ExpressionEditor.tsx',
    );
    const landscapeEditor = editor.slice(
      editor.indexOf('function LandscapeExpressionEditor'),
    );

    expect(landscapeEditor).toContain('expression-cancel-${editingExpression.id}');
    expect(landscapeEditor).toContain('expression-apply-${editingExpression.id}');
    expect(landscapeEditor).toContain('expressionRenameValue(editingName, expression.name)');
    expect(landscapeEditor).toContain('onRename(expression.id, nextName)');
    expect(landscapeEditor).toContain("!isEditing ? (");
    expect(landscapeEditor).not.toContain("{isEditing ? '收起' : '编辑'}");
  });
});
