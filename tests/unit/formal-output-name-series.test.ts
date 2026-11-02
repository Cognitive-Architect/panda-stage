import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileSystemService } from '../../src/main/services/FileSystemService';
import { FormalOutputNameSeriesService } from '../../src/main/services/FormalOutputNameSeriesService';

describe('FormalOutputNameSeriesService', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  async function harness(): Promise<{
    root: string;
    projectRoot: string;
    fileSystem: FileSystemService;
    series: FormalOutputNameSeriesService;
    defaultPath: string;
  }> {
    const root = await mkdtemp(
      path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-stage-name-series-'),
    );
    temporaryRoots.push(root);
    const projectRoot = path.join(root, 'Sample.pandastage');
    await mkdir(projectRoot, { recursive: true });
    return {
      root,
      projectRoot,
      fileSystem: new FileSystemService(path.join(root, 'frames')),
      series: new FormalOutputNameSeriesService(),
      defaultPath: path.join(projectRoot, '作品.mp4'),
    };
  }

  it('suggests and commits three consecutive defaults without nesting suffixes', async () => {
    const { projectRoot, fileSystem, series, defaultPath } = await harness();
    const expected = [
      path.join(projectRoot, '作品.mp4'),
      path.join(projectRoot, '作品 (2).mp4'),
      path.join(projectRoot, '作品 (3).mp4'),
    ];

    for (const outputPath of expected) {
      const current = series.getSeries(projectRoot, defaultPath);
      const suggestion = await fileSystem.suggestFormalOutputPathWithOrdinal(
        path.join(current.directory, `${current.baseName}.mp4`),
        current.nextOrdinal,
      );
      expect(suggestion.path).toBe(outputPath);

      series.recordSelection(
        projectRoot,
        current,
        suggestion.path,
        suggestion.ordinal,
        suggestion.path,
      );
      await writeFile(suggestion.path, `completed ${path.basename(outputPath)}`, 'utf8');
      expect(series.recordCompletedOutput(suggestion.path)).toBe(true);
    }

    await expect(readFile(expected[0]!, 'utf8')).resolves.toBe('completed 作品.mp4');
    await expect(readFile(expected[1]!, 'utf8')).resolves.toBe('completed 作品 (2).mp4');
    await expect(readFile(expected[2]!, 'utf8')).resolves.toBe('completed 作品 (3).mp4');
  });

  it('keeps the selected directory while continuing the same automatic series', async () => {
    const { root, projectRoot, fileSystem, series, defaultPath } = await harness();
    const first = series.getSeries(projectRoot, defaultPath);
    const firstSuggestion = await fileSystem.suggestFormalOutputPathWithOrdinal(
      path.join(first.directory, `${first.baseName}.mp4`),
      first.nextOrdinal,
    );
    series.recordSelection(
      projectRoot,
      first,
      firstSuggestion.path,
      firstSuggestion.ordinal,
      firstSuggestion.path,
    );
    await writeFile(firstSuggestion.path, 'first export', 'utf8');
    series.recordCompletedOutput(firstSuggestion.path);

    const second = series.getSeries(projectRoot, defaultPath);
    const secondSuggestion = await fileSystem.suggestFormalOutputPathWithOrdinal(
      path.join(second.directory, `${second.baseName}.mp4`),
      second.nextOrdinal,
    );
    const chosenDirectory = path.join(root, 'chosen-output');
    await mkdir(chosenDirectory);
    const selectedSecondPath = path.join(chosenDirectory, path.basename(secondSuggestion.path));
    series.recordSelection(
      projectRoot,
      second,
      secondSuggestion.path,
      secondSuggestion.ordinal,
      selectedSecondPath,
    );
    await writeFile(selectedSecondPath, 'second export', 'utf8');
    series.recordCompletedOutput(selectedSecondPath);

    const third = series.getSeries(projectRoot, defaultPath);
    const thirdSuggestion = await fileSystem.suggestFormalOutputPathWithOrdinal(
      path.join(third.directory, `${third.baseName}.mp4`),
      third.nextOrdinal,
    );
    expect(thirdSuggestion.path).toBe(path.join(chosenDirectory, '作品 (3).mp4'));
  });

  it('preserves a custom Episode (2) title instead of parsing it as an automatic suffix', async () => {
    const { root, projectRoot, fileSystem, series, defaultPath } = await harness();
    const current = series.getSeries(projectRoot, defaultPath);
    const suggestion = await fileSystem.suggestFormalOutputPathWithOrdinal(
      path.join(current.directory, `${current.baseName}.mp4`),
      current.nextOrdinal,
    );
    const customPath = path.join(root, 'Episode (2).mp4');
    series.recordSelection(
      projectRoot,
      current,
      suggestion.path,
      suggestion.ordinal,
      customPath,
    );
    await writeFile(customPath, 'custom title export', 'utf8');
    series.recordCompletedOutput(customPath);

    const next = series.getSeries(projectRoot, defaultPath);
    expect(next).toEqual({
      directory: root,
      baseName: 'Episode (2)',
      nextOrdinal: 2,
    });
    const nextSuggestion = await fileSystem.suggestFormalOutputPathWithOrdinal(
      path.join(next.directory, `${next.baseName}.mp4`),
      next.nextOrdinal,
    );
    expect(nextSuggestion.path).toBe(path.join(root, 'Episode (2) (2).mp4'));
  });

  it('does not advance a series when a selected output fails or is cancelled', async () => {
    const { projectRoot, fileSystem, series, defaultPath } = await harness();
    const current = series.getSeries(projectRoot, defaultPath);
    const suggestion = await fileSystem.suggestFormalOutputPathWithOrdinal(
      path.join(current.directory, `${current.baseName}.mp4`),
      current.nextOrdinal,
    );
    series.recordSelection(
      projectRoot,
      current,
      suggestion.path,
      suggestion.ordinal,
      suggestion.path,
    );
    series.discardOutput(suggestion.path);

    expect(series.getSeries(projectRoot, defaultPath)).toEqual(current);
    await expect(
      fileSystem.suggestFormalOutputPathWithOrdinal(
        path.join(current.directory, `${current.baseName}.mp4`),
        current.nextOrdinal,
      ),
    ).resolves.toEqual(suggestion);
  });
});
