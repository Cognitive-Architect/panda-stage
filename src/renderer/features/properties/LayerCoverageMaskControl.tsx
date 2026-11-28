import { useMemo, useState } from 'react';
import {
  resolveShotCoverageMasks,
  validCoverageMaskTargets,
  type Layer,
  type Shot,
} from '../../../domain';
import { layerStore } from '../../stores/layerStore';
import { Button } from '../../ui';

/**
 * Inspector control for author-level coverage masks (#1454, #1447 F07).
 *
 * One deliberate action = one `editorProjectStore.updateProject` = one undo
 * step. No new store is introduced: the mask relationship lives on the formal
 * Layer model and every edit flows through `layerStore` -> `LayerService`.
 */
export function LayerCoverageMaskControl({
  layer,
  shot,
}: {
  layer: Layer;
  shot: Shot;
}): React.JSX.Element | null {
  const [error, setError] = useState('');
  const isMaskLayer = layer.maskTargets !== undefined;
  const resolution = useMemo(() => resolveShotCoverageMasks(shot), [shot]);
  const maskLayer = useMemo(() => {
    const maskLayerId = resolution.maskLayerIdByTarget.get(layer.id);
    return maskLayerId
      ? shot.layers.find((candidate) => candidate.id === maskLayerId) ?? null
      : null;
  }, [layer.id, resolution.maskLayerIdByTarget, shot.layers]);
  const candidates = useMemo(
    () => validCoverageMaskTargets(shot, layer.id),
    [layer.id, shot],
  );
  const issues = useMemo(
    () => resolution.issues.filter((issue) => issue.layerId === layer.id),
    [layer.id, resolution.issues],
  );
  const missingTargetIds = useMemo(() => {
    const byId = new Set(shot.layers.map((candidate) => candidate.id));
    return (layer.maskTargets ?? []).filter((targetLayerId) => !byId.has(targetLayerId));
  }, [layer.maskTargets, shot.layers]);

  if (shot.backgroundLayerId === layer.id || layer.source.kind === 'control') {
    return null;
  }

  const apply = (targetLayerIds: readonly string[] | null): void => {
    try {
      layerStore.setMaskTargets(layer.id, targetLayerIds);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法设置图层遮罩。');
    }
  };

  const toggleTarget = (targetLayerId: string, checked: boolean): void => {
    const current = layer.maskTargets ?? [];
    apply(
      checked
        ? (current.includes(targetLayerId) ? current : [...current, targetLayerId])
        : current.filter((id) => id !== targetLayerId),
    );
  };

  return (
    <details className="animation-key-selection" data-testid="layer-coverage-mask">
      <summary>遮罩</summary>
      {isMaskLayer ? (
        <fieldset className="animation-curve-fields" disabled={layer.locked}>
          <legend>被遮罩图层</legend>
          <p data-testid="layer-coverage-mask-role">
            此图层作为遮罩：不显示在正式画面中，只裁剪所选图层。
          </p>
          {candidates.length > 0 ? (
            candidates.map(({ layer: candidate }) => (
              <label key={candidate.id}>
                <input
                  aria-label={`被遮罩图层 ${candidate.name}`}
                  checked={layer.maskTargets?.includes(candidate.id) ?? false}
                  type="checkbox"
                  onChange={(event) =>
                    toggleTarget(candidate.id, event.currentTarget.checked)
                  }
                />
                {candidate.name}
              </label>
            ))
          ) : (
            <p>当前镜头没有可被遮罩的图层。</p>
          )}
          {missingTargetIds.length > 0 ? (
            <p data-testid="layer-coverage-mask-missing" role="status">
              部分被遮罩图层已不存在，已自动忽略。
            </p>
          ) : null}
          {issues.map((issue) => (
            <p key={`${issue.code}:${issue.targetLayerId ?? ''}`} role="status">
              {issue.message}
            </p>
          ))}
          <Button
            disabled={layer.locked}
            onClick={() => apply(null)}
            type="button"
            variant="secondary"
          >
            解除遮罩
          </Button>
        </fieldset>
      ) : (
        <>
          {maskLayer ? (
            <p data-testid="layer-coverage-mask-source" role="status">
              此图层被「{maskLayer.name}」遮罩裁剪。
            </p>
          ) : null}
          <Button
            disabled={layer.locked}
            onClick={() => apply([])}
            type="button"
          >
            设为遮罩
          </Button>
        </>
      )}
      {error ? <p role="alert">{error}</p> : null}
    </details>
  );
}
