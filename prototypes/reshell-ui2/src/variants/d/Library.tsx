import { useState } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { Activity, Grid2X2, List, Music, Plus, Search } from 'lucide-react';
import { ASSETS, CATEGORIES, assetUrl } from '../../core/assets';
import { fmtTime } from '../../core/model';
import { actions, currentLayer, useStore } from '../../core/store';
import { Context, IconButton, motions } from './controls';

const categories = [...CATEGORIES, '动作'] as const;
type Category = (typeof categories)[number];

export function Library() {
  const [category, setCategory] = useState<Category>('角色');
  const [query, setQuery] = useState('');
  const [choices, setChoices] = useState<Partial<Record<Category, boolean>>>({});
  const [picked, setPicked] = useState('');
  const layer = useStore(currentLayer);
  const grid = choices[category] ?? (category !== '音频' && category !== '动作');
  const items = category === '动作'
    ? motions.map((motion) => ({ ...motion, tags: [], thumb: undefined, metadata: '' }))
    : ASSETS.filter((asset) => asset.category === category).map((asset) => ({
      ...asset, thumb: asset.svg && assetUrl(asset),
      metadata: asset.duration ? fmtTime(asset.duration) : `${asset.w} × ${asset.h}`,
    }));
  const filtered = items.filter((item) => [item.name, ...item.tags].some((name) =>
    name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const canAdd = category !== '动作' || (!!layer && !layer.locked && layer.kind !== 'background');
  const add = (id: string) => {
    if (category !== '动作') actions.placeAsset(id);
    else {
      const motion = motions.find((entry) => entry.id === id);
      if (motion && layer && canAdd) actions.addAction(layer.id, motion.id);
    }
  };

  return (
    <div className="vd-panel vd-library">
      <div className="vd-categories" aria-label="素材分类">
        {categories.map((entry) => <button key={entry} className="vd-button" aria-pressed={entry === category}
          onClick={() => { setCategory(entry); setQuery(''); setPicked(''); }}>{entry}</button>)}
      </div>
      <div className="vd-strip">
        <label className="vd-search"><Search size={13} /><input aria-label="筛选素材" placeholder="筛选素材" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <IconButton label={grid ? '列表视图' : '网格视图'} onClick={() => setChoices({ ...choices, [category]: !grid })}>{grid ? <List size={15} /> : <Grid2X2 size={15} />}</IconButton>
      </div>
      <div className={`vd-media ${grid ? 'grid' : 'list'}`}>
        {filtered.map((item) => (
          <Context key={item.id} target={
            <button className="vd-asset" aria-pressed={picked === item.id} draggable={category !== '动作'}
              onDragStart={(e) => e.dataTransfer.setData('text/asset', item.id)}
              onClick={() => setPicked(item.id)} onDoubleClick={() => add(item.id)}>
              <span className="vd-thumb">{item.thumb ? <img src={item.thumb} alt="" /> : category === '音频' ? <Music size={16} /> : <Activity size={16} />}</span>
              <span>{item.name}</span>
              {!grid && item.metadata && <small>{item.metadata}</small>}
            </button>
          }>
            <ContextMenu.Item disabled={!canAdd} onSelect={() => add(item.id)}>{category === '动作' ? '应用到选中图层' : '放入当前镜头'}</ContextMenu.Item>
          </Context>
        ))}
        {!filtered.length && <div className="vd-empty">无匹配素材</div>}
      </div>
      <div className="vd-strip vd-footer">
        <button className="vd-button" disabled={!canAdd || !filtered.some((item) => item.id === picked)} onClick={() => add(picked)}>
          <Plus size={14} />{category === '动作' ? '应用动作' : '放入镜头'}
        </button>
      </div>
    </div>
  );
}
