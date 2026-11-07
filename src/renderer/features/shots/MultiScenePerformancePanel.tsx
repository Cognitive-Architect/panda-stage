import {
  MultiSceneDialoguePanel,
  type MultiSceneDialoguePanelProps,
} from './MultiSceneDialoguePanel';

/**
 * AUTO-06 is the same flat batch surface with the performance planner
 * injected. No third copy of the panel, no second stale gate, no new player.
 */
export function MultiScenePerformancePanel(
  props: MultiSceneDialoguePanelProps,
): React.JSX.Element {
  return <MultiSceneDialoguePanel {...props} mode="performance" />;
}
