import {
  CircleHelp,
  ImageOff,
  LoaderCircle,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ThumbnailState } from '../assets/AssetCard';
import { DecorativeIcon } from '../../ui';

export type ThumbnailFallbackIconKind =
  | 'empty'
  | 'error'
  | 'loading'
  | 'missing'
  | 'unknown'
  | 'unbound';

const thumbnailFallbackIcons: Record<ThumbnailFallbackIconKind, LucideIcon> = {
  empty: ImageOff,
  error: TriangleAlert,
  loading: LoaderCircle,
  missing: ImageOff,
  unknown: CircleHelp,
  unbound: UserRound,
};

/** Map the existing thumbnail state to the approved R6 semantic icon language. */
export function getThumbnailFallbackIconKind(
  thumbnail: ThumbnailState | undefined,
  options: {
    assetConfigured?: boolean;
    assetResolved?: boolean;
  } = {},
): Exclude<ThumbnailFallbackIconKind, 'unbound'> {
  const { assetConfigured = true, assetResolved = true } = options;
  if (!assetConfigured) return 'empty';
  if (!assetResolved) return 'unknown';
  if (!thumbnail || thumbnail.status === 'loading') return 'loading';
  if (
    thumbnail.status === 'missing' &&
    (thumbnail.reason === 'source' || thumbnail.reason === 'error')
  ) {
    return 'error';
  }
  return 'missing';
}

export interface ThumbnailStateIconProps {
  kind: ThumbnailFallbackIconKind;
  className?: string;
  size?: number;
  strokeWidth?: number;
}

/** Render a decorative semantic thumbnail-state icon with a testable state tag. */
export function ThumbnailStateIcon({
  kind,
  className,
  size = 20,
  strokeWidth = 1.8,
}: ThumbnailStateIconProps): React.JSX.Element {
  return (
    <DecorativeIcon
      className={['thumbnail-state-icon', className].filter(Boolean).join(' ')}
      data-thumbnail-icon={kind}
      icon={thumbnailFallbackIcons[kind]}
      size={size}
      strokeWidth={strokeWidth}
    />
  );
}
