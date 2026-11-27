import { createContext } from 'react';
import type { LayerVisualEffects } from '../../domain/models/layerVisualEffects';

export interface LayerEffectPreview {
  effects?: LayerVisualEffects;
  projectInstanceId: number | null;
  revision: number;
  shotId: string;
  layerId: string;
}

export const LayerEffectPreviewContext = createContext<LayerEffectPreview | null>(null);
export const LayerEffectPreviewDispatch = createContext<((preview: LayerEffectPreview | null) => void) | null>(null);
