import { PROJECT_HEIGHT, PROJECT_WIDTH } from '../../../domain';

export function canvasStagePointer(stage: Element, event: { clientX: number; clientY: number }) {
  const rect = stage.getBoundingClientRect();
  if (!rect.width || !rect.height) return undefined;
  return {
    x: (event.clientX - rect.left) * PROJECT_WIDTH / rect.width,
    y: (event.clientY - rect.top) * PROJECT_HEIGHT / rect.height,
  };
}
