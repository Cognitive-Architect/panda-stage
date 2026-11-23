export { validateProjectReferences } from './projectReferences';
export { validatePresetApplication } from './timelineEventValidator';
export type { ValidationResult } from './timelineEventValidator';
export {
  scanAssetReferences,
  scanCharacterReferences,
  scanCharacterActionReferences,
  scanExpressionReferences,
  hasCharacterFaceTimelineEvents,
  type AssetReference,
  type AssetReferenceKind,
  type CharacterReference,
  type CharacterReferenceKind,
  type CharacterActionReference,
  type ExpressionReference,
  type ExpressionReferenceKind,
} from './referenceScanner';
