// Type shim for the pure-Node corpus probe helper. The runtime is `.cjs`
// so the corpus collector can run via `node scripts/fla-corpus-collector.cjs`
// without a TS compilation step. The Vitest unit/integration tests load
// the same `.cjs` via `createRequire(import.meta.url)`.
//
// Evidence shape (Issue #280 corrective item 3):
//   - `offlineProbe` carries strictly OFFLINE structural + raster facts.
//   - `productionParser` is hard-pinned to `not-verified` from this offline
//     helper; only a real Windows/Electron acceptance run may upgrade it.
//   - `previewAvailable` is gated on `productionParser.status === 'verified'`
//     — never asserted solely because the offline probe found raster media.
export type ContainerEvidence = {
  preflightResult: 'pass' | 'reject';
  preflightReasonCategory: 'archive-malformed' | null;
  centralDirectoryDeclaredBytes: number | null;
  centralDirectoryActualBytes: number | null;
  centralDirectoryDeltaBytes: number | null;
  cdEndsExactlyAtEocd: boolean | null;
  zip64Indicator: boolean | null;
  encryptionIndicator: boolean | null;
  hasDomDocument: boolean;
};

export type StructureEvidence = {
  sceneCount: number;
  totalTimelineCount: number;
  layerCount: number;
  frameCount: number;
  tweenCount: number;
  symbolCount: number;
  movieClipCount: number;
  graphicCount: number;
  buttonCount: number;
  bitmapMediaCount: number;
  placedInstanceCount: number;
  libraryOnlyMediaCount: number;
};

/**
 * Sample record emitted by `inspectSample`. The `offlineProbe` /
 * `productionParser` split is the authoritative truth: this helper is
 * offline-only and MUST NOT promote `productionParser.status` to anything
 * other than `'not-verified'`.
 */
export type SampleRecord = {
  sampleId: string;
  basename: string;
  sha256: string;
  byteLength: number;
  containerFamily: 'ZIP/XFL';
  evidenceOrigin: string;
  categoryTags: string[];
  preflight: {
    result: 'pass' | 'reject';
    reasonCategory: string | null;
    centralDirectoryDeclaredBytes: number | null;
    centralDirectoryActualBytes: number | null;
    centralDirectoryDeltaBytes: number | null;
    cdEndsExactlyAtEocd: boolean | null;
    zip64Indicator: boolean | null;
    encryptionIndicator: boolean | null;
  };
  offlineProbe: {
    status: 'success' | 'not-run' | 'error';
    raster: {
      bitmapMediaCount: number;
      placedInstanceCount: number;
      libraryOnlyMediaCount: number;
    } | null;
    structure: {
      sceneCount: number;
      totalTimelineCount: number;
      layerCount: number;
      frameCount: number;
      tweenCount: number;
      symbolCount: number;
      movieClipCount: number;
      graphicCount: number;
      buttonCount: number;
    } | null;
  };
  productionParser: {
    status: 'not-verified' | 'verified';
    previewAvailable: boolean;
  };
  sourceUnchanged: 'verified';
  notes: string;
};

declare const probe: {
  inspectSample(
    bytes: Uint8Array,
    basename: string,
    evidenceOrigin: string,
    categoryTags: string[],
    notes: string,
  ): Promise<SampleRecord>;
  probeContainer(bytes: Uint8Array): Promise<{
    entryCount: number;
    hasDomDocument: boolean;
    domDocumentXml: string;
    libraryXmlEntries: string[];
    eocdEvidence: {
      eocdFound: boolean;
      centralDirectoryDeclaredBytes: number | null;
      centralDirectoryActualBytes: number | null;
      centralDirectoryDeltaBytes: number | null;
      cdEndsExactlyAtEocd: boolean | null;
      zip64Indicator: boolean | null;
      encryptionIndicator: boolean | null;
    };
  }>;
  probeStructure(domDocumentXml: string, libraryXmlEntries: string[]): StructureEvidence;
  classifyContainer(
    eocdEvidence: {
      eocdFound: boolean;
      centralDirectoryDeclaredBytes: number | null;
      centralDirectoryActualBytes: number | null;
      centralDirectoryDeltaBytes: number | null;
      cdEndsExactlyAtEocd: boolean | null;
      zip64Indicator: boolean | null;
      encryptionIndicator: boolean | null;
    },
    hasDomDocument: boolean,
  ): { preflightResult: 'pass' | 'reject'; preflightReasonCategory: 'archive-malformed' | null };
  detectEocdDiscrepancy(bytes: Uint8Array | Buffer): {
    eocdFound: boolean;
    centralDirectoryDeclaredBytes: number | null;
    centralDirectoryActualBytes: number | null;
    centralDirectoryDeltaBytes: number | null;
    cdEndsExactlyAtEocd: boolean | null;
    zip64Indicator: boolean | null;
    encryptionIndicator: boolean | null;
  };
  sha256Of(bytes: Uint8Array | Buffer): string;
  zeroStructure(): StructureEvidence;
};

export default probe;