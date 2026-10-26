import path from 'node:path';

export interface FormalOutputNameSeries {
  directory: string;
  baseName: string;
  nextOrdinal: number;
}

interface PendingFormalOutputNameSeries {
  projectKey: string;
  series: FormalOutputNameSeries;
}

function normalizedPathKey(rawPath: string): string {
  return path.resolve(rawPath).toLocaleLowerCase('en-US');
}

export class FormalOutputNameSeriesService {
  private readonly seriesByProject = new Map<string, FormalOutputNameSeries>();
  private readonly pendingByOutputPath = new Map<
    string,
    PendingFormalOutputNameSeries
  >();

  getSeries(projectRoot: string, initialDefaultPath: string): FormalOutputNameSeries {
    const existing = this.seriesByProject.get(normalizedPathKey(projectRoot));
    if (existing) return { ...existing };

    const parsedDefaultPath = path.parse(path.resolve(initialDefaultPath));
    return {
      directory: parsedDefaultPath.dir,
      baseName: parsedDefaultPath.name,
      nextOrdinal: 1,
    };
  }

  recordSelection(
    projectRoot: string,
    currentSeries: FormalOutputNameSeries,
    suggestedPath: string,
    suggestedOrdinal: number,
    selectedPath: string,
  ): void {
    const resolvedSelectedPath = path.resolve(selectedPath);
    const selected = path.parse(resolvedSelectedPath);
    const suggestedName = path.parse(path.resolve(suggestedPath)).name;
    const keptSuggestedName =
      selected.name.toLocaleLowerCase('en-US') ===
      suggestedName.toLocaleLowerCase('en-US');

    this.pendingByOutputPath.set(normalizedPathKey(resolvedSelectedPath), {
      projectKey: normalizedPathKey(projectRoot),
      series: {
        directory: selected.dir,
        baseName: keptSuggestedName ? currentSeries.baseName : selected.name,
        nextOrdinal: keptSuggestedName
          ? Math.max(2, Math.floor(suggestedOrdinal) + 1)
          : 2,
      },
    });
  }

  recordCompletedOutput(outputPath: string): boolean {
    const key = normalizedPathKey(outputPath);
    const pending = this.pendingByOutputPath.get(key);
    if (!pending) return false;

    this.seriesByProject.set(pending.projectKey, { ...pending.series });
    this.pendingByOutputPath.delete(key);
    return true;
  }

  discardOutput(outputPath: string): void {
    this.pendingByOutputPath.delete(normalizedPathKey(outputPath));
  }
}
