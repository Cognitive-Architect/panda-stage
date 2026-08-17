import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  READY_JOB_NAMES,
  READY_STATUS_CONTEXT,
  recordReadyProof,
  verifyMainProvenance,
} = require('../../scripts/ci-provenance.cjs');

const beforeSha = 'base-a';
const candidateSha = 'candidate-a';
const headSha = 'merge-a';
const response = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
});
const proofJobs = {
  jobs: READY_JOB_NAMES.map((name: string) => ({ name, conclusion: 'success' })),
};

function proofFetch({ status = true, jobs = proofJobs } = {}) {
  return async (url: string) => {
    if (url.endsWith(`/commits/${candidateSha}/status`)) {
      return response({
        statuses: status
          ? [{ context: READY_STATUS_CONTEXT, state: 'success' }]
          : [],
      });
    }
    if (url.includes('/actions/workflows/ci.yml/runs?')) {
      return response({ workflow_runs: [{
        id: 230,
        head_sha: candidateSha,
        conclusion: 'success',
        jobs_url: 'https://jobs/230',
        html_url: 'https://runs/230',
      }] });
    }
    if (url === 'https://jobs/230') return response(jobs);
    throw new Error(`Unexpected URL: ${url}`);
  };
}

function verify(overrides: Record<string, unknown> = {}) {
  return verifyMainProvenance({
    repository: 'owner/repo',
    token: 'token',
    beforeSha,
    headSha,
    fetchImpl: proofFetch(),
    readCommit: () => ({ sha: headSha, parents: [beforeSha, candidateSha] }),
    readTree: () => 'tree-a',
    ...overrides,
  });
}

describe('RH-07 main merge provenance', () => {
  it('accepts only an exact merge tree with same-SHA Ready Full and Final proof', async () => {
    await expect(verify()).resolves.toMatchObject({
      proven: true,
      candidateSha,
      candidateTree: 'tree-a',
      mergedTree: 'tree-a',
      readyRunId: '230',
    });
  });

  it('falls back for direct or non-merge pushes', async () => {
    await expect(verify({
      readCommit: () => ({ sha: headSha, parents: [beforeSha] }),
    })).resolves.toMatchObject({ proven: false, reason: 'main HEAD is not a two-parent merge commit' });
  });

  it('falls back when the push before SHA is not the first merge parent', async () => {
    await expect(verify({
      readCommit: () => ({ sha: headSha, parents: ['other-base', candidateSha] }),
    })).resolves.toMatchObject({
      proven: false,
      reason: 'push before SHA is not the merge commit first parent',
    });
  });

  it('falls back when merged content differs from the tested candidate', async () => {
    await expect(verify({
      readTree: (sha: string) => sha === candidateSha ? 'candidate-tree' : 'merged-tree',
    })).resolves.toMatchObject({
      proven: false,
      reason: 'merged main tree differs from the Ready candidate tree',
    });
  });

  it('does not reuse HEAD-A proof for a changed HEAD-B candidate', async () => {
    const changedCandidate = 'candidate-b';
    const fetchImpl = async (url: string) => {
      if (url.endsWith(`/commits/${changedCandidate}/status`)) return response({ statuses: [] });
      if (url.includes('/actions/workflows/ci.yml/runs?')) return response({ workflow_runs: [] });
      throw new Error(`Unexpected URL: ${url}`);
    };
    await expect(verify({
      fetchImpl,
      readCommit: () => ({ sha: headSha, parents: [beforeSha, changedCandidate] }),
    })).resolves.toMatchObject({
      proven: false,
      candidateSha: changedCandidate,
      reason: `candidate lacks successful ${READY_STATUS_CONTEXT} status`,
    });
  });

  it.each([
    ['missing status', proofFetch({ status: false }), `candidate lacks successful ${READY_STATUS_CONTEXT} status`],
    [
      'missing Final job',
      proofFetch({ jobs: { jobs: proofJobs.jobs.filter((job: { name: string }) => job.name !== 'Final CI result') } }),
      'no successful same-SHA Ready Full/Final workflow proof was found',
    ],
  ])('falls back for %s', async (_label, fetchImpl, reason) => {
    await expect(verify({ fetchImpl })).resolves.toMatchObject({ proven: false, reason });
  });

  it('falls back instead of throwing when GitHub proof lookup fails', async () => {
    await expect(verify({
      fetchImpl: async () => response({}, false, 503),
    })).resolves.toMatchObject({ proven: false });
  });

  it('records a Ready proof status against the exact candidate SHA', async () => {
    let request: { url?: string; options?: Record<string, unknown> } = {};
    const fetchImpl = async (url: string, options: Record<string, unknown>) => {
      request = { url, options };
      return response({ id: 1 });
    };
    await expect(recordReadyProof({
      repository: 'owner/repo',
      token: 'token',
      headSha: candidateSha,
      runId: '230',
      serverUrl: 'https://github.example',
      fetchImpl,
    })).resolves.toMatchObject({ context: READY_STATUS_CONTEXT });
    expect(request.url).toBe(`https://api.github.com/repos/owner/repo/statuses/${candidateSha}`);
    expect(request.options?.method).toBe('POST');
    expect(JSON.parse(String(request.options?.body))).toMatchObject({
      state: 'success',
      context: READY_STATUS_CONTEXT,
      target_url: 'https://github.example/owner/repo/actions/runs/230',
    });
  });
});
