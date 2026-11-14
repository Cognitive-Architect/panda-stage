const { execFileSync } = require('node:child_process');
const { readFileSync, appendFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const loadManifest = () => JSON.parse(readFileSync(path.join(root, 'scripts/verification-manifest.json'), 'utf8'));

function matchesAny(file, patterns) {
  return patterns.some(pattern => {
    let expression = '^';
    for (let index = 0; index < pattern.length; index++) {
      const char = pattern[index];
      if (char === '*' && pattern[index + 1] === '*') {
        index++;
        if (pattern[index + 1] === '/') { index++; expression += '(?:.*/)?'; }
        else expression += '.*';
      } else if (char === '*') expression += '[^/]*';
      else if (char === '?') expression += '[^/]';
      else expression += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
    return new RegExp(`${expression}$`).test(file.replaceAll('\\', '/'));
  });
}

function selectSubsystems(files, manifest = loadManifest()) {
  const suites = new Set();
  const unmapped = [];
  const docsOnly = files.length > 0 && files.every(file => matchesAny(file, manifest.routing.docsPatterns));
  for (const file of files) {
    if (matchesAny(file, manifest.routing.docsPatterns)) continue;
    const field = file.startsWith('tests/') ? 'testPatterns' : file.startsWith('scripts/verify-') ? 'verifierPatterns' : 'sourcePatterns';
    const routes = manifest.routing.routes.filter(route => matchesAny(file, route[field]));
    if (!routes.length) unmapped.push(file);
    for (const route of routes) for (const suite of route.suites) suites.add(suite);
  }
  return { docsOnly, suites: [...suites], unmapped };
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function comparisonBase(head, requested) {
  for (const candidate of [requested, `${head}^`]) {
    if (!candidate || /^0+$/.test(candidate)) continue;
    try { return git(['rev-parse', '--verify', `${candidate}^{commit}`]); } catch { /* Core still runs. */ }
  }
  return execFileSync('git', ['hash-object', '-t', 'tree', '--stdin'], { cwd: root, input: '', encoding: 'utf8' }).trim();
}

function changedFiles(base, head, includeDeleted = true) {
  const args = ['diff', '--name-only', '--no-renames', '-z'];
  if (!includeDeleted) args.push('--diff-filter=ACMRT');
  return execFileSync('git', [...args, base, head], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
}

function checkDocs(base, head) {
  const errors = [];
  for (const file of changedFiles(base, head, false).filter(file => file.endsWith('.md'))) {
    const text = readFileSync(path.join(root, file), 'utf8');
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/g)) {
      const target = match[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) continue;
      const targetPath = decodeURIComponent(target.split('#', 1)[0]);
      if (!targetPath) continue;
      const resolved = path.resolve(root, path.dirname(file), targetPath);
      if ((!resolved.startsWith(root + path.sep) && resolved !== root) || !existsSync(resolved)) errors.push(`${file}: invalid link ${target}`);
    }
  }
  if (errors.length) throw Error(errors.join('\n'));
}

function runCli() {
  const command = process.argv[2];
  const manifest = loadManifest();
  if (command === 'full-suites') { console.log(manifest.routing.fullRegressionSuites.join(' ')); return; }
  const head = process.env.HEAD_SHA || 'HEAD';
  const base = comparisonBase(head, process.env.BASE_SHA);
  if (command === 'check-docs') { checkDocs(base, head); return; }
  if (command !== 'classify') throw Error(`Unknown command: ${command}`);
  const files = changedFiles(base, head);
  const result = selectSubsystems(files, manifest);
  const summary = [
    '## CI scope', '', `Comparison: ${base} → ${head}`,
    result.docsOnly ? 'Docs only: diff check + relative links.' : 'Core: diff check, typecheck, lint, unit, integration, build.',
    result.suites.length ? `Subsystem regression: ${result.suites.join(', ')}` : 'No mapped subsystem regression',
    ...(result.unmapped.length ? ['', 'No mapped subsystem regression for these paths (Core still runs):', ...result.unmapped.map(file => `- ${file}`)] : []),
  ].join('\n') + '\n';
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `base=${base}\ndocs_only=${result.docsOnly}\nsuites=${result.suites.join(' ')}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
}

if (require.main === module) runCli();
module.exports = { selectSubsystems, matchesAny, comparisonBase, changedFiles, checkDocs };
