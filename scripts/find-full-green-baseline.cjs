const { execFileSync } = require('node:child_process');
const { appendFileSync } = require('node:fs');

async function githubJson(url, token, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${url}`);
  return response.json();
}

async function findFullGreenBaseline({
  repository,
  pullRequestNumber,
  headRef,
  currentHead,
  token,
  fetchImpl = fetch,
  isAncestor = (candidate, head) => {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', candidate, head], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  },
}) {
  if (!repository || !pullRequestNumber || !headRef || !currentHead || !token) return null;
  const query = new URLSearchParams({ event: 'pull_request', branch: headRef, status: 'success', per_page: '100' });
  const runsPayload = await githubJson(
    `https://api.github.com/repos/${repository}/actions/workflows/ci.yml/runs?${query}`,
    token,
    fetchImpl,
  );
  const candidates = runsPayload.workflow_runs
    .filter((run) => run.head_sha !== currentHead)
    .filter((run) => run.conclusion === 'success')
    .filter((run) => run.pull_requests.some((pr) => Number(pr.number) === Number(pullRequestNumber)))
    .sort((left, right) => Number(right.run_number) - Number(left.run_number));

  for (const run of candidates) {
    if (!isAncestor(run.head_sha, currentHead)) continue;
    const jobsPayload = await githubJson(run.jobs_url, token, fetchImpl);
    const successfulJobs = new Set(
      jobsPayload.jobs.filter((job) => job.conclusion === 'success').map((job) => job.name),
    );
    if (
      successfulJobs.has('Classify change risk') &&
      successfulJobs.has('Full quality and regression') &&
      successfulJobs.has('Final CI result')
    ) {
      return { sha: run.head_sha, runId: run.id, runUrl: run.html_url };
    }
  }
  return null;
}

async function runCli() {
  let result = null;
  let reason = 'no proven same-PR Full-green HEAD; use complete base-to-HEAD classification';
  try {
    result = await findFullGreenBaseline({
      repository: process.env.GITHUB_REPOSITORY,
      pullRequestNumber: process.env.PR_NUMBER,
      headRef: process.env.HEAD_REF,
      currentHead: process.env.HEAD_SHA,
      token: process.env.GITHUB_TOKEN,
    });
    if (result) reason = `proven same-PR Full-green run ${result.runId}`;
  } catch (error) {
    reason = `baseline proof failed (${error.message}); use complete base-to-HEAD classification`;
  }
  console.log(reason);
  if (result) console.log(`Incremental baseline: ${result.sha} (${result.runUrl})`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `sha=${result?.sha ?? ''}\nreason=${reason}\n`);
  }
}

if (require.main === module) runCli().catch((error) => {
  console.error(error);
  process.exitCode = 0;
});

module.exports = { findFullGreenBaseline, githubJson };
