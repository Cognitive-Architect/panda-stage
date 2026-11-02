const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(
  root,
  'src',
  'shared',
  'export-preparation-support-source.json',
);
const outputPath = path.join(root, 'docs', 'export-support-matrix.md');
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const statusLabels = new Map(
  source.capabilityMatrix.statuses.map(({ id, label }) => [id, label]),
);
const layerLabels = new Map(
  source.capabilityMatrix.layers.map(({ id, label }) => [id, label]),
);

function linkEvidence(value) {
  if (value.startsWith('https://')) return `[${value}](${value})`;
  return `[${value}](../${value})`;
}

function statusCell(status) {
  const label = statusLabels.get(status);
  if (!label) throw new Error(`Unknown capability status: ${status}`);
  return `${label} <code>${status}</code>`;
}

function render() {
  const profile = source.profile;
  const layers = source.capabilityMatrix.layers;
  const lines = [
    '# Panda Stage support matrix',
    '',
    `Version: **${source.capabilityMatrix.version}**`,
    '',
    `This file is generated from [export-preparation-support-source.json](../src/shared/export-preparation-support-source.json) by \`pnpm docs:export-support-matrix\`. Main preflight, the Creator summary, and frozen export candidates use the same versioned profile.`,
    '',
    'Statuses describe repository code and recorded automated evidence. They do not claim human Gate B acceptance or packaged-installer acceptance.',
    '',
    '| Content / capability | Formats | ' + layers.map((layer) => layer.label).join(' | ') + ' | Scope and evidence |',
    '| --- | --- | ' + layers.map(() => '---').join(' | ') + ' | --- |',
  ];

  for (const entry of source.capabilityMatrix.entries) {
    const formats = entry.formats.join(', ') || '—';
    const statuses = layers.map(({ id }) => statusCell(entry.statuses[id]));
    const evidence = entry.evidence.map(linkEvidence).join('<br>');
    lines.push(
      `| ${entry.label} | ${formats} | ${statuses.join(' | ')} | ${entry.note}<br><br>Evidence: ${evidence} |`,
    );
  }

  lines.push(
    '',
    '## Current formal-export profile',
    '',
    `- Output: ${source.renderSettings.width}×${source.renderSettings.height} at ${source.renderSettings.fps} fps.`,
    `- Shot count: ${profile.shotCount.minimum}–${profile.shotCount.maximum}; every Shot needs a visible image background.`,
    `- Camera modes: ${profile.cameraModes.join(', ')}. Character compositions: ${profile.characterCompositions.join(', ')}.`,
    `- Frozen media: at most ${profile.budgets.maximumAssets} used assets, ${profile.budgets.maximumSingleAssetBytes / (1024 * 1024)} MiB per asset, and ${profile.budgets.maximumTotalMediaBytes / (1024 * 1024)} MiB total. Only media actually used by the Project is frozen.`,
    `- Windows formal MP4 target and same-directory staging paths are limited to ${source.windowsFormalOutputMaxPathCharacters} characters; longer paths are blocked before preparation.`,
    '',
    'These are code protection limits, not measured performance promises. The matrix lists the narrow capability evidence for each content path; it does not imply that every Project within a limit will complete on every device.',
    '',
    'To check that this file matches its source, run `node scripts/generate-export-support-matrix.cjs --check`. The [R3 measurement plan and report](evidence/issue-836-dl06-measurement.md) records the Windows device, build, project provenance, and unmeasured fields separately.',
    '',
  );

  if (layers.map(({ id }) => id).join(',') !== 'import,shot,preview,formalExport') {
    throw new Error('Capability matrix layer order or IDs changed; update the renderer contract deliberately.');
  }
  if (!layerLabels.has('formalExport')) {
    throw new Error('Formal export layer is missing from the capability matrix.');
  }
  return lines.join('\n');
}

const expected = render();
if (process.argv.includes('--check')) {
  const actual = fs.existsSync(outputPath)
    ? fs.readFileSync(outputPath, 'utf8')
    : '';
  if (actual !== expected) {
    console.error('docs/export-support-matrix.md is stale; run pnpm docs:export-support-matrix.');
    process.exitCode = 1;
  } else {
    console.log('Support matrix documentation matches its source.');
  }
} else {
  fs.writeFileSync(outputPath, expected, 'utf8');
  console.log(`Generated ${path.relative(root, outputPath)} (${source.capabilityMatrix.version}).`);
}
