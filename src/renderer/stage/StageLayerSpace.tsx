import { Fragment, type ReactNode } from 'react';
import Konva from 'konva';
import { Group } from 'react-konva';
import type { cameraWorldTransform } from '../../domain/shot-camera';
import type { AffineMatrix2D } from '../../shared/affine-matrix';

export function StageLayerSpace({ space, projection, children }: {
  space?: AffineMatrix2D;
  projection?: ReturnType<typeof cameraWorldTransform>;
  children: ReactNode;
}): React.JSX.Element {
  if (projection) return <Group {...projection}><StageLayerSpace space={space}>{children}</StageLayerSpace></Group>;
  if (!space) return <Fragment>{children}</Fragment>;
  const { a, b, c, d, tx, ty } = space;
  const transform = new Konva.Transform([a, b, c, d, tx, ty]).decompose();
  return <Group {...transform}>{children}</Group>;
}
