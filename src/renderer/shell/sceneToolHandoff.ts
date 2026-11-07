/**
 * Auto Scene hands off between the right Project Tools page and the left asset
 * and character surfaces. Every message carries the project session that issued
 * it, so a request or a late receipt from a previous project can never replay
 * in the current one.
 */
export interface SceneToolRequest {
  sessionIdentity: string;
  token: number;
}

export interface SceneToolImportResult {
  sessionIdentity: string;
  token: number;
  backgroundAssetId: string | null;
}

/** True when the message was issued by the given project session. */
export function belongsToSceneToolSession(
  message: { sessionIdentity: string } | null | undefined,
  sessionIdentity: string,
): boolean {
  return Boolean(message && message.sessionIdentity === sessionIdentity);
}

/**
 * A message is handled once per session: tokens from another session, and
 * tokens already consumed in this one, are ignored.
 */
export function shouldHandleSceneToolMessage(
  message: SceneToolRequest | null | undefined,
  sessionIdentity: string,
  handledToken: number,
): boolean {
  return Boolean(
    message &&
      belongsToSceneToolSession(message, sessionIdentity) &&
      message.token !== handledToken,
  );
}
