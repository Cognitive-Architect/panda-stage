import { useState } from 'react';
import { previewBatchNames, type BatchRenameOptions } from '../../../domain/services/batchRename';

const defaults: BatchRenameOptions = { prefix: '', suffix: '', find: '', replacement: '', numbered: false };

export function BatchRenameFields({ entries, onApply }: {
  entries: readonly { id: string; name: string }[];
  onApply: (names: ReadonlyMap<string, string>) => void;
}): React.JSX.Element | null {
  const [options, setOptions] = useState(defaults);
  const [error, setError] = useState('');
  if (!entries.length) return null;
  let names: string[] | undefined;
  try {
    names = previewBatchNames(entries, options);
  } catch {
    // The preview is invalid until all generated names pass the shared schema.
  }
  return (
    <fieldset>
      <legend>批量改名</legend>
      <div className="animation-curve-fields">
        {([['prefix', '前缀'], ['suffix', '后缀'], ['find', '查找'], ['replacement', '替换为']] as const)
          .map(([field, label]) => <label key={field}>{label}<input maxLength={200} value={options[field]}
            onChange={(event) => {
              const value = event.target.value;
              setOptions((current) => ({ ...current, [field]: value }));
            }} /></label>)}
        <label><input type="checkbox" checked={options.numbered} onChange={(event) => {
          const numbered = event.target.checked;
          setOptions((current) => ({ ...current, numbered }));
        }} />按列表顺序编号</label>
      </div>
      {names ? <ol>{entries.map((entry, index) =>
        <li key={entry.id}>{entry.name} → {names[index]}</li>)}</ol>
        : <p role="alert">名称须为 1–200 个字符。</p>}
      <button type="button" disabled={!names?.some((name, index) => name !== entries[index]?.name)}
        onClick={() => {
          if (!names) return;
          try {
            onApply(new Map(entries.map(({ id }, index) => [id, names[index]!])));
            setError('');
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : '批量改名失败。');
          }
        }}>确认改名</button>
      {error ? <p role="alert">{error}</p> : null}
    </fieldset>
  );
}
