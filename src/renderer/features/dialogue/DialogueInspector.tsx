import { DialogueEditor } from './DialogueEditor';

/** Single RightInspector entry point for the timed Dialogue editor. */
export function DialogueInspector({
  dialogueId,
}: {
  dialogueId: string;
}): React.JSX.Element {
  return <DialogueEditor dialogueId={dialogueId} />;
}
