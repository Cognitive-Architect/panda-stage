/** XFL omits the symbolType attribute for default MovieClip definitions. */
export function xflDefinitionSymbolType(raw: string | undefined): 'graphic' | 'movieclip' | 'button' {
  const type = raw?.trim().toLowerCase();
  if (type === 'graphic' || type === 'button') return type;
  return 'movieclip';
}

export function xflPlacementSymbolType(
  raw: string | undefined,
  hasGraphicPlaybackAttributes: boolean,
  hasMovieClipDefinition: boolean,
): ReturnType<typeof xflDefinitionSymbolType> {
  if (raw?.trim()) return xflDefinitionSymbolType(raw);
  return !hasGraphicPlaybackAttributes && hasMovieClipDefinition ? 'movieclip' : 'graphic';
}

/** Both callers have already matched the layer and display slot. */
export function isSameXflMovieClip(
  symbolName: string,
  instanceName: string | undefined,
  otherSymbolName: string,
  otherInstanceName: string | undefined,
): boolean {
  return symbolName === otherSymbolName && instanceName === otherInstanceName;
}
