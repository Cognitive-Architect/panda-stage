import { useState } from 'react';
import type { AdaptivePartsCharacter } from '../../../domain';
import { Button } from '../../ui/Button';
import type {
  AdaptiveCharacterManagementAction,
  AdaptivePartsAssemblyActionResult,
} from './CharacterManager';

interface AdaptiveCharacterManagementProps {
  character: AdaptivePartsCharacter;
  onManage: (action: AdaptiveCharacterManagementAction) => AdaptivePartsAssemblyActionResult;
}

export function AdaptiveCharacterManagement({
  character,
  onManage,
}: AdaptiveCharacterManagementProps): React.JSX.Element {
  const [name, setName] = useState(character.name);
  const [scale, setScale] = useState(String(character.defaultScale));
  const [flipX, setFlipX] = useState(character.defaultFlipX);
  const [error, setError] = useState('');
  const scaleValue = Number(scale);
  const nameChanged = Boolean(name.trim() && name.trim() !== character.name);
  const transformChanged = Number.isFinite(scaleValue) &&
    scaleValue >= 0.1 && scaleValue <= 10 &&
    (scaleValue !== character.defaultScale || flipX !== character.defaultFlipX);

  const submit = (action: AdaptiveCharacterManagementAction): void => {
    const result = onManage(action);
    setError(result.message ?? '');
  };

  return (
    <section aria-label="角色属性" className="adaptive-character-management-fields" data-testid="adaptive-character-properties">
      <div className="adaptive-parts-inspector-heading"><strong>角色属性</strong></div>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (nameChanged) submit({ kind: 'rename', name: name.trim() });
      }}>
        <label>角色名称
          <input maxLength={200} onChange={(event) => setName(event.currentTarget.value)} value={name} />
        </label>
        <Button disabled={!nameChanged} type="submit" variant="secondary">重命名</Button>
      </form>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (transformChanged) submit({ kind: 'transform', scale: scaleValue, flipX });
      }}>
        <label>初始大小
          <input
            max={10}
            min={0.1}
            onChange={(event) => setScale(event.currentTarget.value)}
            step="any"
            type="number"
            value={scale}
          />
        </label>
        <label className="adaptive-character-management-flip">
          <input checked={flipX} onChange={(event) => setFlipX(event.currentTarget.checked)} type="checkbox" />
          水平翻转
        </label>
        <Button disabled={!transformChanged} type="submit" variant="secondary">应用</Button>
      </form>
      <Button onClick={() => submit({ kind: 'delete' })} type="button" variant="danger">删除角色</Button>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
