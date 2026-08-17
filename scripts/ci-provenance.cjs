const { execFileSync } = require('node:child_process');
const { appendFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const READY_STATUS_CONTEXT = 'Ready Full proof';
const READY_JOB_NAMES = [
  'Classify change risk',
  'Full quality and regression',
  'Ready candidate proof',
  'Final CI result',
];

function apiHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function fetchJson(url, { token, fetchImpl = fetch, method = 'GET', body } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      ...apiHeaders(token),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`GitHub API ${method} ${url} returned ${response.status}`);
  return response.json();
}

function readLocalCommit(sha) {
  const fields = execFileSync('git', ['rev-list', '--parents', '-n', '1', sha], {
    cwd: root,
    encoding: 'utf8',
  }).trim().split(/\s+/);
  return { sha: fields[0], parents: fields.slice(1) };
}

function readLocalTree(sha) {
  return execFileSync('git', ['rev-parse', `${sha}^{tree}`], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
}

function unproven(reason, extra = {}) {
  return { proven: false, reason, candidateSha: '', readyRunId: '', ...extra };
}

async function verifyMainProvenance({
  repository,
  token,
  beforeSha,
  headSha,
  fetchImpl = fetch,
  readCommit = readLocalCommit,
  readTree = readLocalTree,
}) {
  if (!repository || !token || !beforeSha || !headSha || /^0+$/.test(beforeSha)) {
    return unproven('push provenance inputs are incomplete');
  }

  let commit;
  try {
    commit = readCommit(headSha);
  } catch {
    return unproven('pushed main commit could not be inspected');
  }
  if (commit.parents.length !== 2) {
    return unproven('main HEAD is not a two-parent merge commit');
  }
  if (commit.parents[0] !== beforeSha) {
    return unproven('push before SHA is not the merge commit first parent');
  }

  const candidateSha = commit.parents[1];
  let candidateTree;
  let mergedTree;
  try {
    candidateTree = readTree(candidateSha);
    mergedTree = readTree(headSha);
  } catch {
    return unproven('candidate or merged tree could not be inspected', { candidateSha });
  }
  if (candidateTree !== mergedTree) {
    return unproven('merged main tree differs from the Ready candidate tree', { candidateSha });
  }

  const baseUrl = `https://api.github.com/repos/${repository}`;
  let statusPayload;
  let runsPayload;
  try {
    statusPayload = await fetchJson(`${baseUrl}/commits/${candidateSha}/status`, {
      token,
      fetchImpl,
    });
    const query = new URLSearchParams({
      event: 'pull_request',
      head_sha: candidateSha,
      status: 'completed',
      per_page: '100',
    });
    runsPayload = await fetchJson(`${baseUrl}/actions/workflows/ci.yml/runs?${query}`, {
      token,
      fetchImpl,
    });
  } catch (error) {
    return unproven(`GitHub proof lookup failed: ${error.message}`, { candidateSha });
  }

  const readyStatus = statusPayload.statuses?.some((status) => (
    status.context === READY_STATUS_CONTEXT && status.state === 'success'
  ));
  if (!readyStatus) {
    return unproven(`candidate lacks successful ${READY_STATUS_CONTEXT} status`, { candidateSha });
  }

  for (const run of runsPayload.workflow_runs || []) {
    if (run.head_sha !== candidateSha || run.conclusion !== 'success') continue;
    let jobsPayload;
    try {
      jobsPayload = await fetchJson(run.jobs_url, { token, fetchImpl });
    } catch {
      continue;
    }
    const jobs = jobsPayload.jobs || [];
    const completeProof = READY_JOB_NAMES.every((name) => (
      jobs.some((job) => job.name === name && job.conclusion === 'success')
    ));
    if (completeProof) {
      return {
        proven: true,
        reason: `merged tree matches Ready Full-green candidate ${candidateSha} from run ${run.id}`,
        candidateSha,
        candidateTree,
        mergedTree,
        readyRunId: String(run.id),
        readyRunUrl: run.html_url,
      };
    }
  }

  return unproven('no successful same-SHA Ready Full/Final workflow proof was found', {
    candidateSha,
  });
}

async function recordReadyProof({ repository, token, headSha, runId, serverUrl, fetchImpl = fetch }) {
  if (!repository || !token || !headSha || !runId) {
    throw new Error('ready proof inputs are incomplete');
  }
  const targetUrl = `${serverUrl || 'https://github.com'}/${repository}/actions/runs/${runId}`;
  await fetchJson(`https://api.github.com/repos/${repository}/statuses/${headSha}`, {
    token,
    fetchImpl,
    method: 'POST',
    body: {
      state: 'success',
      context: READY_STATUS_CONTEXT,
      description: 'Exact candidate passed Ready Full regression',
      target_url: targetUrl,
    },
  });
  return { context: READY_STATUS_CONTEXT, targetUrl };
}

function writeOutput(result) {
  const lines = [
    `proven=${result.proven}`,
    `reason=${result.reason}`,
    `candidate_sha=${result.candidateSha || ''}`,
    `ready_run_id=${result.readyRunId || ''}`,
  ];
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  console.log(`Proven: ${result.proven}`);
  console.log(`Reason: ${result.reason}`);
  if (result.candidateSha) console.log(`Candidate SHA: ${result.candidateSha}`);
  if (result.readyRunId) console.log(`Ready run: ${result.readyRunId}`);
}

async function runCli() {
  const command = process.argv[2];
  if (command === 'verify-main') {
    const result = await verifyMainProvenance({
      repository: process.env.GITHUB_REPOSITORY,
      token: process.env.GITHUB_TOKEN,
      beforeSha: process.env.BEFORE_SHA,
      headSha: process.env.HEAD_SHA,
    });
    writeOutput(result);
    if (process.env.REQUIRE_PROVEN === 'true' && !result.proven) process.exitCode = 1;
    return;
  }
  if (command === 'record-ready') {
    const result = await recordReadyProof({
      repository: process.env.GITHUB_REPOSITORY,
      token: process.env.GITHUB_TOKEN,
      headSha: process.env.HEAD_SHA,
      runId: process.env.GITHUB_RUN_ID,
      serverUrl: process.env.GITHUB_SERVER_URL,
    });
    console.log(`Recorded ${result.context}: ${result.targetUrl}`);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  READY_JOB_NAMES,
  READY_STATUS_CONTEXT,
  recordReadyProof,
  verifyMainProvenance,
};
