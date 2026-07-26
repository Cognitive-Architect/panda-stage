export { validateProjectReferences } from './projectReferences';
export { validatePresetApplication } from './timelineEventValidator';
export type { ValidationResult } from './timelineEventValidator';
export {
  scanAssetReferences,
  scanCharacterReferences,
  scanExpressionReferences,
  type AssetReference,
  type AssetReferenceKind,
  type CharacterReference,
  type CharacterReferenceKind,
  type ExpressionReference,
  type ExpressionReferenceKind,
} from './referenceScanner';
