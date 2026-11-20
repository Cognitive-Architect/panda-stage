import { useEffect, useState } from 'react';
import type { ImageAsset } from '../../../domain';
import type { ThumbnailState } from '../assets/AssetCard';
import { CanvasImageResourceSession } from '../canvas/canvasImageResources';
import { getThumbnailFallbackIconKind, ThumbnailStateIcon } from './ThumbnailStateIcon';

export function CharacterSingleImagePreview({
  asset,
  projectRoot,
  label,
  thumbnail,
}: {
  asset: ImageAsset;
  projectRoot: string;
  label: string;
  thumbnail?: ThumbnailState;
}): React.JSX.Element {
  const key = JSON.stringify([projectRoot, asset.id, asset.sha256]);
  const [preview, setPreview] = useState<{ key: string; src: string }>();
  useEffect(() => {
    const session = new CanvasImageResourceSession();
    session.reconcile({ contextKey: projectRoot, projectRoot, assets: [asset] }, (state) => {
      const image = state.images.get(asset.id);
      if (image) setPreview({ key, src: image.src });
    });
    return () => session.dispose();
  }, [asset, key, projectRoot]);

  const src = preview?.key === key ? preview.src : thumbnail?.status === 'ready' ? thumbnail.dataUrl : null;
  return src ? <img alt={label} draggable={false} src={src} /> :
    <ThumbnailStateIcon kind={getThumbnailFallbackIconKind(thumbnail)} />;
}
