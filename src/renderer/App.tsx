import { BOOTSTRAP_MESSAGE } from '../shared/bootstrap';

export function App(): React.JSX.Element {
  return (
    <main className="bootstrap-shell">
      <section className="bootstrap-card" aria-labelledby="app-title">
        <div className="panda-mark" aria-hidden="true">
          <span className="panda-ear panda-ear-left" />
          <span className="panda-ear panda-ear-right" />
          <span className="panda-face">熊</span>
        </div>
        <p className="eyebrow">Desktop animation workspace</p>
        <h1 id="app-title">{BOOTSTRAP_MESSAGE}</h1>
        <p className="status-copy">
          Electron、React 与 TypeScript 工程基线已就绪。
        </p>
        <span className="status-badge">Day 01</span>
      </section>
    </main>
  );
}
