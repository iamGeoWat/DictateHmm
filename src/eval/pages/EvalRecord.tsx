import { Link } from 'react-router-dom';

export function EvalRecord() {
  return (
    <div className="app">
      <header>
        <h1>Eval · 录制</h1>
        <Link to="/eval">← eval 首页</Link>
      </header>
      <p style={{ padding: 24 }}>待实现（Task 7 会覆盖此文件）</p>
    </div>
  );
}
