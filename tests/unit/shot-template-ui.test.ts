import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { ShotService, migrateProject } from '../../src/domain';
import {
  defaultTemplateName,
  ShotQuickActions,
} from '../../src/renderer/features/shots/ShotQuickActions';
import { ShotCreateForm } from '../../src/renderer/features/shots/ShotCreateForm';
import { ShotManager } from '../../src/renderer/features/shots/ShotManager';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

function source(path: string): string {
  if (path === 'src/renderer/styles.css') return readOrderedStylesheetSource();
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function projectWithTemplates() {
  let counter = 0;
  const service = new ShotService({
    createId: () =>
      `d3020000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    now: () => new Date('2026-11-07T05:20:00.000Z'),
  });
  const project = migrateProject(exampleProject);
  const shotId = project.shots[0]!.id;
  const once = service.saveAsTemplate(project, {
    shotId,
    name: '客厅双人对话',
  });
  return service.saveAsTemplate(once, { shotId, name: '宗门大厅' });
}

function renderQuickActions() {
  const project = projectWithTemplates();
  return renderToStaticMarkup(
    createElement(ShotQuickActions, {
      index: 0,
      onDuplicate: () => undefined,
      onRemove: () => undefined,
      onRename: () => undefined,
      onSaveAsTemplate: () => undefined,
      onSetDuration: () => undefined,
      shot: project.shots[0]!,
    }),
  );
}

describe('Shot template Foundation UI', () => {
  it('offers 保存为模板 inside the existing 更多 menu, between copy and delete', () => {
    const markup = renderQuickActions();

    const copy = markup.indexOf('data-testid="shot-quick-duplicate"');
    const save = markup.indexOf('data-testid="shot-quick-save-template"');
    const remove = markup.indexOf('data-testid="shot-quick-delete"');
    expect(copy).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(copy);
    expect(remove).toBeGreaterThan(save);
    expect(markup).toContain('保存为模板');
    // The inline name form only mounts after the menu entry is chosen.
    expect(markup).not.toContain('data-testid="shot-quick-save-template-form"');
  });

  it('labels the default template name after the source Shot', () => {
    expect(defaultTemplateName('客厅双人对话')).toBe('客厅双人对话 模板');
  });

  it('lists templates in the existing create form with layer count, duration and one delete action', () => {
    const project = projectWithTemplates();
    const markup = renderToStaticMarkup(
      createElement(ShotCreateForm, {
        onBack: () => undefined,
        onCreate: () => true,
        onCreateFromTemplate: () => true,
        onRemoveTemplate: () => undefined,
        presentation: 'landscape',
        suggestedName: '镜头 6',
        templates: project.shotTemplates,
      }),
    );

    expect(markup).toContain('data-testid="shot-create-templates"');
    expect(markup).toContain('模板');
    expect(markup).toContain('空白镜头');
    expect(markup).toContain('客厅双人对话');
    expect(markup).toContain('宗门大厅');
    expect(markup).toContain('2 个图层');
    expect(markup).toContain('3.0 秒');
    expect(markup).toContain(
      `aria-label="删除模板 客厅双人对话"`,
    );
    expect(markup).toContain(
      `data-testid="shot-create-template-remove-${project.shotTemplates[0]!.id}"`,
    );
    // Blank-shot creation keeps the existing duration controls and single CTA.
    expect(markup).toContain('data-testid="shot-create-duration-input"');
    expect(markup).toContain('data-testid="shot-create-submit"');
  });

  it('keeps the blank-shot form unchanged when the project has no templates', () => {
    const markup = renderToStaticMarkup(
      createElement(ShotCreateForm, {
        onBack: () => undefined,
        onCreate: () => true,
        presentation: 'landscape',
        suggestedName: '镜头 6',
      }),
    );

    expect(markup).not.toContain('data-testid="shot-create-templates"');
    expect(markup).not.toContain('来自模板');
    expect(markup).toContain('data-testid="shot-create-duration-input"');
  });

  it('reaches templates from the Shot create view and from the selected-Shot actions', () => {
    const project = projectWithTemplates();
    const snapshot = {
      projectRoot: 'D:\\模板 项目.pandastage',
      project,
      dirty: false,
      revision: 0,
    };

    const createMarkup = renderToStaticMarkup(
      createElement(ShotManager, {
        onViewChange: () => undefined,
        presentation: 'landscape',
        snapshot,
        view: 'create',
      }),
    );
    expect(createMarkup).toContain('data-testid="shot-create-templates"');
    expect(createMarkup).toContain('客厅双人对话');

    const listMarkup = renderToStaticMarkup(
      createElement(ShotManager, { presentation: 'landscape', snapshot }),
    );
    expect(listMarkup).toContain('data-testid="shot-quick-save-template"');
  });

  it('routes every template action through ShotManager and the Shot store', () => {
    const manager = source('src/renderer/features/shots/ShotManager.tsx');
    expect(manager).toContain('shotStore.saveAsTemplate(');
    expect(manager).toContain('shotStore.createFromTemplate(');
    expect(manager).toContain('shotStore.removeTemplate(');
    expect(manager).toContain('templates={project?.shotTemplates ?? []}');
    expect(manager).toContain('onCreateFromTemplate={createShotFromTemplate}');
    expect(manager).toContain('onRemoveTemplate={removeShotTemplate}');

    const store = source('src/renderer/stores/shotStore.ts');
    expect(store).toContain('this.service.saveAsTemplate(project, { shotId, name })');
    expect(store).toContain(
      "this.service.createFromTemplate(current, { templateId, shotName })",
    );
    expect(store).toContain('this.service.removeTemplate(project, templateId)');

    // The form never writes the Project itself.
    const form = source('src/renderer/features/shots/ShotCreateForm.tsx');
    expect(form).not.toContain('updateProject');
    expect(form).not.toContain('shotStore');
  });

  it('registers the template stylesheet once', () => {
    const entry = readFileSync('src/renderer/styles.css', 'utf8').replaceAll(
      '\r\n',
      '\n',
    );
    expect(
      entry.match(/s09-06--shot-templates\.css/gu) ?? [],
    ).toHaveLength(1);

    const css = source(
      'src/renderer/styles/features/shots/s09-06--shot-templates.css',
    );
    expect(css).toContain('.shot-create-templates');
    expect(css).toContain('.shot-create-template-remove');
    expect(css).toContain('.shot-create-template-duration');
  });
});
