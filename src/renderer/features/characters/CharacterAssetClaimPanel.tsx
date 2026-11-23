import { useState } from 'react';
import {
  isFlaGraphicDefinition,
  type Character,
  type CharacterFaceSource,
  type ImageAsset,
  type TalkingAnimationPlayback,
} from '../../../domain';
import { characterStore } from '../../stores/characterStore';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { Button } from '../../ui/Button';
import type { ThumbnailState } from '../assets/AssetCard';
import { CharacterResourceSwapDialog, type ResourceSwapValue } from './CharacterResourceSwapDialog';
import { GraphicFacePreview, TalkingAnimationPicker, type GraphicFacePreviewResult } from './GraphicFacePicker';

type ExpressionDraft = {
  name: string;
  source?: CharacterFaceSource;
  preview?: { snapshot: EditorProjectSnapshot; result: GraphicFacePreviewResult };
  attempt?: number;
};
type ClaimDraft = {
  instance: number | null;
  expressions: ExpressionDraft[];
  talking?: { id: string; playback: TalkingAnimationPlayback };
};

export function CharacterAssetClaimPanel({
  character, snapshot, imageAssets, thumbnails, onThumbnailError, disabled,
}: {
  character: Character;
  snapshot: EditorProjectSnapshot;
  imageAssets: readonly ImageAsset[];
  thumbnails: Readonly<Record<string, ThumbnailState>>;
  onThumbnailError: (assetId: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const [draft, setDraft] = useState<ClaimDraft | null>(null);
  const [picker, setPicker] = useState<{ index: number; trigger: HTMLElement } | null>(null);
  const [error, setError] = useState('');
  const graphics = snapshot.project.animations.filter(isFlaGraphicDefinition);

  const updateExpression = (index: number, update: Partial<ExpressionDraft>): void => {
    setDraft(current => current && {
      ...current,
      expressions: current.expressions.map((expression, slot) =>
        slot === index ? { ...expression, ...update } : expression),
    });
    setError('');
  };

  const close = (): void => {
    setDraft(null);
    setPicker(null);
    setError('');
  };

  const confirm = (): void => {
    if (!draft?.talking || disabled) return;
    const expressions = draft.expressions.flatMap(({ name, source }) => source ? [{ name, source }] : []);
    if (expressions.length !== 3) return;
    try {
      if (draft.instance !== editorProjectStore.getProjectInstanceId()) {
        throw new Error('项目已切换，请取消后重新认领。');
      }
      const graphicProblem = draft.expressions.find(({ source, preview }) =>
        source?.kind === 'fla-graphic' && (preview?.snapshot !== snapshot || preview.result !== 'ready'));
      if (graphicProblem) {
        const failed = graphicProblem.preview?.snapshot === snapshot && graphicProblem.preview.result === 'failed';
        throw new Error(failed
          ? `“${graphicProblem.name}”的元件预览失败，请重试或换一张。`
          : `“${graphicProblem.name}”的元件正在准备预览，请稍后确认。`);
      }
      const missing = expressions.find(({ source }) => source.kind === 'image' && thumbnails[source.assetId]?.status === 'missing');
      if (missing) throw new Error(`“${missing.name}”的图片不可用，请重新选择。`);
      characterStore.claimCharacterAssets(character.id, {
        expressions,
        talkingAnimationId: draft.talking.id,
        playback: draft.talking.playback,
      }, snapshot);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '认领失败，请重试。');
    }
  };

  if (!draft) return <Button variant="secondary" disabled={disabled} onClick={() => setDraft({
    instance: editorProjectStore.getProjectInstanceId(),
    expressions: ['普通', '生气', '哭泣'].map(name => ({ name })),
  })}>认领到角色</Button>;

  const chosen = picker ? draft.expressions[picker.index]?.source : undefined;
  const currentValue: ResourceSwapValue = chosen ?? { kind: 'image', assetId: null };
  const talking = snapshot.project.animations.find(animation => animation.id === draft.talking?.id);

  return (
    <section className="graphic-face-options" aria-label="认领到角色">
      <strong>认领到「{character.name}」</strong>
      {imageAssets.length === 0 && graphics.length === 0 ? <p>请先在素材库导入表情图片或 FLA 元件。</p> : null}
      {draft.expressions.map(({ name, source, preview, attempt }, index) => {
        const image = source?.kind === 'image' ? imageAssets.find(asset => asset.id === source.assetId) : undefined;
        const graphic = source?.kind === 'fla-graphic' ? graphics.find(item => item.id === source.animationId) : undefined;
        const thumbnail = image ? thumbnails[image.id] : undefined;
        return (
          <div key={index}>
            <div className="character-claim-expression">
              <div className="character-claim-preview">
                {source?.kind === 'fla-graphic' ? (
                  <GraphicFacePreview key={attempt ?? 0} source={source} label={name} onResult={(currentSnapshot, result) => {
                    setDraft(current => {
                      const slot = current?.expressions[index];
                      if (!current || slot?.source !== source || slot.attempt !== attempt ||
                          (slot.preview?.snapshot === currentSnapshot && slot.preview.result === result)) return current;
                      return {
                        ...current,
                        expressions: current.expressions.map((item, itemIndex) => itemIndex === index
                          ? { ...item, preview: { snapshot: currentSnapshot, result } }
                          : item),
                      };
                    });
                  }} />
                ) : null}
                {image && thumbnail?.status === 'ready' ? (
                  <img alt={name} src={thumbnail.dataUrl} onError={() => onThumbnailError(image.id)} />
                ) : null}
              </div>
              <input aria-label={`表情 ${index + 1} 名称`} disabled={disabled}
                maxLength={200} value={name} onChange={event => updateExpression(index, { name: event.target.value })} />
              <Button variant="secondary" disabled={disabled || (imageAssets.length === 0 && graphics.length === 0)}
                aria-label={`选择表情 ${index + 1} 素材`} onClick={event => setPicker({ index, trigger: event.currentTarget })}>
                {source?.kind === 'fla-graphic' && graphic ? `${graphic.name} · 第 ${source.firstFrame + 1} 帧` : image?.name ?? (source ? '素材不可用' : '选择表情')}
              </Button>
            </div>
            {preview?.snapshot === snapshot && preview.result === 'failed' ? (
              <div role="alert">
                元件预览失败。可换一张，或
                <Button variant="secondary" disabled={disabled} onClick={() => updateExpression(index, {
                  preview: undefined, attempt: (attempt ?? 0) + 1,
                })}>重试预览</Button>
              </div>
            ) : null}
          </div>
        );
      })}
      {draft.talking ? <span>{talking?.name ?? '说话素材不可用'} · 第 {draft.talking.playback.firstFrame + 1}–{draft.talking.playback.lastFrame + 1} 帧</span> : null}
      <TalkingAnimationPicker forClaim animationId={draft.talking?.id} playback={draft.talking?.playback} disabled={disabled}
        onApply={(id, playback) => {
          setDraft(current => current && { ...current, talking: id && playback ? { id, playback } : undefined });
          setError('');
        }} />
      {error ? <p role="alert">{error}</p> : null}
      <div className="graphic-face-pagination">
        <Button variant="secondary" onClick={close}>取消</Button>
        <Button disabled={disabled || !draft.talking || draft.expressions.some(expression => !expression.source || !expression.name.trim())}
          onClick={confirm}>确认认领</Button>
      </div>
      {picker ? (
        <CharacterResourceSwapDialog open confirmLabel="选用素材" title={`选择「${draft.expressions[picker.index]?.name || '表情'}」素材`}
          currentValue={currentValue} imageAssets={imageAssets} thumbnails={thumbnails} graphicDefinitions={graphics}
          getDisabledReason={asset => thumbnails[asset.id]?.status === 'missing' ? '图片不可用' : undefined}
          onThumbnailError={onThumbnailError} returnFocusTo={picker.trigger} onCancel={() => setPicker(null)}
          onConfirm={value => {
            if (value.kind === 'image') {
              if (value.assetId) updateExpression(picker.index, { preview: undefined, source: { kind: 'image', assetId: value.assetId } });
            } else {
              updateExpression(picker.index, { preview: undefined, source: { ...value, firstFrame: value.firstFrame ?? 0 } });
            }
            setPicker(null);
          }} />
      ) : null}
    </section>
  );
}
