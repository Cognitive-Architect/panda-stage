import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { commitStageVisualFrame, selectStageVisualFrame } from '../../src/renderer/stage/stageVisualFrame';

const overlay = readFileSync('src/renderer/shell/ProductPreviewOverlay.tsx', 'utf8');
const renderer = readFileSync('src/renderer/stage/StageRenderer.tsx', 'utf8');
const shell = readFileSync('src/renderer/shell/EditorShell.tsx', 'utf8');

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
