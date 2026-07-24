import { useCallback, useState } from 'react';
import type {
  AssetImportResponse,
  AssetImportResult,
} from '../../../shared/asset-import-api';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { useAssetDrop } from './useAssetDrop';

export interface AssetImportPanelProps {
  snapshot: EditorProjectSnapshot | null;
}

function resultClass(result: AssetImportResult): string {
  return `asset-import-result asset-import-result-${result.status}`;
}

export function AssetImportPanel({
  snapshot,
}: AssetImportPanelProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    '打开项目后，可把 PNG、JPG、MP3 或 WAV 安全复制到项目中。',
  );
  const [results, setResults] = useState<AssetImportResult[]>([]);

  const applyResponse = useCallback(
    (response: AssetImportResponse): void => {
      if (!response.ok) {
        setStatus(response.error.message);
        return;
      }
      if (response.status === 'cancelled') {
        setStatus('已取消素材导入，项目未发生变化。');
        return;
      }
      setResults(response.results);
      if (response.projectChanged) {
        const importedAssets = response.results.flatMap((result) =>
          result.status === 'imported' && result.asset
            ? [result.asset]
            : [],
        );
        const acknowledgement = editorProjectStore.applyAssetImport(
          response.project,
          importedAssets,
          response.baseRevision,
          response.savedRevision,
        );
        setStatus(
          acknowledgement === 'current'
            ? '素材已复制并保存到项目。'
            : '素材已保存；导入期间的新编辑仍保持未保存状态。',
        );
        return;
      }
      setStatus(
        response.results.some((result) => result.status === 'duplicate')
          ? '没有复制重复素材；已保留并复用原素材记录。'
          : '没有素材被导入，项目未发生变化。',
      );
    },
    [],
  );

  const chooseFiles = async (): Promise<void> => {
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
  };

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
          <p className="eyebrow">Day 16 secure import</p>
          <h2 id="asset-import-heading">导入项目素材</h2>
        </div>
        <button
          disabled={busy || snapshot === null}
          onClick={() => void chooseFiles()}
          type="button"
        >
          选择 PNG / JPG / MP3 / WAV
        </button>
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
