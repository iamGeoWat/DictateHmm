import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import App from './App.tsx';
import { EvalIndex } from './eval/pages/EvalIndex.tsx';
import { EvalRecord } from './eval/pages/EvalRecord.tsx';
import { EvalRun } from './eval/pages/EvalRun.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/eval" element={<EvalIndex />} />
        <Route path="/eval/record" element={<EvalRecord />} />
        <Route path="/eval/run" element={<EvalRun />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
