export interface InteractivePreviewFrame {
  timeMs: number;
  angleDeg: number;
  fullScene: string;
  partFocus: string;
}

export interface InteractivePreviewScenario {
  id: string;
  title: string;
  targetLabel: string;
  note: string;
  fullViewBox: string;
  focusViewBox: string;
  frames: readonly InteractivePreviewFrame[];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function frameMarkup(scenarios: readonly InteractivePreviewScenario[]): string {
  return scenarios
    .map((scenario) =>
      scenario.frames
        .map(
          (frame, index) =>
            `<g class="preview-frame" id="frame-${escapeHtml(scenario.id)}-${index}-full" data-scenario="${escapeHtml(scenario.id)}" data-index="${index}" data-view="full" style="display:none">${frame.fullScene}</g><g class="preview-frame" id="frame-${escapeHtml(scenario.id)}-${index}-focus" data-scenario="${escapeHtml(scenario.id)}" data-index="${index}" data-view="focus" style="display:none">${frame.partFocus}</g>`,
        )
        .join(''),
    )
    .join('');
}

function scenarioMetadata(scenarios: readonly InteractivePreviewScenario[]): string {
  return JSON.stringify(
    scenarios.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      targetLabel: scenario.targetLabel,
      note: scenario.note,
      fullViewBox: scenario.fullViewBox,
      focusViewBox: scenario.focusViewBox,
      frames: scenario.frames.map(({ timeMs, angleDeg }) => ({ timeMs, angleDeg })),
    })),
  ).replaceAll('<', '\\u003c');
}

export function buildInteractivePreviewHtml(
  scenarios: readonly InteractivePreviewScenario[],
  sharedAssetDefinitions: string,
): string {
  if (scenarios.length === 0) {
    throw new Error('An interactive preview requires at least one scenario.');
  }
  if (scenarios.some((scenario) => scenario.frames.length < 2)) {
    throw new Error('Each interactive preview scenario requires multiple frames.');
  }

  const firstScenario = scenarios[0]!;
  const markup = frameMarkup(scenarios);
  const metadata = scenarioMetadata(scenarios);
  const initialViewBox = escapeHtml(firstScenario.fullViewBox);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none';">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>C5-KF-00 本地旋转预览</title>
  <style>
    :root{color-scheme:dark;font-family:"Segoe UI",sans-serif;background:#111714;color:#edf3ee;font-synthesis:none;text-rendering:optimizeLegibility}
    *{box-sizing:border-box}
    body{margin:0;min-width:640px;min-height:100vh;background:linear-gradient(140deg,#101814,#17221c 55%,#111714)}
    .app{max-width:1480px;margin:0 auto;padding:22px 28px 26px}
    header{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:18px}
    h1{margin:0;font-size:20px;letter-spacing:.01em;font-weight:650}
    .local-tag{color:#a6c4b2;font-size:12px}
    .layout{display:grid;grid-template-columns:minmax(0,1fr) 286px;gap:18px;align-items:start}
    .stage-wrap{min-height:540px;aspect-ratio:16/10;overflow:hidden;border:1px solid #34483d;border-radius:12px;background:#e9ece8;box-shadow:0 18px 44px #05090766}
    #stage{display:block;width:100%;height:100%;background:#e9ece8}
    .controls{display:flex;flex-direction:column;gap:18px;padding:4px 0}
    label,.control-label{display:block;color:#a9b9ae;font-size:12px;margin-bottom:7px}
    select{width:100%;height:42px;padding:0 12px;border:1px solid #405248;border-radius:8px;background:#1b2821;color:#edf3ee;font:inherit}
    .mode-buttons{display:grid;grid-template-columns:1fr 1fr;gap:7px}
    button{height:40px;border:1px solid #405248;border-radius:8px;background:#1b2821;color:#e9f1eb;font:inherit;cursor:pointer}
    button:hover{border-color:#83b69a;background:#22332a}
    button[aria-pressed="true"]{border-color:#8dc4a3;background:#244533;color:#f1fff5}
    .play-button{width:100%;height:44px;border-color:#6ca981;background:#28613f;font-weight:650}
    .play-button:hover{background:#32764d}
    .readouts{display:flex;justify-content:space-between;align-items:end;gap:10px}
    .time-readout{font-variant-numeric:tabular-nums;color:#b8c9bd;font-size:13px}
    .angle-readout{font-size:28px;font-weight:650;line-height:1;font-variant-numeric:tabular-nums;color:#a6d6b5}
    input[type="range"]{width:100%;accent-color:#78b58d;cursor:pointer}
    .ticks{display:flex;justify-content:space-between;color:#819389;font-size:10px;margin-top:3px;font-variant-numeric:tabular-nums}
    .ghost-toggle{display:flex;align-items:center;gap:8px;color:#c8d6cc;font-size:12px}
    .ghost-toggle input{accent-color:#78b58d}
    .note{min-height:42px;border-left:2px solid #79b08a;padding:2px 0 2px 10px;color:#becdc2;font-size:12px;line-height:1.55}
    .warning{border-color:#d4a75b;color:#e6d2ab}
    footer{margin-top:14px;color:#819389;font-size:11px}
    #stage.hide-start-ghost .start-ghost{display:none}
    @media(max-width:900px){.app{padding:16px}.layout{grid-template-columns:1fr}.stage-wrap{min-height:360px}.controls{display:grid;grid-template-columns:1fr 1fr;gap:14px}.controls .wide{grid-column:1/-1}}
  </style>
</head>
<body>
  <div class="app">
    <header><h1>C5-KF-00 · 袖臂旋转可视实验</h1><span class="local-tag">离线本地预览</span></header>
    <main class="layout">
      <div class="stage-wrap">
        <svg id="stage" xmlns="http://www.w3.org/2000/svg" viewBox="${initialViewBox}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="袖臂旋转预览">
          <defs>${sharedAssetDefinitions}</defs>
          ${markup}
        </svg>
      </div>
      <section class="controls" aria-label="预览控制">
        <div class="wide"><label for="scenarioSelect">动作样例</label><select id="scenarioSelect"></select></div>
        <div class="wide"><span class="control-label">观察方式</span><div class="mode-buttons"><button id="fullMode" type="button" aria-pressed="true">完整人物</button><button id="focusMode" type="button" aria-pressed="false">突出目标零件</button></div></div>
        <label id="ghostControl" class="ghost-toggle wide"><input id="ghostToggle" type="checkbox" checked> 显示起始姿势叠影</label>
        <div class="wide readouts"><span id="timeReadout" class="time-readout">0 ms</span><output id="angleReadout" class="angle-readout">0°</output></div>
        <div class="wide"><label for="timeSlider">时间</label><input id="timeSlider" type="range" min="0" max="1000" step="1" value="0"><div class="ticks"><span>0 ms</span><span>250</span><span>500</span><span>750</span><span>1000 ms</span></div></div>
        <button id="playPause" class="play-button wide" type="button">播放 1 秒循环</button>
        <div id="scenarioNote" class="note wide"></div>
      </section>
    </main>
    <footer>按 24 FPS 帧网格取样 · 拖动时间可任意往返 Seek · 不修改项目</footer>
  </div>
  <script id="preview-data" type="application/json">${metadata}</script>
  <script>
    (() => {
      const scenarios = JSON.parse(document.getElementById('preview-data').textContent);
      const stage = document.getElementById('stage');
      const scenarioSelect = document.getElementById('scenarioSelect');
      const fullMode = document.getElementById('fullMode');
      const focusMode = document.getElementById('focusMode');
      const ghostControl = document.getElementById('ghostControl');
      const ghostToggle = document.getElementById('ghostToggle');
      const timeSlider = document.getElementById('timeSlider');
      const timeReadout = document.getElementById('timeReadout');
      const angleReadout = document.getElementById('angleReadout');
      const scenarioNote = document.getElementById('scenarioNote');
      const playPause = document.getElementById('playPause');
      const frameGroups = Array.from(stage.querySelectorAll('.preview-frame'));
      let mode = 'full';
      let playing = false;
      let animationFrame = 0;
      let startedAt = 0;
      let startOffset = 0;
      let currentFrameKey = '';

      for (const scenario of scenarios) {
        scenarioSelect.add(new Option(scenario.title, scenario.id));
      }

      function selectedScenario() {
        return scenarios.find((scenario) => scenario.id === scenarioSelect.value) || scenarios[0];
      }

      function nearestFrameIndex(scenario, timeMs) {
        let nearest = 0;
        for (let index = 1; index < scenario.frames.length; index += 1) {
          if (Math.abs(scenario.frames[index].timeMs - timeMs) < Math.abs(scenario.frames[nearest].timeMs - timeMs)) nearest = index;
        }
        return nearest;
      }

      function formatAngle(value) {
        return Object.is(value, -0) ? '0' : Number(value.toFixed(2)).toString();
      }

      function renderAt(timeMs) {
        const scenario = selectedScenario();
        const frameIndex = nearestFrameIndex(scenario, timeMs);
        const frame = scenario.frames[frameIndex];
        const frameKey = scenario.id + ':' + frameIndex + ':' + mode;
        if (frameKey !== currentFrameKey) {
          const selectedId = 'frame-' + scenario.id + '-' + frameIndex + '-' + mode;
          for (const group of frameGroups) group.style.display = group.id === selectedId ? 'inline' : 'none';
          currentFrameKey = frameKey;
        }
        stage.setAttribute('viewBox', mode === 'full' ? scenario.fullViewBox : scenario.focusViewBox);
        stage.classList.toggle('hide-start-ghost', mode !== 'focus' || !ghostToggle.checked);
        ghostControl.hidden = mode !== 'focus';
        fullMode.setAttribute('aria-pressed', String(mode === 'full'));
        focusMode.setAttribute('aria-pressed', String(mode === 'focus'));
        focusMode.textContent = '突出 ' + scenario.targetLabel;
        timeSlider.value = String(frame.timeMs);
        timeReadout.textContent = frame.timeMs + ' ms';
        angleReadout.textContent = formatAngle(frame.angleDeg) + '°';
        scenarioNote.textContent = scenario.note;
        scenarioNote.classList.toggle('warning', scenario.id.includes('diagnostic'));
      }

      function pause() {
        playing = false;
        cancelAnimationFrame(animationFrame);
        playPause.textContent = '播放 1 秒循环';
      }

      function tick(now) {
        if (!playing) return;
        renderAt((startOffset + (now - startedAt)) % 1000);
        animationFrame = requestAnimationFrame(tick);
      }

      playPause.addEventListener('click', () => {
        if (playing) {
          pause();
          return;
        }
        playing = true;
        startedAt = performance.now();
        startOffset = Number(timeSlider.value) % 1000;
        playPause.textContent = '暂停';
        animationFrame = requestAnimationFrame(tick);
      });
      timeSlider.addEventListener('input', () => {
        pause();
        renderAt(Number(timeSlider.value));
      });
      scenarioSelect.addEventListener('change', () => {
        pause();
        currentFrameKey = '';
        renderAt(0);
      });
      fullMode.addEventListener('click', () => { mode = 'full'; currentFrameKey = ''; renderAt(Number(timeSlider.value)); });
      focusMode.addEventListener('click', () => { mode = 'focus'; currentFrameKey = ''; renderAt(Number(timeSlider.value)); });
      ghostToggle.addEventListener('change', () => renderAt(Number(timeSlider.value)));
      renderAt(0);
    })();
  </script>
</body>
</html>
`;
}
