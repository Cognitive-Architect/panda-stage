import type {
  AnimationImportIR,
  FlaDiagnostic,
  FlaImportErrorCode,
} from './fla-import-api';

/**
 * V1.5-A diagnostic helpers.
 *
 * These derive a bounded, beginner-facing {@link FlaDiagnostic} from facts that
 * already exist in the strict Panda-owned contract (the preflight error code or
 * an empty raster `media` array).  They never change the security decision:
 * the original error code / PASS-FAIL outcome stays authoritative.  The shared
 * module deliberately imports no Electron, Node, or parser code so it can run
 * in both the Main and Renderer bundles and in unit tests.
 */

export const FLA_ARCHIVE_MALFORMED_MESSAGE =
  '此 FLA 文件的压缩包元数据不一致，已被当前安全规则拒绝导入。';
export const FLA_NO_IMPORTABLE_RASTER_MESSAGE =
  '文件已成功读取，但没有找到可直接导入的位图素材。';
export const FLA_UNSUPPORTED_FEATURE_MESSAGE =
  '此 FLA 含有当前导入模式暂不兼容的内容。';

/**
 * Map a preflight / parser error code to a diagnostic category.
 *
 * Only archive-level and explicit unsupported-feature codes get a diagnostic;
 * everything else (parser crash, cancellation, size limits, timeouts) returns
 * an empty list so the caller can fall back to a neutral message without
 * implying a more specific cause.  No behavior is keyed on a specific producer
 * quirk such as the known +54-byte EOCD family; the mapping is purely by the
 * existing error code, which the strict preflight already produced.
 */
export function flaErrorDiagnostics(error: {
  code: FlaImportErrorCode;
  message: string;
}): FlaDiagnostic[] {
  switch (error.code) {
    case 'MALFORMED_ARCHIVE':
    case 'UNSUPPORTED_FLA_CONTAINER':
      return [
        {
          category: 'archive-malformed',
          userMessage: FLA_ARCHIVE_MALFORMED_MESSAGE,
          developerNote: error.message,
        },
      ];
    case 'UNSUPPORTED_FEATURE_PRESENT':
      return [
        {
          category: 'unsupported-or-unknown',
          userMessage: FLA_UNSUPPORTED_FEATURE_MESSAGE,
          developerNote: error.message,
        },
      ];
    default:
      return [];
  }
}

/**
 * Surface a clear zero-raster diagnostic when the file parsed successfully but
 * contains no directly importable bitmap media.  The parsing success and the
 * original `ir` stay unchanged; this only adds an explanatory category derived
 * from the real, already-present `media` evidence.
 */
export function flaZeroRasterDiagnostic(ir: AnimationImportIR): FlaDiagnostic[] {
  if (ir.media.length > 0) return [];
  return [
    {
      category: 'no-importable-raster',
      userMessage: FLA_NO_IMPORTABLE_RASTER_MESSAGE,
    },
  ];
}

/**
 * Safe, beginner-facing copy for a C3 classifier rejection or a failed
 * post-normalization strict validation. Reason codes remain developer detail;
 * the copy never suggests that Panda repaired or rewrote the source.
 */
export function flaRecoveryFailureDiagnostics(
  reasonCodes: readonly string[] = [],
): FlaDiagnostic[] {
  return [
    {
      category: 'archive-malformed',
      userMessage:
        '这个 FLA 的文件结构存在 Panda 目前无法安全处理的兼容性问题，原文件没有被修改。',
      ...(reasonCodes.length > 0
        ? { developerNote: reasonCodes.slice(0, 8).join(', ') }
        : {}),
    },
  ];
}
