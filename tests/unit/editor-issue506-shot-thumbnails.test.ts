import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  ProjectSchema,
  migrateProject,
} from '../../src/domain';
import {
  requestShotThumbnail,
  SHOT_THUMBNAIL_MAX_CONCURRENT_RENDERS,
  shotThumbnailFingerprint,
} from '../../src/renderer/features/shots/shotThumbnail';
import { ShotEditor } from '../../src/renderer/features/shots/ShotEditor';
import { ShotListItem } from '../../src/renderer/features/shots/ShotListItem';
import { ShotManager } from '../../src/renderer/features/shots/ShotManager';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

function source(path: string): string {
  if (path === 'src/renderer/styles.css') return readOrderedStylesheetSource();
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

const noop = () => undefined;

describe('Issue #506 shared Shot composite thumbnails', () => {
  it('fingerprints only the visual Shot composition', () => {
    const project = migrateProject(exampleProject);
    const shot = project.shots[0]!;
    const baseline = shotThumbnailFingerprint(project, shot);
    const presentationOnly = ProjectSchema.parse({
      ...project,
      name: 'Renamed project',
      shots: project.shots.map((candidate) =>
        candidate.id === shot.id
          ? {
              ...candidate,
              name: 'Renamed shot',
              durationMs: candidate.durationMs + 100,
              dialogues: [],
              audioClips: [],
              timelineEvents: [],
            }
          : candidate,
      ),
    });

    expect(shotThumbnailFingerprint(presentationOnly, presentationOnly.shots[0]!)).toBe(
      baseline,
    );

    const visualChange = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((candidate) =>
        candidate.id === shot.id
          ? {
              ...candidate,
              layers: candidate.layers.map((layer, index) =>
                index === 0
                  ? {
                      ...layer,
                      x: layer.x + 10,
                      flipX: !layer.flipX,
                      visible: !layer.visible,
                    }
                  : layer,
              ),
            }
          : candidate,
      ),
    });

    expect(shotThumbnailFingerprint(visualChange, visualChange.shots[0]!)).not.toBe(
      baseline,
    );
  });

  it('uses an empty fallback without touching the browser renderer', async () => {
    const project = migrateProject(exampleProject);
    const emptyProject = ProjectSchema.parse({
      ...project,
      shots: [
        {
          ...project.shots[0]!,
          layers: [],
          backgroundLayerId: null,
          timelineEvents: [],
        },
      ],
    });
    const result = await requestShotThumbnail({
      projectRoot: 'D:\\issue-506-empty-shot',
      project: emptyProject,
      shot: emptyProject.shots[0]!,
    });

    expect(result.status).toBe('empty');
    expect(SHOT_THUMBNAIL_MAX_CONCURRENT_RENDERS).toBe(1);
  });

  it('degrades to a missing-source result when asset thumbnails are unavailable', async () => {
    const project = migrateProject(exampleProject);
    const result = await requestShotThumbnail({
      projectRoot: 'D:\\issue-506-missing-source',
      project,
      shot: project.shots[0]!,
    });

    expect(result.status).toBe('missing');
  });

  it('mounts A12 and A13 through the same lazy ShotThumbnail component', () => {
    const project = migrateProject(exampleProject);
    const shot = project.shots[0]!;
    const listItem = renderToStaticMarkup(
      createElement(ShotListItem, {
        index: 0,
        onDropShot: noop,
        onSelect: noop,
        project,
        projectRoot: 'D:\\issue-506-project',
        selected: true,
        shot,
      }),
    );
    const editor = renderToStaticMarkup(
      createElement(ShotEditor, {
        index: 0,
        onDuplicate: noop,
        onRemove: noop,
        onRename: noop,
        onSetDuration: noop,
        project,
        projectRoot: 'D:\\issue-506-project',
        shot,
      }),
    );
    const manager = renderToStaticMarkup(
      createElement(ShotManager, {
        snapshot: {
          projectRoot: 'D:\\issue-506-project',
          project,
          dirty: false,
          revision: 0,
        },
      }),
    );
    const thumbnail = source(
      'src/renderer/features/shots/shotThumbnail.ts',
    );
    const view = source(
      'src/renderer/features/shots/ShotThumbnailView.tsx',
    );
    const listSource = source(
      'src/renderer/features/shots/ShotListItem.tsx',
    );
    const editorSource = source(
      'src/renderer/features/shots/ShotEditor.tsx',
    );
    const styles = source('src/renderer/styles.css');

    expect(listItem).toContain('data-testid="shot-thumbnail"');
    expect(editor).toContain('data-testid="shot-thumbnail"');
    expect(manager.match(/data-testid="shot-thumbnail"/gu)).toHaveLength(2);
    expect(manager).toContain('data-thumbnail-status="loading"');
    expect(listSource).toContain("from './ShotThumbnailView'");
    expect(editorSource).toContain("from './ShotThumbnailView'");
    expect(view).toContain('requestShotThumbnail');
    expect(thumbnail).toContain('buildEditorStageRenderModel');
    expect(thumbnail).toContain('window.pandaStage.assets.readThumbnail');
    expect(thumbnail).toContain('inFlightThumbnails');
    expect(thumbnail).toContain(
      'SHOT_THUMBNAIL_MAX_CONCURRENT_RENDERS = 1',
    );
    expect(thumbnail).not.toContain('evaluateShotAtTime');
    expect(thumbnail).not.toContain('SubtitleRenderer');
    expect(thumbnail).not.toContain('ipcRenderer');
    expect(styles).toContain('.shot-thumbnail img');
    expect(styles).toContain('.shot-editor-body > .shot-thumbnail');
  });
});
