const required = 'Brim preview / Neon'
const attemptPrefix = 'Brim preview attempt / '
const nativeContext = 'Vercel – brimcodejam2026'
const dashboard = 'https://vercel.com/sunnys-projects-538942c4/brimcodejam2026/'

async function probe(url, core) {
  const preview = new URL(url)
  if (preview.origin !== `https://${preview.hostname}` ||
      !/^brimcodejam2026-[a-z0-9-]+-sunnys-projects-538942c4\.vercel\.app$/.test(preview.hostname)) {
    throw new Error('Unexpected preview URL')
  }
  const token = await core.getIDToken('brim-preview-health')
  core.setSecret(token)
  const response = await fetch(new URL('/api/health', preview), {
    headers: { 'x-vercel-trusted-oidc-idp-token': token },
    redirect: 'manual', signal: AbortSignal.timeout(45000)
  })
  if (response.status !== 200) throw new Error(`Health endpoint returned HTTP ${response.status}`)
  const result = await response.json()
  if (result.ok !== true || result.database !== 'up') throw new Error('Unexpected health response')
}

async function unrelatedToBrim(github, repo, sha) {
  const { data } = await github.rest.repos.compareCommitsWithBasehead({
    ...repo, basehead: `main...${sha}`, per_page: 1
  })
  // Read top-level Git trees, so GitHub's changed-file limits cannot hide a Brim change.
  async function inputs(treeSha) {
    const { data: tree } = await github.rest.git.getTree({ ...repo, tree_sha: treeSha })
    if (tree.truncated) throw new Error('Incomplete Git tree')
    return tree.tree.filter(entry => entry.path !== 'Not_Brim' && !entry.path.endsWith('.md'))
      .map(entry => [entry.path, entry.mode, entry.sha])
  }
  const head = await github.rest.git.getCommit({ ...repo, commit_sha: sha })
  const [baseInputs, headInputs] = await Promise.all([
    inputs(data.merge_base_commit.commit.tree.sha), inputs(head.data.tree.sha)
  ])
  return JSON.stringify(baseInputs) === JSON.stringify(headInputs)
}

module.exports = async function reviewPreview({ github, context, core }) {
  const { repo, payload } = context
  const dispatch = payload.client_payload
  const sha = dispatch?.git.sha || payload.sha
  const runUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  const publish = (name, state, description) => github.rest.repos.createCommitStatus({
    ...repo, sha, context: name, state, description, target_url: runUrl
  })
  let probeError
  if (dispatch) {
    const id = dispatch.id?.replace(/^dpl_/, '')
    let state = 'failure'
    let description = 'Vercel reported a preview deployment failure'
    try {
      if (payload.action === 'vercel.deployment.success') {
        if (!id) throw new Error('Vercel omitted the deployment ID')
        await probe(dispatch.url, core)
        state = 'success'
        description = 'The deployed app can read the invoice schema'
      } else if (payload.action === 'vercel.deployment.skipped') {
        const unrelated = await unrelatedToBrim(github, repo, sha)
        state = unrelated ? 'success' : 'failure'
        description = unrelated ? 'No Brim changes in this PR' : 'Brim changes need a verified preview'
      }
    } catch (error) {
      probeError = error
      description = 'Preview verification failed'
    }
    // Some skipped and failed dispatches omit an ID. They cannot verify a real deployment.
    if (id) await publish(attemptPrefix + id, state, description)
    if (!id || payload.action === 'vercel.deployment.skipped') {
      await publish(attemptPrefix + 'no deployment', state, description)
    }
  }

  const statuses = await github.paginate(github.rest.repos.listCommitStatusesForRef, {
    ...repo, ref: sha, per_page: 100
  })
  const ours = statuses.filter(s => s.creator?.login === 'github-actions[bot]')
  const attempts = ours.filter(s => s.context.startsWith(attemptPrefix))
  if (!attempts.length) return // A native status can arrive before the first preview dispatch.

  // A terminal update for an old deployment can arrive last. Rank deployments by
  // their first native status, then use the newest state for that particular ID.
  const deployments = new Map()
  for (const status of statuses.filter(s => s.creator?.login === 'vercel[bot]' &&
      s.context === nativeContext && s.target_url?.startsWith(dashboard)).sort((a, b) => a.id - b.id)) {
    const id = status.target_url.slice(dashboard.length)
    if (/^[a-zA-Z0-9]+$/.test(id)) deployments.set(id, status)
  }
  const current = Array.from(deployments.keys()).at(-1)
  const native = deployments.get(current)
  const attempt = attempts.find(s => s.context === attemptPrefix + current)
  const unbound = attempts.find(s => s.context === attemptPrefix + 'no deployment')
  let state = 'pending'
  let description = 'Waiting for the current Brim preview'
  if (native?.state === 'error' || native?.state === 'failure') {
    state = 'failure'
    description = 'The current Brim deployment failed'
  } else if (native?.state === 'success' && attempt) {
    state = attempt.state
    description = attempt.description
  } else if (unbound && (!native || (native.state === 'success' && /skip/i.test(native.description)))) {
    state = unbound.state
    description = unbound.description
  }
  const last = ours.find(s => s.context === required)
  if (last?.state !== state || last.description !== description) {
    await publish(required, state, description)
  }
  if (probeError) throw probeError
}
