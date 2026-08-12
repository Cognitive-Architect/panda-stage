export interface EditorImageResource {
  image: HTMLImageElement;
  objectUrl: string;
  sourceKey: string;
  disposed: boolean;
}

export interface EditorImageResourceSpec {
  assetId: string;
  sha256?: string;
}

export interface EditorImageResourceHandoff {
  ready: boolean;
  resources: ReadonlyMap<string, EditorImageResource>;
  images: ReadonlyMap<string, HTMLImageElement>;
  sourceKeys: ReadonlyMap<string, string>;
  missing: ReadonlySet<string>;
}

/**
 * Builds the next editor image map as one atomic handoff.
 *
 * A partial or mismatched resource set is deliberately not returned as a
 * renderable map. The caller can keep the previous valid map visible until a
 * complete replacement is available.
 */
export function buildEditorImageResourceHandoff(
  specs: readonly EditorImageResourceSpec[],
  loaded: ReadonlyMap<string, EditorImageResource | null>,
): EditorImageResourceHandoff {
  const resources = new Map<string, EditorImageResource>();
  const images = new Map<string, HTMLImageElement>();
  const sourceKeys = new Map<string, string>();
  const missing = new Set<string>();

  for (const spec of specs) {
    const resource = loaded.get(spec.assetId) ?? null;
    if (
      !spec.sha256 ||
      !resource ||
      resource.sourceKey !== spec.sha256
    ) {
      missing.add(spec.assetId);
      continue;
    }
    resources.set(spec.assetId, resource);
    images.set(spec.assetId, resource.image);
    sourceKeys.set(spec.assetId, resource.sourceKey);
  }

  if (missing.size > 0 || resources.size !== specs.length) {
    return {
      ready: false,
      resources: new Map(),
      images: new Map(),
      sourceKeys: new Map(),
      missing,
    };
  }

  return {
    ready: true,
    resources,
    images,
    sourceKeys,
    missing,
  };
}
