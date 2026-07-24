import { useMemo } from 'react';

export interface AssetDropHandlers {
  onDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
}

export function useAssetDrop(
  disabled: boolean,
  importFiles: (files: readonly File[]) => Promise<void>,
): AssetDropHandlers {
  return useMemo(
    () => ({
      onDragOver: (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault();
        if (!disabled) event.dataTransfer.dropEffect = 'copy';
      },
      onDrop: (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault();
        if (disabled || event.dataTransfer.files.length === 0) return;
        void importFiles(Array.from(event.dataTransfer.files));
      },
    }),
    [disabled, importFiles],
  );
}
