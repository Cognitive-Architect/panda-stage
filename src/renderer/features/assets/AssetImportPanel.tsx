import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AssetImportResult,
} from '../../../shared/asset-import-api';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { applyAssetImportResponse } from './applyAssetImportResponse';
import { useAssetDrop } from './useAssetDrop';

export interface AssetImportPanelProps {
  snapshot: EditorProjectSnapshot | null;
  importRequestToken?: number;
  onImportFla: () => void;
}

function resultClass(result: AssetImportResult): string {
  return `asset-import-result asset-import-result-${result.status}`;
}

export function AssetImportPanel({
  snapshot,
  importRequestToken,
  onImportFla,
}: AssetImportPanelProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    '打开项目后，可把 PNG、JPG、MP3 或 WAV 安全复制到项目中。',
  );
  const [results, setResults] = useState<AssetImportResult[]>([]);

  const applyResponse = useCallback(
    (response: Awaited<
      ReturnType<typeof window.pandaStage.assets.choose>
    >): void => {
      const outcome = applyAssetImportResponse(
        response,
        editorProjectStore,
      );
      if (outcome.results) setResults(outcome.results);
      setStatus(outcome.status);
    },
    [],
  );

  const chooseFiles = useCallback(async (): Promise<void> => {
    const current = editorProjectStore.getSnapshot();
    if (!current) return;
    setBusy(true);
    try {
      applyResponse(
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
        applyResponse(
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
      <div className="asset-import-actions">
        <button
          data-testid="asset-import-fla"
          disabled={snapshot === null || busy}
          onClick={onImportFla}
          type="button"
        >
          导入 FLA
        </button>
        <span>打开 FLA 后可先预览并选择需要的素材，确认导入前不会修改项目。</span>
      </div>
      <p className="asset-import-drop">
        {snapshot
          ? '也可以把素材文件拖到这里导入项目。'
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
