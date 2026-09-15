import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('Issue #528 single-card inline Expression editor', () => {
  it('keeps the editing card in one grid column and preserves the large preview', () => {
    const editor = source(
      'src/renderer/features/characters/ExpressionEditor.tsx',
    );
    const styles = source('src/renderer/styles.css');
    const polishStart = styles.indexOf('/* Issue #528:');
    const polish = styles.slice(polishStart);

    expect(polishStart).toBeGreaterThanOrEqual(0);
    expect(polish).toContain('.expression-card.expression-card-editing');
    expect(polish).toContain('grid-column: auto;');
    expect(polish).toContain(
      'grid-template-columns: minmax(0, 1fr);',
    );
    expect(polish).toContain('height: 84px;');
    expect(styles).toContain(
      'grid-template-columns: repeat(2, minmax(0, 1fr));',
    );
    expect(editor).toContain('data-expression-editing={isEditing}');
    expect(editor).toContain('setEditingExpressionId(expression.id)');
  });

  it('uses the shared picker inline seam without changing selection ownership', () => {
    const editor = source(
      'src/renderer/features/characters/ExpressionEditor.tsx',
    );
    const picker = source(
      'src/renderer/features/characters/ImageAssetPicker.tsx',
    );
    const styles = source('src/renderer/styles.css');
    const polish = styles.slice(styles.indexOf('/* Issue #528:'));

    expect(editor).toContain('label="图片"');
    expect(editor).toContain('presentation="inline"');
    expect(editor).not.toContain('当前素材');
    expect(editor).not.toContain('更换素材会立即应用；名称修改请点击应用。');
    expect(picker).toContain("presentation?: 'default' | 'inline'");
    expect(picker).toContain('data-image-asset-picker-presentation={presentation}');
    expect(picker).toContain('const selectAsset = (assetId: string | null)');
    expect(polish).toContain('.image-asset-picker-inline');
    expect(polish).toContain('min-height: 52px;');
    expect(polish).toContain('max-height: 200px;');
  });

  it('keeps Cancel/Apply rename semantics and removes the redundant edit-state exit action', () => {
    const editor = source(
      'src/renderer/features/characters/ExpressionEditor.tsx',
    );
    const landscapeEditor = editor.slice(
      editor.indexOf('function LandscapeExpressionEditor'),
    );

    expect(landscapeEditor).toContain('expression-cancel-${expression.id}');
    expect(landscapeEditor).toContain('expression-apply-${expression.id}');
    expect(landscapeEditor).toContain('expressionRenameValue(editingName, expression.name)');
    expect(landscapeEditor).toContain('onRename(expression.id, nextName)');
    expect(landscapeEditor).toContain("!isEditing ? (");
    expect(landscapeEditor).not.toContain("{isEditing ? '收起' : '编辑'}");
  });
});
