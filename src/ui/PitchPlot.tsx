// Minimal SVG plot of pitch contours per segment.

import type { TonedSegment } from '../types';

type Props = { segments: TonedSegment[] };

export function PitchPlot({ segments }: Props) {
  if (segments.length === 0) return null;

  const W = 600, H = 120, pad = 16;
  const totalMs = segments[segments.length - 1].endMs - segments[0].startMs;
  const t0 = segments[0].startMs;

  // Collect all voiced F0 for y-range in semitones.
  const allHz: number[] = [];
  for (const s of segments) {
    for (const p of s.pitch) if (p.f0Hz) allHz.push(p.f0Hz);
  }
  if (allHz.length === 0) return null;
  const minLog = Math.log2(Math.min(...allHz));
  const maxLog = Math.log2(Math.max(...allHz));
  const logRange = Math.max(0.1, maxLog - minLog);

  const xFor = (ms: number) => pad + ((ms - t0) / Math.max(1, totalMs)) * (W - 2 * pad);
  const yFor = (hz: number) => {
    const l = Math.log2(hz);
    return pad + (1 - (l - minLog) / logRange) * (H - 2 * pad);
  };

  return (
    <svg width={W} height={H} className="pitch-plot">
      <rect x={0} y={0} width={W} height={H} fill="#111" />
      {segments.map((s, i) => {
        const path = s.pitch
          .filter((p) => p.f0Hz !== null)
          .map((p, j) => {
            const x = xFor(s.startMs + p.timeMs - (s.pitch[0]?.timeMs ?? 0));
            const y = yFor(p.f0Hz as number);
            return `${j === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
          })
          .join(' ');
        const color = toneColor(s.tone);
        return (
          <g key={i}>
            <rect
              x={xFor(s.startMs)}
              y={2}
              width={xFor(s.endMs) - xFor(s.startMs)}
              height={H - 4}
              fill={color}
              fillOpacity={0.08}
            />
            <path d={path} stroke={color} strokeWidth={2} fill="none" />
            <text
              x={xFor(s.startMs) + 3}
              y={14}
              fill={color}
              fontSize={11}
              fontWeight="bold"
            >
              {s.tone}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function toneColor(t: number): string {
  switch (t) {
    case 1: return '#6fb1ff';
    case 2: return '#74e0a2';
    case 3: return '#ffd866';
    case 4: return '#ff7a85';
    case 5: return '#bbbbbb';
    default: return '#888';
  }
}
