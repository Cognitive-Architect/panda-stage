import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { Group, Layer as CanvasLayer, Stage } from 'react-konva';
import type { AdaptivePartsCharacter, CharacterBodyPose, Project, Shot } from '../../../domain';
import { buildStageRenderModel } from '../../../shared/stage/render-model';
import { StagePartImages } from '../../stage/StageRenderer';
import { Button, DecorativeIcon } from '../../ui';
import { CanvasImageResourceSession, EMPTY_CANVAS_IMAGE_STATE, type CanvasImageState } from '../canvas/canvasImageResources';
import { createBodyPoseThumbnailScene, evaluateBodyPoseThumbnail, type BodyPoseThumbnailScene } from './bodyPoseThumbnailScene';
import './character-body-pose-gallery.css';

interface GalleryProps {
  project: Project;
  projectRoot: string;
  shot: Shot;
  layerId: string;
  character: AdaptivePartsCharacter;
  selectedId?: string;
  disabled: boolean;
  onSelect: (pose: CharacterBodyPose) => void;
}

export function CharacterBodyPoseGallery({ project, projectRoot, shot, layerId, character, selectedId, disabled, onSelect }: GalleryProps): React.JSX.Element {
  const scene = useMemo(() => createBodyPoseThumbnailScene(project, shot, layerId, character),
    [project, shot, layerId, character]);
  const resourceSession = useRef<CanvasImageResourceSession>(null);
  const [images, setImages] = useState(EMPTY_CANVAS_IMAGE_STATE);
  useEffect(() => {
    const session = new CanvasImageResourceSession();
    resourceSession.current = session;
    return () => session.dispose();
  }, []);
  useEffect(() => {
    if (typeof window.pandaStage?.assets?.readCanvasImage === 'function') {
      resourceSession.current?.reconcile({
        contextKey: projectRoot, projectRoot, assets: scene?.assets ?? [],
      }, setImages);
    }
  }, [projectRoot, scene]);

  return <div className="body-pose-gallery">
    {character.bodyPoses?.map(pose => (
      <BodyPoseCard key={pose.id} pose={pose} scene={scene} images={images} selected={selectedId === pose.id}
        disabled={disabled} onSelect={() => onSelect(pose)} />
    ))}
  </div>;
}

function BodyPoseCard({ pose, scene, images, selected, disabled, onSelect }: {
  pose: CharacterBodyPose;
  scene: BodyPoseThumbnailScene | null;
  images: CanvasImageState;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const card = useRef<HTMLButtonElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const target = card.current;
    if (seen || !target) return;
    if (typeof IntersectionObserver !== 'function') {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setSeen(true);
        observer.disconnect();
      }
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [seen]);

  return <Button ref={card} variant="secondary" className="body-pose-card" aria-pressed={selected}
    data-testid="body-pose-card" disabled={disabled} onClick={onSelect} title={pose.name}>
    <span className="body-pose-card-art" aria-hidden="true">
      {seen && scene ? <BodyPoseImage scene={scene} pose={pose} images={images} /> : <PosePlaceholder />}
    </span>
    <span className="body-pose-card-name">{pose.name}</span>
  </Button>;
}

const THUMB_WIDTH = 128;
const THUMB_HEIGHT = 96;
const THUMB_PADDING = 8;

function PosePlaceholder(): React.JSX.Element {
  return <span className="body-pose-placeholder" data-testid="body-pose-placeholder"><DecorativeIcon icon={ImageIcon} size={24} /></span>;
}

const BodyPoseImage = memo(function BodyPoseImage({ scene, pose, images }: {
  scene: BodyPoseThumbnailScene;
  pose: CharacterBodyPose;
  images: CanvasImageState;
}): React.JSX.Element {
  const thumbnail = useMemo(() => {
    if (scene.assets.some(({ id, sha256 }) => !images.images.has(id) || images.sourceKeys.get(id) !== sha256)) return null;
    try {
      const posed = evaluateBodyPoseThumbnail(scene, pose);
      if (!posed) return null;
      const urls = Object.fromEntries(scene.assets.map(({ id }) => [id, images.images.get(id)!.src]));
      const { layers: [layer] } = buildStageRenderModel(posed.project, posed.evaluated, urls, undefined, { collectCandidates: false });
      if (!layer?.visual) return null;
      const bounds = layer.visual.combinedLocalBounds;
      const left = Math.min(bounds.x, scene.bounds.x);
      const top = Math.min(bounds.y, scene.bounds.y);
      const right = Math.max(bounds.x + bounds.width, scene.bounds.x + scene.bounds.width);
      const bottom = Math.max(bounds.y + bounds.height, scene.bounds.y + scene.bounds.height);
      const scale = Math.min((THUMB_WIDTH - 2 * THUMB_PADDING) / (right - left), (THUMB_HEIGHT - 2 * THUMB_PADDING) / (bottom - top));
      if (!Number.isFinite(scale) || scale <= 0) return null;
      const decoded = new Map<string, HTMLImageElement>();
      for (const { id, asset } of [...layer.parts, ...(layer.resources ?? [])]) {
        const image = images.images.get(asset.id);
        if (image) decoded.set(id, image);
      }
      return { layer, decoded, scale, x: (THUMB_WIDTH - (left + right) * scale) / 2,
        y: (THUMB_HEIGHT - (top + bottom) * scale) / 2 };
    } catch {
      return null;
    }
  }, [scene, pose, images]);
  if (!thumbnail) return <PosePlaceholder />;
  const { layer, decoded, scale, x, y } = thumbnail;
  return <Stage className="body-pose-thumbnail" width={THUMB_WIDTH} height={THUMB_HEIGHT} listening={false}>
    <CanvasLayer listening={false}>
      <Group x={x} y={y} scaleX={scale} scaleY={scale} listening={false}>
        <StagePartImages ownerLayerId={layer.id} parts={layer.parts} resources={layer.resources} images={decoded}
          composite={false} scheduleLayerDraw headGroup={layer.visual!.headGroup} visualBounds={layer.visual!.combinedLocalBounds} />
      </Group>
    </CanvasLayer>
  </Stage>;
}, (previous, next) => previous.scene.appearanceKey === next.scene.appearanceKey && previous.images === next.images &&
  previous.pose.id === next.pose.id && JSON.stringify(previous.pose.parts) === JSON.stringify(next.pose.parts));
