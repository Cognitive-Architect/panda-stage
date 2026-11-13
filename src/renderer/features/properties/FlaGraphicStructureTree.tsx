import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Diamond, Folder, Image, Layers, LockKeyhole } from 'lucide-react';
import { selectionStore } from '../../stores/selectionStore';
import { DecorativeIcon } from '../../ui';
import { isFlaGraphicNodeEnterable, resolveFlaGraphicExitScopeTransition } from '../canvas/flaGraphicEditScope';
import { projectStructureTree, structureAncestorKeys, type StructureTreeRow } from './flaGraphicStructureTreeModel';
import { useStructuredGraphicSelection } from './useStructuredGraphicSelection';
import './structuredGraphicInspector.css';

export function FlaGraphicStructureTree(): React.JSX.Element | null {
  const { target, scope, path } = useStructuredGraphicSelection();
  const rows = useMemo(() => target?.animation.structure ? projectStructureTree(target.frame, target.animation.structure) : [], [target?.animation, target?.frame]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const treeRef = useRef<HTMLDivElement>(null);
  const selectedKey = path ? JSON.stringify(path) : null;
  const revealPath = path ?? scope?.path;
  const revealKey = revealPath ? JSON.stringify(revealPath) : null;
  useEffect(() => {
    setExpanded(new Set(rows.map(row => row.key)));
  }, [target?.sessionKey]);
  useEffect(() => {
    if (!revealPath?.length) return;
    setExpanded(current => new Set([...current, ...rows.map(row => row.key), ...structureAncestorKeys(revealPath), ...(scope && !path ? [JSON.stringify(scope.path)] : [])]));
  }, [revealKey, scope?.path]);
  useEffect(() => {
    const tree = treeRef.current;
    const row = tree?.querySelector('[aria-selected="true"], [data-current-scope="true"]');
    if (!tree || !row) return;
    const viewport = tree.getBoundingClientRect();
    const selected = row.getBoundingClientRect();
    if (selected.top < viewport.top) tree.scrollTop -= viewport.top - selected.top;
    else if (selected.bottom > viewport.bottom) tree.scrollTop += selected.bottom - viewport.bottom;
    const drawer = tree.closest<HTMLElement>('.right-inspector-drawer');
    const visible = drawer?.getBoundingClientRect();
    const revealed = row.getBoundingClientRect();
    if (drawer && visible) {
      if (revealed.bottom > visible.bottom) drawer.scrollTop += revealed.bottom - visible.bottom;
      else if (revealed.top < visible.top) drawer.scrollTop -= visible.top - revealed.top;
    }
  }, [revealKey, expanded]);
  if (!target?.animation.structure) return null;
  const setScope = (scopePath: readonly string[], selectedPath: readonly string[] | null) => {
    selectionStore.setStructuredEditScope({ targetKey: target.key, sessionKey: target.sessionKey,
      editMode: scope?.editMode ?? 'instance', frameOrdinal: target.frameOrdinal, path: scopePath });
    selectionStore.setSelectedStructuredNodePath(selectedPath);
  };
  const renderRow = (row: StructureTreeRow, depth: number): React.JSX.Element => {
    const open = expanded.has(row.key);
    const selected = selectedKey === row.key;
    const currentScope = scope && JSON.stringify(scope.path) === row.key;
    const icon = row.type === 'layer' ? Layers : row.type === 'group' ? Folder : row.type === 'bitmap' ? Image : Diamond;
    return <div role="none" key={row.key}>
      <div role="treeitem" aria-label={row.label} aria-selected={selected}
        aria-expanded={row.children.length ? open : undefined} aria-level={depth + 1}
        tabIndex={0} className="fla-structure-row" data-current-scope={currentScope || undefined}
        style={{ paddingInlineStart: depth * 16 }}
        onClick={() => { if (row.node) {
          if (!scope) setScope([], row.path); else selectionStore.setSelectedStructuredNodePath(row.path);
        } else selectionStore.setSelectedStructuredNodePath(null); }}
        onDoubleClick={() => { if (row.node && isFlaGraphicNodeEnterable(row.node, target.animation.structure)) setScope(row.path, null); }}
        onKeyDown={event => {
          if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && row.children.length) {
            event.preventDefault();
            setExpanded(current => { const next = new Set(current); if (event.key === 'ArrowRight') next.add(row.key); else next.delete(row.key); return next; });
          }
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click(); }
          if (event.key === 'Escape' && scope) {
            event.stopPropagation();
            const next = resolveFlaGraphicExitScopeTransition(target.frame, scope.path, target.animation.structure);
            if (next.nextScopePath) setScope(next.nextScopePath, next.nextSelectedNodePath);
            else { selectionStore.setStructuredEditScope(null); selectionStore.setSelectedStructuredNodePath(null); }
          }
        }}>
        {row.children.length ? <button type="button" tabIndex={-1} aria-label={`${open ? '收起' : '展开'}${row.label}`}
          className="fla-structure-chevron" onClick={event => { event.stopPropagation(); setExpanded(current => {
            const next = new Set(current); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); return next;
          }); }} onDoubleClick={event => event.stopPropagation()}><ChevronRight size={14} style={{ transform: open ? 'rotate(90deg)' : undefined }} /></button>
          : <span className="fla-structure-chevron" />}
        <DecorativeIcon icon={icon} size={15} /><span className="fla-structure-label">{row.label}</span>
        {row.type === 'opaque' ? <span title="当前对象只读" aria-label="当前对象只读"><LockKeyhole size={12} /></span> : null}
      </div>
      {row.children.length && open ? <div role="group">{row.children.map(child => renderRow(child, depth + 1))}</div> : null}
    </div>;
  };
  const flatten = (items: readonly StructureTreeRow[]): StructureTreeRow[] => items.flatMap(row => [row, ...flatten(row.children)]);
  const allRows = flatten(rows);
  return <details className="right-inspector-section fla-structure-section" open data-testid="fla-structure-inspector">
    <summary>结构</summary>
    {scope && scope.path.length > 0 ? <nav aria-label="元件层级" className="fla-structure-breadcrumb">
      <button type="button" onClick={() => setScope([], null)}>{target.animation.name}</button>
      {scope.path.map((_, index) => { const ancestor = scope.path.slice(0, index + 1); return <span key={JSON.stringify(ancestor)}> › <button type="button"
        aria-current={index === scope.path.length - 1 ? 'location' : undefined} onClick={() => setScope(ancestor, null)}>
        {allRows.find(row => row.key === JSON.stringify(ancestor))?.label ?? '组'}</button></span>; })}
    </nav> : null}
    <div role="tree" aria-label="元件结构" className="fla-structure-tree" ref={treeRef}>{rows.map(row => renderRow(row, 0))}</div>
  </details>;
}
