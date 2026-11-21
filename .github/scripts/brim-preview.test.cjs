const test = require('node:test')
const assert = require('node:assert/strict')
const reviewPreview = require('./brim-preview.cjs')

function scenario({ brimChanged = false } = {}) {
  const statuses = []
  function record(login, context, state, description, target_url) {
    statuses.unshift({ id: statuses.length + 1, creator: { login }, context, state, description, target_url })
  }
  const repos = {
    createCommitStatus: async s => record('github-actions[bot]', s.context, s.state, s.description, s.target_url),
    compareCommitsWithBasehead: async () => ({ data: { merge_base_commit: { commit: { tree: { sha: 'base' } } } } })
  }
  const git = {
    getCommit: async () => ({ data: { tree: { sha: 'head' } } }),
    getTree: async ({ tree_sha }) => ({ data: { tree: [
      { path: 'Brim', sha: brimChanged ? tree_sha : 'same' },
      { path: 'Not_Brim', sha: tree_sha }, { path: 'README.md', sha: tree_sha }
    ] } })
  }
  const github = { rest: { repos, git }, paginate: async () => statuses.slice() }
  const run = payload => reviewPreview({ github, context: { repo: {}, payload },
    core: { getIDToken: async () => 'test', setSecret() {} } })
  return {
    native(id, state, description = '') {
      record('vercel[bot]', 'Vercel – brimcodejam2026', state, description,
        'https://vercel.com/sunnys-projects-538942c4/brimcodejam2026/' + id)
      return run({ sha: 'head' })
    },
    dispatch(action, id) {
      return run({ action: 'vercel.deployment.' + action, client_payload: {
        git: { sha: 'head' }, id: id && 'dpl_' + id,
        url: 'https://brimcodejam2026-test-sunnys-projects-538942c4.vercel.app'
      } })
    },
    required: () => statuses.find(s => s.context === 'Brim preview / Neon')?.state
  }
}

test('older success cannot clear a later deployment failure, regardless of terminal event order', async t => {
  t.mock.method(global, 'fetch', async () => Response.json({ ok: true, database: 'up' }))
  const s = scenario()
  await s.native('older', 'pending')
  await s.native('newer', 'pending')
  await s.native('newer', 'failure')
  await s.dispatch('failed')
  await s.native('older', 'success')
  await s.dispatch('success', 'older')
  assert.equal(s.required(), 'failure')
})

test('a replacement waits for both its own health result and native success', async t => {
  t.mock.method(global, 'fetch', async () => Response.json({ ok: true, database: 'up' }))
  const s = scenario()
  await s.dispatch('success', 'first')
  await s.native('first', 'success')
  assert.equal(s.required(), 'success')
  await s.native('second', 'pending')
  assert.equal(s.required(), 'pending')
  await s.native('second', 'success')
  assert.equal(s.required(), 'pending')
  await s.dispatch('success', 'second')
  assert.equal(s.required(), 'success')
})

test('a failed probe stays failed when Vercel reports a successful build', async t => {
  t.mock.method(global, 'fetch', async () => new Response(null, { status: 503 }))
  const s = scenario()
  await assert.rejects(s.dispatch('success', 'first'), /503/)
  await s.native('first', 'success')
  assert.equal(s.required(), 'failure')
})

for (const brimChanged of [false, true]) {
  test('skip checks the entire branch diff (Brim changed: ' + brimChanged + ')', async () => {
    const s = scenario({ brimChanged })
    await s.dispatch('skipped')
    assert.equal(s.required(), brimChanged ? 'failure' : 'success')
    await s.native('actual', 'pending')
    await s.native('actual', 'success', 'Deployment has completed')
    assert.equal(s.required(), 'pending')
  })
}
