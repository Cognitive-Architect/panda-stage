import { useEffect, useRef, useState } from 'react';

export interface ExportOpts { format: 'mp4' | 'gif' | 'png'; res: '720p' | '1080p' | '4k'; fps: 24 | 30 | 60; range: 'shot' | 'all'; quality: number }
export const defaultExport: ExportOpts = { format: 'mp4', res: '1080p', fps: 24, range: 'all', quality: 80 };

/** Simulated export progress. No rendering, no FFmpeg. */
export function useExportSim() {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [progress, setProgress] = useState(0);
  const t = useRef(0);
  useEffect(() => () => clearInterval(t.current), []);
  return {
    phase, progress,
    start() { setPhase('running'); setProgress(0); clearInterval(t.current); t.current = window.setInterval(() => setProgress((p) => { if (p >= 100) { clearInterval(t.current); setPhase('done'); return 100; } return p + 4; }), 80); },
    cancel() { clearInterval(t.current); setPhase('idle'); setProgress(0); },
  };
}
