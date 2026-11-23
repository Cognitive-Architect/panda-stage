import { createContext } from 'react';
import type { Project } from '../../../domain';

export interface AnimationCurveDraft {
  project: Project;
  projectInstanceId: number | null;
  revision: number;
  shotId: string;
  layerId: string;
  timeMs: number;
}

export const AnimationCurveDraftContext = createContext<AnimationCurveDraft | null>(null);
export const AnimationCurveDraftDispatch = createContext<((draft: AnimationCurveDraft | null) => void) | undefined>(undefined);
