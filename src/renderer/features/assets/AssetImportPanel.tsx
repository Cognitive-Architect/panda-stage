import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AssetImportResponse,
  AssetImportResult,
} from '../../../shared/asset-import-api';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { applyAssetImportResponse } from './applyAssetImportResponse';
import type { AssetMetadataBatchOutcome } from './assetMetadataQueue';
import { useAssetDrop } from './useAssetDrop';

export interface AssetImportPanelProps {
  snapshot: EditorProjectSnapshot | null;
  importRequestToken?: number;
  onImportedAudioAssets?: (
    assetIds: readonly string[],
  ) => Promise<AssetMetadataBatchOutcome>;
}

export function selectImportedAudioAssetIds(
  response: AssetImportResponse,
): string[] {
  if (
    !response.ok ||
    response.status !== 'completed' ||
    !response.projectChanged
  ) {
    return [];
  }
  return response.results.flatMap((result) =>
    result.status === 'imported' && result.asset?.kind === 'audio'
      ? [result.asset.id]
      : [],
  );
}

function resultClass(result: AssetImportResult): string {
  return `asset-import-result asset-import-result-${result.status}`;
}

export function AssetImportPanel({
  snapshot,
  importRequestToken,
  onImportedAudioAssets,
}: AssetImportPanelProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    '打开项目后，可把 PNG、JPG、MP3 或 WAV 安全复制到项目中。',
  );
  const [results, setResults] = useState<AssetImportResult[]>([]);

  const applyResponse = useCallback(
    async (response: Awaited<
      ReturnType<typeof window.pandaStage.assets.choose>
    >): Promise<void> => {
      const outcome = applyAssetImportResponse(
        response,
        editorProjectStore,
      );
      if (outcome.results) setResults(outcome.results);
      setStatus(outcome.status);

      const importedAudioIds = selectImportedAudioAssetIds(response);
      if (importedAudioIds.length === 0 || !onImportedAudioAssets) return;
      try {
        const metadata = await onImportedAudioAssets(importedAudioIds);
        setStatus(
          metadata.stopped
            ? 'Audio metadata analysis stopped because the active project changed.'
            : `Audio metadata analysis complete: ${metadata.readyCount} ready${
                metadata.errorCount > 0
                  ? `, ${metadata.errorCount} failed; retry failed items.`
                  : ''
              }.`,
        );
      } catch (error) {
        setStatus(
          error instanceof Error
            ? error.message
            : 'Audio metadata analysis failed.',
        );
      }
    },
    [onImportedAudioAssets],
  );

  const chooseFiles = useCallback(async (): Promise<void> => {
    const current = editorProjectStore.getSnapshot();
    if (!current) return;
    setBusy(true);
    try {
      await applyResponse(
        await window.pandaStage.assets.choose({
          projectRoot: current.projectRoot,
          project: current.project,
          baseRevision: current.revision,
        }),
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '素材导入失败。');
    } finally {
      setBusy(false);
    }
  }, [applyResponse]);

  const lastImportRequest = useRef(importRequestToken ?? 0);
  useEffect(() => {
    if (
      importRequestToken === undefined ||
      importRequestToken === lastImportRequest.current
    ) {
      return;
    }
    lastImportRequest.current = importRequestToken;
    void chooseFiles();
  }, [chooseFiles, importRequestToken]);

  const importDroppedFiles = useCallback(
    async (files: readonly File[]): Promise<void> => {
      const current = editorProjectStore.getSnapshot();
      if (!current) return;
      setBusy(true);
      try {
        await applyResponse(
          await window.pandaStage.assets.importDropped(
            {
              projectRoot: current.projectRoot,
              project: current.project,
              baseRevision: current.revision,
            },
            files,
          ),
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : '拖放导入失败。');
      } finally {
        setBusy(false);
      }
    },
    [applyResponse],
  );
  const dropHandlers = useAssetDrop(
    busy || snapshot === null,
    importDroppedFiles,
  );

  return (
    <section
      className="asset-import-panel"
      aria-labelledby="asset-import-heading"
      {...dropHandlers}
    >
      <div className="asset-import-heading">
        <div>
          <p className="eyebrow">安全素材导入</p>
          <h2 id="asset-import-heading">导入项目素材</h2>
        </div>
        <span className="asset-import-header-note">使用工作区顶部“导入素材”</span>
      </div>
      <p className="asset-import-drop">
        {snapshot
          ? '也可把文件拖放到这里。文件会经过类型、签名和 SHA-256 校验后复制到项目 assets/。'
          : '请先打开一个 .pandastage 项目。'}
      </p>
      {results.length > 0 ? (
        <ul className="asset-import-results">
          {results.map((result, index) => (
            <li
              className={resultClass(result)}
              key={`${result.sourceName}:${result.sha256 ?? index}`}
            >
              <strong>{result.status}</strong>
              <span>{result.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <output className="asset-import-status">{status}</output>
    </section>
  );
}
