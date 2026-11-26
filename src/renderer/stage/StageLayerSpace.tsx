import { Fragment, type ReactNode } from 'react';
import Konva from 'konva';
import { Group } from 'react-konva';
import type { AffineMatrix2D } from '../../shared/affine-matrix';

export function StageLayerSpace({ space, children }: {
  space?: AffineMatrix2D;
  children: ReactNode;
}): React.JSX.Element {
  if (!space) return <Fragment>{children}</Fragment>;
  const { a, b, c, d, tx, ty } = space;
  const transform = new Konva.Transform([a, b, c, d, tx, ty]).decompose();
  return <Group {...transform}>{children}</Group>;
}
