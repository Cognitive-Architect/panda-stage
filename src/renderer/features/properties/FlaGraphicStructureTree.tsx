import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Diamond, Folder, Image, Layers, LockKeyhole, Plus, X } from 'lucide-react';
import {
  assessFlaGraphicSubtreeCandidate,
  buildAdaptivePartsFromFlaGraphicSubtrees,
  doFlaGraphicNodePathsOverlap,
  flaGraphicNodePathsEqual,
  isFlaGraphicDefinition,
  isFlaGraphicEditableSubtreeShapeNode,
  isFlaGraphicNodeTransformable,
  type FlaGraphicSubtreeCandidateAssessment,
} from '../../../domain';
import { characterAssemblySessionStore } from '../../stores/characterAssemblySessionStore';
import { characterStore } from '../../stores/characterStore';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { DecorativeIcon } from '../../ui';
import { isFlaGraphicNodeEnterable, resolveFlaGraphicExitScopeTransition } from '../canvas/flaGraphicEditScope';
import { projectStructureTree, structureAncestorKeys, type StructureTreeRow } from './flaGraphicStructureTreeModel';
import { useStructuredGraphicSelection } from './useStructuredGraphicSelection';
import './structuredGraphicInspector.css';

interface StagedSubtreeSelection {
  readonly key: string;
  readonly nodePath: readonly string[];
  readonly label: string;
}

export function FlaGraphicStructureTree(): React.JSX.Element | null {
  const { snapshot, target, scope, path } = useStructuredGraphicSelection();
  const rows = useMemo(() => target?.animation.structure ? projectStructureTree(target.frame, target.animation.structure) : [], [target?.animation, target?.frame]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [stagedSubtrees, setStagedSubtrees] = useState<readonly StagedSubtreeSelection[]>([]);
  const [extractError, setExtractError] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const selectedKey = path ? JSON.stringify(path) : null;
  const revealPath = path ?? scope?.path;
  const revealKey = revealPath ? JSON.stringify(revealPath) : null;
  useEffect(() => {
    setExpanded(new Set(rows.map(row => row.key)));
  }, [target?.sessionKey]);
  useEffect(() => {
    setStagedSubtrees([]);
    setExtractError(null);
  }, [target?.sessionKey, target?.frameOrdinal]);
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
  const flatten = (items: readonly StructureTreeRow[]): StructureTreeRow[] => items.flatMap(row => [row, ...flatten(row.children)]);
  const allRows = useMemo(() => flatten(rows), [rows]);
  const selectedAssessment = useMemo<FlaGraphicSubtreeCandidateAssessment | null>(() => {
    if (!target?.animation.structure || !path?.length) return null;
    return assessFlaGraphicSubtreeCandidate({
      definition: target.animation,
      frameOrdinal: target.frameOrdinal,
      nodePath: path,
      instanceTransformOverrides: target.layer.flaGraphicInstanceTransformOverrides,
      assets: snapshot?.project.assets,
    });
  }, [path, snapshot?.project.assets, target?.animation, target?.frameOrdinal, target?.layer.flaGraphicInstanceTransformOverrides]);
  const stagedAssessments = useMemo(() => {
    if (!target?.animation.structure) return [];
    return stagedSubtrees.map((item) => ({
      item,
      assessment: assessFlaGraphicSubtreeCandidate({
        definition: target.animation,
        frameOrdinal: target.frameOrdinal,
        nodePath: item.nodePath,
        instanceTransformOverrides: target.layer.flaGraphicInstanceTransformOverrides,
        assets: snapshot?.project.assets,
      }),
    }));
  }, [snapshot?.project.assets, stagedSubtrees, target?.animation, target?.frameOrdinal, target?.layer.flaGraphicInstanceTransformOverrides]);

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
        <DecorativeIcon icon={icon} size={15} />
        <span
          className="fla-structure-label"
          title={row.node && isFlaGraphicEditableSubtreeShapeNode(row.node) ? '可整块变换（路径/锚点暂不可编辑）' : undefined}
        >
          {row.label}
        </span>
        {row.type === 'opaque' && (!row.node || !isFlaGraphicNodeTransformable(row.node)) ? <span title="当前对象只读" aria-label="当前对象只读"><LockKeyhole size={12} /></span> : null}
      </div>
      {row.children.length && open ? <div role="group">{row.children.map(child => renderRow(child, depth + 1))}</div> : null}
    </div>;
  };

  const selectedStagedIndex = path?.length
    ? stagedSubtrees.findIndex((item) => flaGraphicNodePathsEqual(item.nodePath, path))
    : -1;
  const overlappingStaged = path?.length && selectedStagedIndex < 0
    ? stagedSubtrees.find((item) => doFlaGraphicNodePathsOverlap(item.nodePath, path))
    : undefined;
  const selectedRowLabel = selectedKey
    ? allRows.find((row) => row.key === selectedKey)?.label
    : undefined;
  const selectedDisplayLabel = selectedRowLabel ?? selectedAssessment?.label ?? '零件';
  const canToggleSelected = selectedStagedIndex >= 0 || Boolean(selectedAssessment?.extractable && !overlappingStaged);
  const selectedHint = selectedStagedIndex >= 0
    ? null
    : overlappingStaged
      ? `与已选零件“${overlappingStaged.label}”存在包含关系，请选择独立部位。`
      : selectedAssessment?.extractable
        ? selectedAssessment.warning ?? null
        : selectedAssessment?.reason ?? null;
  const hasInvalidStaged = stagedAssessments.some((entry) => !entry.assessment.extractable);
  const canCreateAdaptiveCharacter = stagedSubtrees.length >= 2 && !hasInvalidStaged;

  const toggleSelectedSubtree = (): void => {
    if (!path?.length) return;
    setExtractError(null);
    if (selectedStagedIndex >= 0) {
      setStagedSubtrees((current) => current.filter((_, index) => index !== selectedStagedIndex));
      return;
    }
    if (!selectedAssessment?.extractable || overlappingStaged) return;
    const key = JSON.stringify(path);
    setStagedSubtrees((current) => [
      ...current,
      { key, nodePath: [...path], label: selectedDisplayLabel },
    ]);
  };

  const handleCreateAdaptiveCharacter = (): void => {
    const liveSnapshot = editorProjectStore.getSnapshot() ?? snapshot;
    if (!liveSnapshot) {
      setExtractError('当前项目未打开，无法创建角色。');
      return;
    }
    const liveDefinition = liveSnapshot.project.animations.find(
      (candidate) => candidate.id === target.animation.id,
    );
    if (!liveDefinition || !isFlaGraphicDefinition(liveDefinition) || !liveDefinition.structure) {
      setExtractError('当前元件结构已变更，请重新选择零件。');
      return;
    }
    const liveShot = liveSnapshot.project.shots.find((shot) => shot.id === target.shotId);
    const liveLayer = liveShot?.layers.find((layer) => layer.id === target.layerId);
    try {
      const input = buildAdaptivePartsFromFlaGraphicSubtrees({
        project: liveSnapshot.project,
        definition: liveDefinition,
        frameOrdinal: target.frameOrdinal,
        selections: stagedSubtrees.map((item) => ({
          nodePath: item.nodePath,
          label: item.label,
        })),
        instanceTransformOverrides:
          liveLayer?.flaGraphicInstanceTransformOverrides ??
          target.layer.flaGraphicInstanceTransformOverrides,
      });
      const updatedProject = characterStore.createAdaptiveParts(input, liveSnapshot);
      const createdPartId = input.parts[0]?.partId;
      const createdCharacter =
        (createdPartId
          ? updatedProject.characters.find(
              (candidate) =>
                candidate.mode === 'adaptive-parts' &&
                candidate.parts.some((part) => part.partId === createdPartId),
            )
          : undefined) ?? updatedProject.characters.at(-1);
      setStagedSubtrees([]);
      setExtractError(null);
      if (createdCharacter?.mode === 'adaptive-parts') {
        characterAssemblySessionStore.beginAdaptiveParts(createdCharacter.id);
      }
    } catch (error) {
      setExtractError(
        error instanceof Error ? error.message : '创建独立零件角色失败。',
      );
    }
  };

  return <details className="right-inspector-section fla-structure-section" open data-testid="fla-structure-inspector">
    <summary>结构</summary>
    {scope && scope.path.length > 0 ? <nav aria-label="元件层级" className="fla-structure-breadcrumb">
      <button type="button" onClick={() => setScope([], null)}>{target.animation.name}</button>
      {scope.path.map((_, index) => { const ancestor = scope.path.slice(0, index + 1); return <span key={JSON.stringify(ancestor)}> › <button type="button"
        aria-current={index === scope.path.length - 1 ? 'location' : undefined} onClick={() => setScope(ancestor, null)}>
        {allRows.find(row => row.key === JSON.stringify(ancestor))?.label ?? '组'}</button></span>; })}
    </nav> : null}
    <div role="tree" aria-label="元件结构" className="fla-structure-tree" ref={treeRef}>{rows.map(row => renderRow(row, 0))}</div>
    {path?.length || stagedSubtrees.length > 0 || extractError ? (
      <div className="fla-subtree-panel" data-testid="fla-subtree-panel">
        {path?.length ? (
          <div className="fla-subtree-action-row">
            <button
              type="button"
              className="fla-subtree-stage-button"
              data-testid="fla-subtree-stage-toggle"
              disabled={!canToggleSelected}
              onClick={toggleSelectedSubtree}
            >
              <Plus aria-hidden="true" size={14} />
              <span>{selectedStagedIndex >= 0 ? '移出零件列表' : '加入角色零件'}</span>
            </button>
            <span className="fla-subtree-selection-name" title={selectedDisplayLabel}>
              {selectedDisplayLabel}
            </span>
          </div>
        ) : null}
        {selectedHint ? (
          <p className="fla-subtree-note" role="status">{selectedHint}</p>
        ) : null}
        {stagedSubtrees.length > 0 ? (
          <div className="fla-subtree-staged-group">
            <ul className="fla-subtree-staged-list" data-testid="fla-subtree-staged-list" aria-label="已选拆件零件">
              {stagedAssessments.map(({ item, assessment }) => (
                <li className="fla-subtree-staged-item" key={item.key}>
                  <span className="fla-subtree-staged-label" title={item.label}>{item.label}</span>
                  {!assessment.extractable ? (
                    <span className="fla-subtree-staged-badge">已失效</span>
                  ) : null}
                  <button
                    type="button"
                    className="fla-subtree-remove-button"
                    aria-label={`移除 ${item.label}`}
                    onClick={() => {
                      setExtractError(null);
                      setStagedSubtrees((current) =>
                        current.filter((candidate) => candidate.key !== item.key),
                      );
                    }}
                  >
                    <X aria-hidden="true" size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="fla-subtree-create-row">
              <button
                type="button"
                className="fla-subtree-create-button"
                data-testid="fla-subtree-create-character"
                disabled={!canCreateAdaptiveCharacter}
                onClick={handleCreateAdaptiveCharacter}
              >
                创建角色
              </button>
              <span className="fla-subtree-create-hint">
                {stagedSubtrees.length < 2
                  ? '再选 1 个零件即可创建'
                  : hasInvalidStaged
                    ? '请先移除失效节点'
                    : `已选 ${stagedSubtrees.length} 个独立零件`}
              </span>
            </div>
          </div>
        ) : null}
        {extractError ? (
          <p className="fla-subtree-error" role="alert">{extractError}</p>
        ) : null}
      </div>
    ) : null}
  </details>;
}
