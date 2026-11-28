export { validateProjectReferences } from './projectReferences';
export { validatePresetApplication } from './timelineEventValidator';
export type { ValidationResult } from './timelineEventValidator';
export {
  scanAnimationDefinitionReferences,
  scanAssetReferences,
  scanCharacterReferences,
  scanCharacterActionReferences,
  scanExpressionReferences,
  hasCharacterFaceTimelineEvents,
  type AnimationDefinitionReference,
  type AnimationDefinitionReferenceKind,
  type AssetReference,
  type AssetReferenceKind,
  type CharacterReference,
  type CharacterReferenceKind,
  type CharacterActionReference,
  type ExpressionReference,
  type ExpressionReferenceKind,
} from './referenceScanner';
