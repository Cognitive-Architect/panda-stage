import { useEffect, useRef, useState } from 'react';
import type { Project, Shot } from '../../../domain';
import {
  isShotThumbnailRequestCurrent,
  requestShotThumbnail,
  shotThumbnailFingerprint,
  type ShotThumbnailRequestIdentity,
  type ShotThumbnailRequest,
  type ShotThumbnailResult,
} from './shotThumbnail';
import {
  ShotThumbnailPlaceholder,
  type ShotThumbnailPlaceholderStatus,
} from './ShotThumbnailPlaceholder';

export interface ShotThumbnailProps {
  index: number;
  name: string;
  project?: Project | null;
  projectRoot?: string;
  shot: Shot;
}

export type ShotThumbnailState =
  | {
      status: 'empty' | 'missing' | 'error';
      fingerprint: string | null;
      message?: string;
    }
  | {
      status: 'loading';
      fingerprint: string;
    }
  | ShotThumbnailResult;

function initialState(
  projectRoot: string | undefined,
  project: Project | null | undefined,
  shot: Shot,
): ShotThumbnailState {
  const fingerprint = project ? shotThumbnailFingerprint(project, shot) : null;
  if (shot.layers.length === 0) return { status: 'empty', fingerprint };
  if (!project || !projectRoot) return { status: 'missing', fingerprint };
  return {
    status: 'loading',
    fingerprint: shotThumbnailFingerprint(project, shot),
  };
}

function placeholderMessage(
  status: ShotThumbnailPlaceholderStatus,
  message?: string,
): string | undefined {
  if (message) return message;
  if (status === 'empty') return '暂无可预览画面';
  if (status === 'loading') return '正在生成缩略图';
  if (status === 'missing') return '源素材不可用';
  return '缩略图生成失败';
}

export function useShotThumbnail(
  projectRoot: string | undefined,
  project: Project | null | undefined,
  shot: Shot,
): ShotThumbnailState {
  const fingerprint = project ? shotThumbnailFingerprint(project, shot) : null;
  const requestRef = useRef<
    (ShotThumbnailRequestIdentity & { request: ShotThumbnailRequest }) | null
  >(null);
  requestRef.current =
    project && projectRoot && shot.layers.length > 0 && fingerprint
      ? {
          projectRoot,
          fingerprint,
          request: { projectRoot, project, shot },
        }
      : null;
  const [state, setState] = useState<ShotThumbnailState>(() =>
    initialState(projectRoot, project, shot),
  );

  useEffect(() => {
    const currentRequest = requestRef.current;
    if (!currentRequest) {
      setState(initialState(projectRoot, project, shot));
      return undefined;
    }
    let active = true;
    const { request, fingerprint: requestFingerprint, projectRoot: requestRoot } =
      currentRequest;
    setState({ status: 'loading', fingerprint: requestFingerprint });
    void requestShotThumbnail(request).then((result) => {
      if (
        active &&
        isShotThumbnailRequestCurrent(requestRef.current, {
          projectRoot: requestRoot,
          fingerprint: result.fingerprint,
        })
      ) {
        setState(result);
      }
    });
    return () => {
      active = false;
    };
  }, [fingerprint, projectRoot]);

  return state;
}

export function ShotThumbnail({
  index,
  name,
  project,
  projectRoot,
  shot,
}: ShotThumbnailProps): React.JSX.Element {
  const state = useShotThumbnail(projectRoot, project, shot);
  if (state.status !== 'ready') {
    const status: ShotThumbnailPlaceholderStatus =
      state.status === 'loading' ? 'loading' : state.status;
    const message = 'message' in state ? state.message : undefined;
    return (
      <ShotThumbnailPlaceholder
        fingerprint={state.fingerprint ?? undefined}
        index={index}
        message={placeholderMessage(status, message)}
        name={name}
        shotId={shot.id}
        status={status}
      />
    );
  }

  return (
    <div
      aria-label={`${name} 合成缩略图`}
      className="shot-thumbnail"
      data-thumbnail-shot-id={shot.id}
      data-shot-thumbnail="true"
      data-thumbnail-fingerprint={state.fingerprint}
      data-thumbnail-status="ready"
      data-testid="shot-thumbnail"
    >
      <img
        alt={`${name} 合成缩略图`}
        decoding="async"
        draggable={false}
        src={state.dataUrl}
      />
    </div>
  );
}
