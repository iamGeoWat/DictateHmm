import { Link } from 'react-router-dom';

export function EvalIndex() {
  return (
    <div className="app">
      <header>
        <h1>Eval</h1>
        <p className="subtitle">DictateHmm 评测工具</p>
      </header>
      <nav style={{ display: 'flex', gap: 16, padding: 24 }}>
        <Link to="/eval/record">🎙 录制</Link>
        <Link to="/eval/run">📊 跑评测</Link>
        <Link to="/">← 返回输入法</Link>
      </nav>
    </div>
  );
}
