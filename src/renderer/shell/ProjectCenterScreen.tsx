import type { StartScreenProps } from './StartScreen';
import { StartScreen } from './StartScreen';

/**
 * The project-center page owns navigation only. Project lifecycle mutations
 * remain in EditorShell and arrive as callbacks, so this page cannot create a
 * second session controller or editor store.
 */
export type ProjectCenterScreenProps = StartScreenProps;

export function ProjectCenterScreen(
  props: ProjectCenterScreenProps,
): React.JSX.Element {
  return (
    <section
      className="project-center-screen"
      data-testid="project-center-screen"
      data-project-open={props.currentProject ? 'true' : 'false'}
      aria-labelledby="recovery-heading"
    >
      <div
        className="start-screen project-launcher"
        data-testid="start-screen"
      >
        <StartScreen {...props} />
      </div>
    </section>
  );
}
