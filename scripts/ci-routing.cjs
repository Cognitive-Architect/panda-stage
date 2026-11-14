const { execFileSync } = require('node:child_process');
const { readFileSync, appendFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
function isDocsOnly(files) {
  return files.length > 0 && files.every(file => /^(?:(?:README|AGENTS|DESIGN)\.md|docs\/.+\.md)$/.test(file.replaceAll('\\', '/')));
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
  const head = process.env.HEAD_SHA || 'HEAD';
  const base = comparisonBase(head, process.env.BASE_SHA);
  if (command === 'check-docs') { checkDocs(base, head); return; }
  if (command !== 'scope') throw Error(`Unknown command: ${command}`);
  const files = changedFiles(base, head);
  const docsOnly = isDocsOnly(files);
  const summary = [
    '## CI scope', '', `Comparison: ${base} → ${head}`,
    docsOnly ? 'Docs only: diff check + relative links.' : 'Core: diff check, typecheck, lint, unit, integration, build.',
  ].join('\n') + '\n';
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `base=${base}\ndocs_only=${docsOnly}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
}

if (require.main === module) runCli();
module.exports = { isDocsOnly, comparisonBase, changedFiles, checkDocs };
