import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUBTITLE_STROKE_COLOR,
  ProjectSchema,
  SubtitleStyleSchema,
  SubtitleStyleService,
  SubtitleStyleServiceError,
  type SubtitleStylePatch,
} from '../../../src/domain';
import { SubtitleRenderer } from '../../../src/renderer/features/subtitles/SubtitleRenderer';
import { EditorProjectStore } from '../../../src/renderer/stores/EditorProjectStore';
import { SubtitleStyleStore } from '../../../src/renderer/stores/subtitleStyleStore';
import { DEFAULT_SUBTITLE_STYLE } from '../../../src/shared/preview/subtitle-layout';
import { buildProject, IDS } from './testProject';

const SECOND_STYLE_ID = '40000000-0000-4000-8000-000000000002';
const FIRST_DIALOGUE_ID = '70000000-0000-4000-8000-000000000001';
const SECOND_DIALOGUE_ID = '70000000-0000-4000-8000-000000000002';

function projectWithSharedDialogues() {
  const project = buildProject();
  return ProjectSchema.parse({
    ...project,
    subtitleStyles: [
      project.subtitleStyles[0]!,
      {
        ...project.subtitleStyles[0]!,
        id: SECOND_STYLE_ID,
        name: '另一个样式',
      },
    ],
    shots: [
      {
        ...project.shots[0]!,
        dialogues: [
          {
            id: FIRST_DIALOGUE_ID,
            characterId: IDS.character,
            voiceProfileId: IDS.voiceProfile,
            subtitleStyleId: IDS.subtitle,
            startMs: 0,
            endMs: 1_000,
            text: '第一句',
          },
          {
            id: SECOND_DIALOGUE_ID,
            characterId: IDS.character,
            voiceProfileId: IDS.voiceProfile,
            subtitleStyleId: IDS.subtitle,
            startMs: 1_100,
            endMs: 2_000,
            text: '第二句',
          },
        ],
      },
    ],
  });
}

function expectStyleError(
  action: () => unknown,
  code: SubtitleStyleServiceError['code'],
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(SubtitleStyleServiceError);
    expect((error as SubtitleStyleServiceError).code).toBe(code);
    return;
  }
  throw new Error(`Expected SubtitleStyleServiceError ${code}.`);
}

function textNode(element: React.JSX.Element): {
  props: Record<string, unknown>;
} {
  const children = element.props.children as Array<React.JSX.Element>;
  return children[1] as React.JSX.Element & {
    props: Record<string, unknown>;
  };
}

describe('SubtitleStyle R5 V1', () => {
  it('keeps legacy styles valid and renders missing stroke fields as off', () => {
    const project = buildProject();
    const style = SubtitleStyleSchema.parse(project.subtitleStyles[0]);
    expect(style.strokeColor).toBeUndefined();
    expect(style.strokeWidth).toBeUndefined();
    expect(DEFAULT_SUBTITLE_STYLE.strokeWidth).toBe(0);

    const rendered = SubtitleRenderer({ text: '字幕', style });
    const text = textNode(rendered!);
    expect(text.props.stroke).toBe(DEFAULT_SUBTITLE_STROKE_COLOR);
    expect(text.props.strokeWidth).toBe(0);
  });

  it('projects real Konva stroke props without introducing another text node', () => {
    const project = projectWithSharedDialogues();
    const style = {
      ...project.subtitleStyles[0]!,
      strokeColor: '#17231b',
      strokeWidth: 6,
    };
    const rendered = SubtitleRenderer({ text: '字幕', style });
    const element = rendered!;
    const children = element.props.children as Array<React.JSX.Element>;
    const text = textNode(element);

    expect(children).toHaveLength(2);
    expect(text.props).toMatchObject({
      fill: style.textColor,
      fillAfterStrokeEnabled: true,
      stroke: '#17231b',
      strokeWidth: 6,
    });
  });

  it('updates one shared style while preserving every Dialogue reference', () => {
    const project = projectWithSharedDialogues();
    const service = new SubtitleStyleService({
      now: () => new Date('2026-09-13T14:00:00.000Z'),
    });
    const next = service.update(project, IDS.subtitle, {
      fontSize: 64,
      textColor: '#fffdf6',
      strokeColor: '#000000',
      strokeWidth: 6,
      position: 'center',
    });

    expect(next.subtitleStyles).toHaveLength(2);
    expect(next.subtitleStyles[0]).toMatchObject({
      id: IDS.subtitle,
      fontSize: 64,
      strokeColor: '#000000',
      strokeWidth: 6,
      position: 'center',
    });
    expect(next.shots[0]!.dialogues.map((dialogue) => dialogue.subtitleStyleId))
      .toEqual([IDS.subtitle, IDS.subtitle]);
    expect(next.updatedAt).toBe('2026-09-13T14:00:00.000Z');
    expect(project.subtitleStyles[0]!.strokeWidth).toBeUndefined();

    expect(service.update(next, IDS.subtitle, { strokeWidth: 6 })).toBe(next);
  });

  it('rejects unknown style ids and invalid patches without a partial project', () => {
    const project = projectWithSharedDialogues();
    const service = new SubtitleStyleService();

    expectStyleError(
      () => service.update(project, 'missing-style-id', { strokeWidth: 6 }),
      'SUBTITLE_STYLE_NOT_FOUND',
    );
    expectStyleError(
      () =>
        service.update(project, IDS.subtitle, {
          strokeWidth: -1,
        } as SubtitleStylePatch),
      'INVALID_SUBTITLE_STYLE_PATCH',
    );
    expectStyleError(
      () =>
        service.update(project, IDS.subtitle, {
          strokeColor: 'black',
        } as SubtitleStylePatch),
      'INVALID_SUBTITLE_STYLE_PATCH',
    );
    expect(project.subtitleStyles[0]!.strokeWidth).toBeUndefined();
  });

  it('routes store edits through EditorProjectStore history and dirty state', () => {
    const project = projectWithSharedDialogues();
    const editor = new EditorProjectStore();
    editor.open('D:\\r5-style.pandastage', project);
    const store = new SubtitleStyleStore(
      editor,
      new SubtitleStyleService({
        now: () => new Date('2026-09-13T14:01:00.000Z'),
      }),
    );

    store.update(IDS.subtitle, { strokeColor: '#000000', strokeWidth: 6 });
    expect(editor.getSnapshot()).toMatchObject({
      dirty: true,
      revision: 1,
    });
    expect(editor.getSnapshot()!.project.subtitleStyles[0]).toMatchObject({
      strokeColor: '#000000',
      strokeWidth: 6,
    });
    expect(editor.history.getSnapshot().undoCount).toBe(1);

    expect(editor.undo()).toBe(true);
    expect(editor.getSnapshot()).toMatchObject({
      dirty: false,
      revision: 2,
    });
    expect(editor.getSnapshot()!.project.subtitleStyles[0]!.strokeWidth).toBeUndefined();
    expect(editor.redo()).toBe(true);
    expect(editor.getSnapshot()!.project.subtitleStyles[0]!.strokeWidth).toBe(6);

    const reopened = ProjectSchema.parse(
      JSON.parse(JSON.stringify(editor.getSnapshot()!.project)),
    );
    expect(reopened.subtitleStyles[0]).toMatchObject({
      strokeColor: '#000000',
      strokeWidth: 6,
    });
  });

  it('keeps the shared controls in the existing DialogueInspector flow', () => {
    const controls = readFileSync(
      'src/renderer/features/subtitles/SubtitleStyleControls.tsx',
      'utf8',
    );
    const inspector = readFileSync(
      'src/renderer/features/dialogue/DialogueInspector.tsx',
      'utf8',
    );
    const renderer = readFileSync(
      'src/renderer/features/subtitles/SubtitleRenderer.tsx',
      'utf8',
    );

    for (const marker of [
      '字幕样式',
      '共享',
      '字号',
      '文字颜色',
      '描边',
      '描边颜色',
      '顶部',
      '中间',
      '底部',
      'type="color"',
      'role="switch"',
      'aria-disabled={!outlineEnabled}',
    ]) {
      expect(controls).toContain(marker);
    }
    expect(controls).not.toContain('应用');
    expect(renderer).toContain('stroke={');
    expect(renderer).toContain('strokeWidth={');

    const properties = inspector.slice(
      inspector.indexOf('if (propertiesPresentation)'),
      inspector.indexOf('if (landscapePresentation)'),
    );
    const landscapeStart = inspector.indexOf('if (landscapePresentation)');
    const landscape = inspector.slice(
      landscapeStart,
      inspector.lastIndexOf('\n  return ('),
    );
    expect(properties.indexOf('{subtitleStyleControls}')).toBeGreaterThan(-1);
    expect(properties.indexOf('{subtitleStyleControls}')).toBeLessThan(
      properties.indexOf('dialogue-properties-time-section'),
    );
    expect(landscape.indexOf('{subtitleStyleControls}')).toBeGreaterThan(-1);
  });
});
