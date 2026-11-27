import { useState } from 'react';
import { scanAssetReferences, updateImageAssetsAuthorMetadata, type ImageAsset, type ImageAssetAuthorMetadata } from '../../../domain';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { BatchRenameFields } from '../properties/BatchRenameFields';
import { IMAGE_ASSET_USAGE_OPTIONS } from './assetUsage';

export function BatchImageControls({ snapshot, images }: {
  snapshot: EditorProjectSnapshot;
  images: readonly ImageAsset[];
}): React.JSX.Element {
  const [ids, setIds] = useState<readonly string[]>([]);
  const [usage, setUsage] = useState<ImageAssetAuthorMetadata['usage'] | ''>('');
  const [keywords, setKeywords] = useState('');
  const [error, setError] = useState('');
  const [scannedSnapshot, setScannedSnapshot] = useState<EditorProjectSnapshot>();
  const [unusedIds, setUnusedIds] = useState<readonly string[]>([]);
  const selected = images.filter(({ id }) => ids.includes(id));
  const unused = scannedSnapshot === snapshot
    ? snapshot.project.assets.filter(({ id }) => unusedIds.includes(id))
    : undefined;

  function apply(metadata: (asset: ImageAsset) => ImageAssetAuthorMetadata): void {
    try {
      if (editorProjectStore.getSnapshot() !== snapshot) throw new Error('素材已变更，请重新选择。');
      const project = updateImageAssetsAuthorMetadata(
        snapshot.project, new Map(selected.map((asset) => [asset.id, metadata(asset)])),
      );
      if (project !== snapshot.project) editorProjectStore.updateProject(project, '批量编辑图片素材');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '批量编辑素材失败。');
    }
  }

  return <details data-testid="batch-image-controls">
    <summary>批量整理素材{selected.length ? `（${selected.length}）` : ''}</summary>
    {images.length ? <ul>{images.map((asset) => <li key={asset.id}>
      <label><input type="checkbox" checked={ids.includes(asset.id)} onChange={(event) => {
        const checked = event.target.checked;
        setIds((current) => checked ? [...current, asset.id] : current.filter((id) => id !== asset.id));
      }} />{asset.name}</label>
    </li>)}</ul> : null}
    <BatchRenameFields entries={selected}
      onApply={(names) => apply((asset) => ({ name: names.get(asset.id)!, usage: asset.usage, keywords: asset.keywords }))} />
    {selected.length ? <fieldset>
      <legend>批量分类</legend>
      <label>用途<select value={usage} onChange={(event) => setUsage(event.target.value as typeof usage)}>
        <option value="">保留当前用途</option>
        {IMAGE_ASSET_USAGE_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>添加关键词<input value={keywords} onChange={(event) => setKeywords(event.target.value)} /></label>
      <button type="button" disabled={!usage && !keywords.trim()} onClick={() => apply((asset) => ({
        name: asset.name,
        usage: usage || asset.usage,
        keywords: [...asset.keywords, ...keywords.split(/[,，]/u)],
      }))}>确认分类</button>
    </fieldset> : null}
    <button type="button" onClick={() => {
      try {
        const candidates = snapshot.project.assets
          .filter(({ id }) => !scanAssetReferences(snapshot.project, id).length);
        setUnusedIds(candidates.map(({ id }) => id));
        setScannedSnapshot(snapshot);
        setError('');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '无法扫描未引用素材。');
      }
    }}>查看未引用素材</button>
    {unused ? (unused.length ? <ul>{unused.map((asset) => <li key={asset.id}>{asset.name}</li>)}</ul>
      : <p>没有未引用的素材。</p>) : null}
    {error ? <p role="alert">{error}</p> : null}
  </details>;
}
