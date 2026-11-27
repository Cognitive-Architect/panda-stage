import { useEffect, useMemo, useRef, useState } from 'react';
import {
  applyScopedLayerDepthEdit,
  canEditLayerDepth,
  depthToParallaxSlider,
  evaluateShotAtTime,
  LAYER_DEPTH_MAX,
  LAYER_DEPTH_MIN,
  PARALLAX_SLIDER_ZERO_POSITION,
  parallaxSliderToDepth,
  resolveLayerDepthSource,
  type Layer,
  type LayerDepthSourceInfo,
  type Shot,
} from '../../../domain';
import {
  depthPreviewStore,
  useDepthPreview,
  type DepthPreviewHandle,
} from '../../stores/depthPreviewStore';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { shotStore } from '../../stores/shotStore';
import { timelineUiStore, useTimelineUi } from '../timeline/timelineUiStore';

const SLIDER_RESOLUTION = 1_000;

function formatDepthNumber(depth: number): number {
  const rounded = Number(depth.toFixed(2));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function describeDepthSource(source: LayerDepthSourceInfo): string {
  switch (source.kind) {
    case 'depth-keys':
      return '当前帧深度键';
    case 'dynamic-preserve':
      return '当前交接段独立';
    case 'dynamic-inherit':
      return source.parentLayerName ? `交接段继承 · ${source.parentLayerName}` : '交接段继承';
    case 'own-static':
      return '独立深度';
    case 'inherited-static':
      return source.parentLayerName ? `继承自 ${source.parentLayerName}` : '继承父级';
    case 'default':
      return '默认 0';
  }
}

export function LayerDepthControl({ layer, shot, snapshot }: {
  layer: Layer;
  shot: Shot;
  snapshot: EditorProjectSnapshot;
}): React.JSX.Element {
  const { currentTimeMs } = useTimelineUi();
  const depthPreview = useDepthPreview();
  const [error, setError] = useState('');
  const sessionRef = useRef<DepthPreviewHandle | null>(null);
  const editable = canEditLayerDepth(layer, shot);
  const hasKeys = Boolean(layer.depthKeys?.length);

  const activePreview =
    depthPreview &&
    depthPreview.revision === snapshot.revision &&
    depthPreview.shotId === shot.id &&
    depthPreview.layerId === layer.id &&
    depthPreview.timeMs === currentTimeMs
      ? depthPreview
      : null;

  const evaluatedLayer = useMemo(
    () =>
      evaluateShotAtTime(shot, currentTimeMs, snapshot.project).layers.find(
        ({ id }) => id === layer.id,
      ),
    [currentTimeMs, layer.id, shot, snapshot.project],
  );
  const evaluatedDepth = evaluatedLayer?.effectiveDepth ?? 0;
  const effectiveCameraSpace = evaluatedLayer?.effectiveCameraSpace ?? layer.cameraSpace ?? 'world';
  const depthSource = useMemo(
    () => resolveLayerDepthSource(shot, layer, currentTimeMs),
    [currentTimeMs, layer, shot],
  );

  const displayedDepth = activePreview ? activePreview.depth : evaluatedDepth;
  const formattedEffectiveDepth = formatDepthNumber(displayedDepth);
  const sliderValue = Math.round(depthToParallaxSlider(displayedDepth) * SLIDER_RESOLUTION);

  const isInheriting =
    depthSource.kind === 'inherited-static' || depthSource.kind === 'dynamic-inherit';
  const inputDefaultValue = activePreview
    ? formattedEffectiveDepth
    : hasKeys || depthSource.kind === 'dynamic-preserve'
      ? formattedEffectiveDepth
      : isInheriting
        ? ''
        : layer.depth ?? '';

  useEffect(() => {
    return () => {
      sessionRef.current?.cancel();
      sessionRef.current = null;
    };
  }, [layer.id, shot.id, snapshot.revision, currentTimeMs]);

  const isContextCurrent = (): boolean =>
    editorProjectStore.getSnapshot() === snapshot &&
    shotStore.getCurrentShotId() === shot.id &&
    timelineUiStore.getSnapshot().currentTimeMs === currentTimeMs;

  const commitDepth = (depth: number | undefined, label = '设置图层深度'): void => {
    if (!isContextCurrent()) return;
    const next = applyScopedLayerDepthEdit(
      snapshot.project,
      shot.id,
      layer.id,
      currentTimeMs,
      depth,
    );
    if (next !== snapshot.project) {
      editorProjectStore.updateProject(next, label);
    }
    setError('');
  };

  const beginSliderPreview = (): DepthPreviewHandle | null => {
    if (!editable || !isContextCurrent()) return null;
    if (sessionRef.current) return sessionRef.current;
    const handle = depthPreviewStore.begin(layer.id, evaluatedDepth);
    sessionRef.current = handle;
    return handle;
  };

  const finishSliderPreview = (): void => {
    const handle = sessionRef.current;
    if (!handle) return;
    sessionRef.current = null;
    handle.finish((final) => {
      if (!isContextCurrent()) return;
      if (final.previewProject !== snapshot.project) {
        editorProjectStore.updateProject(final.previewProject, '设置图层深度');
      }
      setError('');
    });
  };

  const cancelSliderPreview = (): void => {
    const handle = sessionRef.current;
    if (!handle) return;
    sessionRef.current = null;
    handle.cancel();
  };

  const handleSliderChange = (rawSlider: number): void => {
    if (!editable) return;
    const nextDepth = formatDepthNumber(
      parallaxSliderToDepth(rawSlider / SLIDER_RESOLUTION),
    );
    const handle = beginSliderPreview();
    if (handle) {
      handle.setDepth(nextDepth);
    }
  };

  const zeroTickPercent = `${(PARALLAX_SLIDER_ZERO_POSITION * 100).toFixed(2)}%`;

  return (
    <div
      data-testid="layer-depth-control"
      style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '6px',
          fontSize: '12px',
        }}
      >
        <label htmlFor={`layer-depth-input-${layer.id}`}>图层深度</label>
        <span
          data-testid="layer-depth-source"
          style={{
            color: 'var(--ui-color-text-secondary, #aebfb4)',
            fontSize: '11px',
          }}
        >
          {describeDepthSource(depthSource)}
          {effectiveCameraSpace === 'screen' ? ' · 屏幕空间' : ''}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <input
            aria-label="视差深度滑条"
            data-testid="layer-depth-slider"
            disabled={!editable}
            max={SLIDER_RESOLUTION}
            min={0}
            onBlur={finishSliderPreview}
            onChange={(event) => handleSliderChange(event.currentTarget.valueAsNumber)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                cancelSliderPreview();
                event.currentTarget.blur();
              } else if (event.key === 'Enter') {
                finishSliderPreview();
              }
            }}
            onPointerCancel={cancelSliderPreview}
            onPointerDown={() => {
              beginSliderPreview();
            }}
            onPointerUp={finishSliderPreview}
            step={1}
            style={{ width: '100%', margin: 0 }}
            type="range"
            value={sliderValue}
          />
          <span
            aria-hidden="true"
            data-testid="layer-depth-zero-tick"
            title="零深度基准 (0)"
            style={{
              position: 'absolute',
              left: zeroTickPercent,
              top: '50%',
              width: '2px',
              height: '12px',
              transform: 'translate(-50%, -50%)',
              background: 'var(--ui-color-selected-border, #7fc794)',
              pointerEvents: 'none',
              opacity: 0.85,
            }}
          />
        </div>
        <div
          style={{
            position: 'relative',
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '10px',
            color: 'var(--ui-color-text-muted, #84958b)',
          }}
        >
          <span>近 ({LAYER_DEPTH_MIN})</span>
          <span
            style={{
              position: 'absolute',
              left: zeroTickPercent,
              transform: 'translateX(-50%)',
            }}
          >
            0
          </span>
          <span>远 ({LAYER_DEPTH_MAX})</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <input
          id={`layer-depth-input-${layer.id}`}
          type="number"
          aria-label="图层深度"
          key={`${snapshot.revision}:${currentTimeMs}:${activePreview ? `draft:${formattedEffectiveDepth}` : String(inputDefaultValue)}`}
          min={LAYER_DEPTH_MIN}
          max={LAYER_DEPTH_MAX}
          step="any"
          defaultValue={inputDefaultValue}
          placeholder={String(formattedEffectiveDepth)}
          disabled={!editable}
          style={{ width: '96px' }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              event.currentTarget.value = String(inputDefaultValue);
              event.currentTarget.blur();
            }
          }}
          onBlur={(event) => {
            const input = event.currentTarget;
            if (input.value === String(inputDefaultValue)) return;
            if (!isContextCurrent()) return;
            try {
              const depth = input.value === '' ? undefined : input.valueAsNumber;
              if (
                !input.validity.valid ||
                (hasKeys && depth === undefined) ||
                (depthSource.kind === 'dynamic-preserve' && !depthSource.parentLayerId && depth === undefined)
              ) {
                throw new Error('请输入范围内的深度数值。');
              }
              commitDepth(depth);
            } catch (cause) {
              input.value = String(inputDefaultValue);
              setError(cause instanceof Error ? cause.message : '无法设置图层深度。');
            }
          }}
        />
        {isInheriting && editable ? (
          <button
            type="button"
            data-testid="layer-depth-make-independent"
            data-ui-button
            data-ui-variant="secondary"
            onClick={() => {
              try {
                commitDepth(
                  formattedEffectiveDepth,
                  depthSource.kind === 'dynamic-inherit'
                    ? '当前交接段转为独立深度'
                    : '转为独立深度',
                );
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : '无法转为独立深度。');
              }
            }}
          >
            {depthSource.kind === 'dynamic-inherit' ? '当前段独立' : '转为独立'}
          </button>
        ) : null}
      </div>

      {error && <div role="alert">{error}</div>}
    </div>
  );
}
