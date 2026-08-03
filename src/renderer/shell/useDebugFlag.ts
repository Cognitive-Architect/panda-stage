export interface EditorShellFlags {
  debug: boolean;
  gateA: boolean;
}

export function parseEditorShellFlags(search: string): EditorShellFlags {
  const parameters = new URLSearchParams(search);
  return {
    debug: parameters.get('debug') === '1',
    gateA: parameters.get('gateA') === '1',
  };
}

export function useDebugFlag(): EditorShellFlags {
  return parseEditorShellFlags(window.location.search);
}
