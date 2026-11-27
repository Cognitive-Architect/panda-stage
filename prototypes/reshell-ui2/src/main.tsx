import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { actions, bindHotkeys } from './core/store';
import './core/shared.css';
import VariantA from './variants/a/VariantA';
import VariantB from './variants/b/VariantB';
import VariantC from './variants/c/VariantC';

type V = 'A' | 'B' | 'C';
const read = (): V => { const v = new URLSearchParams(location.search).get('variant')?.toUpperCase(); return v === 'B' || v === 'C' ? v : 'A'; };
const NAMES: Record<V, string> = { A: '现代创作', B: '工业专业', C: '现代效率' };

function Switcher({ v, set }: { v: V; set: (v: V) => void }) {
  const [min, setMin] = useState(false);
  return (
    <div className={`proto-switcher ${min ? 'min' : ''}`}>
      <button className="ps-grip" onClick={() => setMin(!min)} title="原型切换器（非产品界面）">{min ? '◧' : '原型'}</button>
      {!min && (<>
        {(['A', 'B', 'C'] as V[]).map((k) => (
          <button key={k} className={v === k ? 'on' : ''} onClick={() => set(k)} title={NAMES[k]}><b>{k}</b><span>{NAMES[k]}</span></button>
        ))}
        <button className="ps-reset" onClick={() => { if (confirm('将共用示例恢复到初始状态？')) actions.reset(); }}>重置示例</button>
      </>)}
    </div>
  );
}

function App() {
  const [v, setV] = useState<V>(read);
  useEffect(() => { bindHotkeys(); const f = () => setV(read()); window.addEventListener('popstate', f); return () => window.removeEventListener('popstate', f); }, []);
  useEffect(() => { document.documentElement.dataset.variant = v; document.title = `Panda Stage · ReShell 原型 ${v}`; }, [v]);
  const set = (k: V) => { actions.play(false); history.pushState(null, '', `?variant=${k}`); setV(k); };
  return (
    <>
      {v === 'A' && <VariantA />}
      {v === 'B' && <VariantB />}
      {v === 'C' && <VariantC />}
      <Switcher v={v} set={set} />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
