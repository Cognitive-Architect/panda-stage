import { useId, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
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
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
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
    if (result.ok) menu.current?.hidePopover?.();
  };

  return (
    <>
      <button
        aria-label="角色管理"
        className="adaptive-parts-row-action adaptive-character-management-trigger"
        data-testid="adaptive-character-management"
        onClick={() => {
          setName(character.name);
          setScale(String(character.defaultScale));
          setFlipX(character.defaultFlipX);
          setError('');
        }}
        popoverTarget={id}
        title="角色管理"
        type="button"
      >
        <MoreHorizontal aria-hidden="true" size={18} />
      </button>
      <div
        aria-label="角色管理"
        className="adaptive-character-management-menu"
        id={id}
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.stopPropagation();
        }}
        popover="auto"
        ref={menu}
        role="group"
      >
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
      </div>
    </>
  );
}
