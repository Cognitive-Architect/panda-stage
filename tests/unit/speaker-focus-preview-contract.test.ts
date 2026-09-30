import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { commitStageVisualFrame, selectStageVisualFrame } from '../../src/renderer/stage/stageVisualFrame';

const overlay = readFileSync('src/renderer/shell/ProductPreviewOverlay.tsx', 'utf8');
const renderer = readFileSync('src/renderer/stage/StageRenderer.tsx', 'utf8');
const shell = readFileSync('src/renderer/shell/EditorShell.tsx', 'utf8');
const previewLayout = readFileSync('src/renderer/styles/shell/product-preview/s17-01--whole-project-preview.css', 'utf8');
const previewFrameLayout = readFileSync('src/renderer/styles/shell/product-preview/s06-09--product-preview.css', 'utf8');

function parseTsx(source: string): ts.SourceFile {
  return ts.createSourceFile('contract.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function descendants<T extends ts.Node>(root: ts.Node, predicate: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  const visit = (node: ts.Node): void => {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function speakerFocusDefaultsOff(source: string): boolean {
  return descendants(parseTsx(source), ts.isVariableDeclaration).some((declaration) => {
    if (!ts.isArrayBindingPattern(declaration.name)) return false;
    const [value, setter] = declaration.name.elements;
    if (!value || ts.isOmittedExpression(value) || !setter || ts.isOmittedExpression(setter)) return false;
    if (value.name.getText() !== 'speakerFocus' || setter.name.getText() !== 'setSpeakerFocus') return false;
    const initializer = declaration.initializer;
    return Boolean(
      initializer &&
      ts.isCallExpression(initializer) &&
      initializer.expression.getText() === 'useState' &&
      initializer.arguments.length === 1 &&
      initializer.arguments[0]?.kind === ts.SyntaxKind.FalseKeyword,
    );
  });
}

function jsxTag(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
  return ts.isJsxElement(node)
    ? node.openingElement.tagName.getText()
    : node.tagName.getText();
}

function jsxStringAttribute(node: ts.JsxElement, name: string): string | null {
  const attribute = node.openingElement.attributes.properties.find((item) =>
    ts.isJsxAttribute(item) && ts.isIdentifier(item.name) && item.name.text === name,
  );
  return attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isStringLiteral(attribute.initializer)
    ? attribute.initializer.text
    : null;
}

function isCameraWorld(node: ts.Node): node is ts.JsxElement {
  if (!ts.isJsxElement(node) || jsxTag(node) !== 'Group') return false;
  return node.openingElement.attributes.properties.some((attribute) =>
    ts.isJsxAttribute(attribute) &&
    ts.isIdentifier(attribute.name) &&
    attribute.name.text === 'name' &&
    attribute.initializer &&
    ts.isStringLiteral(attribute.initializer) &&
    attribute.initializer.text === 'camera-world',
  );
}

function worldAndScreenAreSeparated(source: string): boolean {
  const ast = parseTsx(source);
  const worlds = descendants(ast, isCameraWorld);
  if (worlds.length !== 1) return false;
  const world = worlds[0]!;
  const layers = descendants(ast, ts.isJsxElement).filter((node) => jsxTag(node) === 'Layer');
  const owner = layers.find((layer) => layer.children.includes(world));
  if (!owner) return false;
  const children = owner.children.filter(
    (child): child is ts.JsxElement | ts.JsxSelfClosingElement =>
      ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child),
  );
  const worldIndex = children.indexOf(world);
  const subtitleIndex = children.findIndex((child) => jsxTag(child) === 'SubtitleRenderer');
  const diagnosticIndex = children.findIndex((child) => jsxTag(child) === 'Text');
  return (
    worldIndex >= 0 &&
    subtitleIndex > worldIndex &&
    diagnosticIndex > subtitleIndex &&
    world.getText().includes('displayModel!.layers.map') &&
    world.getText().includes('<KonvaImage') &&
    !world.getText().includes('<SubtitleRenderer') &&
    !world.getText().includes('<Text')
  );
}

describe('Speaker Focus Preview integration contract', () => {
  it('reserves the close hit area at accepted and narrow Preview widths', () => {
    const ast = parseTsx(overlay);
    const elements = descendants(ast, ts.isJsxElement);
    const frame = elements.find((node) => jsxStringAttribute(node, 'className') === 'product-preview-frame');
    expect(frame).toBeDefined();
    const close = frame!.children.find((child): child is ts.JsxElement =>
      ts.isJsxElement(child) && jsxStringAttribute(child, 'data-testid') === 'product-preview-close',
    );
    const player = descendants(frame!, ts.isJsxElement).find((node) =>
      jsxStringAttribute(node, 'className') === 'product-preview-player',
    );
    expect(close).toBeDefined();
    expect(player).toBeDefined();
    const meta = player!.children.find((child): child is ts.JsxElement =>
      ts.isJsxElement(child) && jsxStringAttribute(child, 'className') === 'product-preview-transport-meta',
    );
    expect(meta).toBeDefined();
    expect(meta!.getText()).toContain('product-preview-speaker-focus');
    expect(meta!.getText()).toContain('product-preview-range-control');
    expect(previewLayout).toMatch(/\.product-preview-transport-meta\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;[^}]*box-sizing:\s*border-box;[^}]*padding-inline-end:\s*calc\(var\(--ui-touch-icon\) \+ var\(--ui-space-3\)\);/u);
    expect(previewLayout).toMatch(/@media \(max-width: 680px\)[\s\S]*?\.product-preview-transport-meta\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/u);
    expect(previewFrameLayout).toMatch(/\.product-preview-close\s*\{[^}]*position:\s*absolute;[^}]*right:\s*10px;/u);
  });

  it('keeps the opt-in local to a newly mounted Preview and uses one resolver in both ranges', () => {
    expect(speakerFocusDefaultsOff(overlay)).toBe(true);
    expect(speakerFocusDefaultsOff(overlay.replace('const [speakerFocus, setSpeakerFocus] = useState(false)', 'const [speakerFocus, setSpeakerFocus] = useState(true)'))).toBe(false);
    expect(overlay).toContain('data-testid="product-preview-speaker-focus"');
    expect(overlay).toContain('aria-pressed={speakerFocus}');
    expect(overlay).toContain('prepareSpeakerFocusCamera(project, shot)');
    expect(overlay).toContain('evaluateSpeakerFocusCamera(cameraPlan, activeShotTimeMs)');
    expect(overlay).toContain('camera={camera}');
    expect(shell).toContain('setProductPreviewOpen(false)');
    expect(overlay).not.toMatch(/updateProject|HistoryStore|setDirty|setRevision/);
  });

  it('places world under Camera while screen-space subtitle and diagnostics stay outside', () => {
    expect(worldAndScreenAreSeparated(renderer)).toBe(true);
    const nestedGroupMutation = `<Layer><Group name="camera-world"><Group><KonvaImage /></Group>{displayModel!.layers.map((layer) => layer)}<SubtitleRenderer /><Text /></Group></Layer>`;
    expect(worldAndScreenAreSeparated(nestedGroupMutation)).toBe(false);
  });

  it('holds Camera with the exact completed visual frame during image replacement', () => {
    const old = { model: { timeMs: 10 }, caption: 'A', camera: { centerX: 640, centerY: 500, zoom: 1.5 } };
    const desired = { model: { timeMs: 20 }, caption: 'B', camera: { centerX: 1280, centerY: 500, zoom: 1.5 } };
    const committed = commitStageVisualFrame(null, old, true);
    expect(selectStageVisualFrame(committed, desired, false)).toEqual(old);
    expect(renderer).toContain('displayFrame ? displayFrame.camera : camera');
  });
});
