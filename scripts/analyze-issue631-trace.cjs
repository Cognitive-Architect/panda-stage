const { readFileSync } = require('node:fs');

const tracePath = process.argv[2];
if (!tracePath) throw new Error('Usage: node scripts/analyze-issue631-trace.cjs TRACE_JSON');
const parsed = JSON.parse(readFileSync(tracePath, 'utf8'));
const events = Array.isArray(parsed) ? parsed : parsed.traceEvents;
if (!Array.isArray(events)) throw new Error('Trace JSON has no traceEvents array.');

const names = new Map();
for (const event of events) {
  if (event.ph !== 'M') continue;
  if (event.name === 'process_name') names.set(`${event.pid}`, event.args?.name);
  if (event.name === 'thread_name') names.set(`${event.pid}:${event.tid}`, event.args?.name);
}

const slices = events.filter((event) => event.ph === 'X' && Number.isFinite(event.dur));
const byName = new Map();
const byThread = new Map();
for (const event of slices) {
  const process = names.get(`${event.pid}`) ?? `${event.pid}`;
  const thread = names.get(`${event.pid}:${event.tid}`) ?? `${event.tid}`;
  const key = `${process} / ${thread} / ${event.name}`;
  const row = byName.get(key) ?? { process, thread, name: event.name, count: 0, totalMs: 0, maxMs: 0 };
  const durationMs = event.dur / 1000;
  row.count += 1;
  row.totalMs += durationMs;
  row.maxMs = Math.max(row.maxMs, durationMs);
  byName.set(key, row);
  const threadKey = `${process} / ${thread}`;
  const threadRow = byThread.get(threadKey) ?? { process, thread, count: 0, totalMs: 0, maxMs: 0 };
  threadRow.count += 1;
  threadRow.totalMs += durationMs;
  threadRow.maxMs = Math.max(threadRow.maxMs, durationMs);
  byThread.set(threadKey, threadRow);
}

const round = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [
  key, typeof value === 'number' ? Number(value.toFixed(2)) : value,
]));
const top = (rows, key, limit) => [...rows].sort((a, b) => b[key] - a[key]).slice(0, limit).map(round);
function percentile(values, share) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.floor((sorted.length - 1) * share)].toFixed(2));
}
function eventMetrics(process, thread, eventName) {
  const selected = slices.filter((event) =>
    names.get(`${event.pid}`) === process &&
    names.get(`${event.pid}:${event.tid}`) === thread &&
    event.name === eventName);
  const durations = selected.map((event) => event.dur / 1000);
  const intervals = selected.slice(1).map((event, index) => (event.ts - selected[index].ts) / 1000);
  return {
    name: eventName, count: selected.length,
    durationMedianMs: percentile(durations, 0.5), durationP95Ms: percentile(durations, 0.95),
    intervalMedianMs: percentile(intervals, 0.5), intervalP95Ms: percentile(intervals, 0.95),
  };
}
function asyncMetrics(eventName) {
  const starts = new Map();
  const pairs = [];
  for (const event of events) {
    if (event.name !== eventName || !['b', 'e'].includes(event.ph)) continue;
    const id = event.id2?.local ?? event.id;
    if (id === undefined) continue;
    const key = `${event.pid}:${event.tid}:${id}`;
    if (event.ph === 'b') starts.set(key, event.ts);
    else if (starts.has(key)) {
      pairs.push([starts.get(key), event.ts]);
      starts.delete(key);
    }
  }
  // Chromium emits the same frame timing for more than one surface ID.
  const uniquePairs = [...new Set(pairs.map(([start, end]) => `${start}:${end}`))];
  const durations = uniquePairs.map((pair) => {
    const [start, end] = pair.split(':').map(Number);
    return (end - start) / 1000;
  });
  return {
    name: eventName, rawPairCount: pairs.length, uniquePairCount: uniquePairs.length,
    durationMedianMs: percentile(durations, 0.5), durationP95Ms: percentile(durations, 0.95),
  };
}
const gpuFrames = slices.filter((event) =>
  names.get(`${event.pid}`) === 'GPU Process' &&
  names.get(`${event.pid}:${event.tid}`) === 'VizCompositorThread' &&
  event.name === 'DirectRenderer::DrawFrame');
const quadSlices = slices.filter((event) =>
  names.get(`${event.pid}`) === 'GPU Process' &&
  names.get(`${event.pid}:${event.tid}`) === 'VizCompositorThread' &&
  event.name === 'SoftwareRenderer::DoDrawQuad');
const quadsPerFrame = gpuFrames.map((frame) => {
  const matching = quadSlices.filter((quad) =>
    quad.ts >= frame.ts && quad.ts < frame.ts + frame.dur);
  return {
    count: matching.length,
    totalMs: matching.reduce((sum, quad) => sum + quad.dur / 1000, 0),
  };
});
const graphicsPattern = /frame|raster|composit|paint|swap|present|draw|vsync|raf|schedul|submit|sync|wait|gpu/i;
const relevant = [...byName.values()].filter((row) => graphicsPattern.test(row.name));
const result = {
  eventCount: events.length,
  sliceCount: slices.length,
  processNames: [...names.entries()].filter(([key]) => !key.includes(':')),
  focusedMetrics: [
    ['Renderer', 'CrRendererMain', 'ProxyMain::BeginMainFrame'],
    ['Renderer', 'CrRendererMain', 'FrameRequestCallbackCollection::ExecuteFrameCallbacks'],
    ['Renderer', 'CrRendererMain', 'CanvasRenderingContext2D::FinalizeFrame'],
    ['Renderer', 'ThreadPoolForegroundWorker', 'RasterTask'],
    ['Renderer', 'Compositor', 'ProxyImpl::ScheduledActionDraw'],
    ['GPU Process', 'VizCompositorThread', 'DisplayScheduler::OnBeginFrameDeadline'],
    ['GPU Process', 'VizCompositorThread', 'DirectRenderer::DrawFrame'],
    ['GPU Process', 'VizCompositorThread', 'DirectRenderer::DrawRenderPass'],
    ['GPU Process', 'VizCompositorThread', 'SoftwareRenderer::DoDrawQuad'],
    ['GPU Process', 'VizCompositorThread', 'SoftwareRenderer::SwapBuffers'],
  ].map(([process, thread, eventName]) => ({ process, thread, ...eventMetrics(process, thread, eventName) })),
  pipelineMetrics: [
    'EndActivateToSubmitCompositorFrame',
    'SubmitToReceiveCompositorFrame',
    'SubmitCompositorFrameToPresentationCompositorFrame',
    'StartDrawToSwapStart',
    'SwapEndToPresentationCompositorFrame',
    'Graphics.Pipeline.DrawAndSwap',
  ].map(asyncMetrics),
  quadsPerGpuFrame: {
    frameCount: quadsPerFrame.length,
    countMedian: percentile(quadsPerFrame.map((frame) => frame.count), 0.5),
    countP95: percentile(quadsPerFrame.map((frame) => frame.count), 0.95),
    totalMsMedian: percentile(quadsPerFrame.map((frame) => frame.totalMs), 0.5),
    totalMsP95: percentile(quadsPerFrame.map((frame) => frame.totalMs), 0.95),
  },
  sampleQuadArgs: quadSlices[0]?.args ?? null,
  topThreadsBySlices: top(byThread.values(), 'count', 20),
  topRelevantByTotalMs: top(relevant, 'totalMs', 70),
  topRelevantByMaxMs: top(relevant, 'maxMs', 35),
  longSlices: top(slices.filter((event) => event.dur >= 50000).map((event) => ({
    process: names.get(`${event.pid}`) ?? `${event.pid}`,
    thread: names.get(`${event.pid}:${event.tid}`) ?? `${event.tid}`,
    name: event.name,
    category: event.cat,
    atMs: event.ts / 1000,
    durationMs: event.dur / 1000,
  })), 'durationMs', 60),
};
console.log(JSON.stringify(result, null, 2));
