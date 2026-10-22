import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { Character, Project } from '../../../domain';
import { transformVisualRectByPart } from '../../../domain';
import type { ThumbnailState } from '../assets/AssetCard';
import type { CharacterAssemblySnapshot } from '../../stores/characterAssemblySessionStore';
import { buildCharacterAssemblyPreviewVisual } from './characterAssemblyPreview';

type HeadedCompositeCharacter = Extract<Character, { mode: 'composite' }> & {
  head: NonNullable<Extract<Character, { mode: 'composite' }>['head']>;
};

interface CharacterTalkingHeadMotionPreviewProps {
  project: Project;
  character: HeadedCompositeCharacter;
  thumbnails: Readonly<Record<string, ThumbnailState>>;
  intensityPercent: number;
  playing: boolean;
}

const PREVIEW_WIDTH = 160;
const PREVIEW_HEIGHT = 128;

interface PreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function unionRects(rects: readonly PreviewRect[]): PreviewRect {
  return rects.reduce((result, rect) => {
    const left = Math.min(result.x, rect.x);
    const top = Math.min(result.y, rect.y);
    const right = Math.max(result.x + result.width, rect.x + rect.width);
    const bottom = Math.max(result.y + result.height, rect.y + rect.height);
    return { x: left, y: top, width: right - left, height: bottom - top };
  });
}

function intersectRects(
  first: PreviewRect,
  second: PreviewRect,
): PreviewRect | null {
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null;
}

export function resolveTalkingHeadPreviewBounds(
  headRect: PreviewRect,
  faceRect: PreviewRect | null,
  bodyRect: PreviewRect | null,
): PreviewRect {
  const headBounds = unionRects(
    faceRect ? [headRect, faceRect] : [headRect],
  );
  const shoulderBand: PreviewRect = {
    x: headBounds.x - headBounds.width * 0.3,
    y: headBounds.y + headBounds.height * 0.68,
    width: headBounds.width * 1.6,
    height: headBounds.height * 0.58,
  };
  const shoulders = bodyRect
    ? intersectRects(bodyRect, shoulderBand)
    : null;
  const focusBounds = unionRects(
    shoulders ? [headBounds, shoulders] : [headBounds],
  );
  const horizontalPadding = headBounds.width * 0.1;
  const verticalPadding = headBounds.height * 0.08;
  return {
    x: focusBounds.x - horizontalPadding,
    y: focusBounds.y - verticalPadding,
    width: focusBounds.width + horizontalPadding * 2,
    height: focusBounds.height + verticalPadding * 2,
  };
}

function thumbnailUrl(
  thumbnails: Readonly<Record<string, ThumbnailState>>,
  assetId: string,
): string | null {
  const state = thumbnails[assetId];
  return state?.status === 'ready' ? state.dataUrl : null;
}

export function CharacterTalkingHeadMotionPreview({
  project,
  character,
  thumbnails,
  intensityPercent,
  playing,
}: CharacterTalkingHeadMotionPreviewProps): React.JSX.Element | null {
  const session = useMemo<CharacterAssemblySnapshot>(
    () => ({
      status: 'active',
      sessionId: 0,
      generation: 0,
      projectId: project.id,
      projectRoot: 'character-settings-preview',
      characterId: character.id,
      editTarget: 'head',
      draft: {
        bodyAssetId: character.bodyAssetId,
        bodyPlacement: { ...character.bodyPlacement },
        facePlacement: character.facePlacement,
        head: character.head,
        expressionAssets: character.expressions.map((expression) => ({
          expressionId: expression.id,
          assetId: expression.assetId,
        })),
        mouthOpenAssetId: character.mouthOpenAssetId ?? null,
      },
    }),
    [character, project.id],
  );
  const visual = useMemo(
    () =>
      buildCharacterAssemblyPreviewVisual(project, session, {
        kind: 'expression',
        expressionId: character.defaultExpressionId,
      }),
    [character.defaultExpressionId, project, session],
  );
  if (!visual?.headPart) return null;

  const bodyPart = visual.parts.find((part) => part.slot === 'body');
  const facePart = visual.parts.find((part) => part.slot === 'face');
  const headBounds = transformVisualRectByPart(
    visual.headPart.localRect,
    visual.headPart,
  );
  const faceBounds = facePart
    ? transformVisualRectByPart(facePart.localRect, facePart)
    : null;
  const bounds = resolveTalkingHeadPreviewBounds(
    headBounds,
    faceBounds,
    bodyPart?.localRect ?? null,
  );
  const scale = Math.min(
    PREVIEW_WIDTH / bounds.width,
    PREVIEW_HEIGHT / bounds.height,
  );
  const centerX = project.width / 2;
  const centerY = project.height / 2;
  const ratio = intensityPercent / 100;
  const headMotionStyle = {
    transformOrigin: `${centerX + character.head.pivot.x}px ${centerY + character.head.pivot.y}px`,
    '--head-motion-up-mid': `${(-2.828 * ratio).toFixed(3)}px`,
    '--head-motion-up-peak': `${(-4 * ratio).toFixed(3)}px`,
    '--head-motion-down-mid': `${(2.828 * ratio).toFixed(3)}px`,
    '--head-motion-down-peak': `${(4 * ratio).toFixed(3)}px`,
  } as CSSProperties;
  const stageStyle = {
    width: project.width,
    height: project.height,
    left:
      (PREVIEW_WIDTH - bounds.width * scale) / 2 -
      (centerX + bounds.x) * scale,
    top:
      (PREVIEW_HEIGHT - bounds.height * scale) / 2 -
      (centerY + bounds.y) * scale,
    transform: `scale(${scale})`,
  } as CSSProperties;

  const renderPart = (
    assetId: string,
    rect: { x: number; y: number; width: number; height: number },
    className: string,
    rotationDeg = 0,
    flipX = false,
  ): React.JSX.Element => {
    const src = thumbnailUrl(thumbnails, assetId);
    const style: CSSProperties = {
      height: rect.height,
      left: centerX + rect.x,
      top: centerY + rect.y,
      transform: `rotate(${rotationDeg}deg) scaleX(${flipX ? -1 : 1})`,
      transformOrigin: 'center',
      width: rect.width,
    };
    return src ? (
      <img
        alt=""
        className={`character-assembly-part ${className}`}
        data-asset-id={assetId}
        draggable={false}
        key={`${className}-${assetId}`}
        src={src}
        style={style}
      />
    ) : (
      <span
        aria-hidden="true"
        className={`character-assembly-part ${className} is-thumbnail-unavailable`}
        data-asset-id={assetId}
        key={`${className}-${assetId}`}
        style={style}
      />
    );
  };

  return (
    <div
      aria-label={`${character.name} 的说话点头预览`}
      className="character-talking-head-preview"
      data-intensity-percent={intensityPercent}
      data-playing={playing}
      data-preview-focus="head-and-shoulders"
      data-preview-scale={scale.toFixed(3)}
      role="img"
      data-testid="character-talking-head-motion-preview"
    >
      <div className="character-talking-head-preview-viewport">
        <div className="character-talking-head-preview-stage" style={stageStyle}>
          {bodyPart
            ? renderPart(bodyPart.assetId, bodyPart.localRect, 'character-assembly-part-body')
            : null}
          <div
            className={`character-assembly-head-group${playing ? ' is-talking-head-motion-preview-running' : ''}`}
            data-testid="character-talking-head-preview-group"
            style={headMotionStyle}
          >
            {renderPart(
              visual.headPart.assetId,
              visual.headPart.localRect,
              'character-assembly-part-head',
              visual.headPart.rotationDeg,
              visual.headPart.flipX,
            )}
            {facePart
              ? renderPart(
                  facePart.assetId,
                  facePart.localRect,
                  'character-assembly-part-face',
                  facePart.rotationDeg,
                  facePart.flipX,
                )
              : null}
          </div>
        </div>
      </div>
    </div>
  );
}
