import { Link } from 'react-router-dom';

export function EvalRun() {
  return (
    <div className="app">
      <header>
        <h1>Eval · 跑评测</h1>
        <Link to="/eval">← eval 首页</Link>
      </header>
      <p style={{ padding: 24 }}>待实现（Task 8 会覆盖此文件）</p>
    </div>
  );
}
