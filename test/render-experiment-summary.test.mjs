import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderExperimentSummary, SUMMARY_DOCUMENTS } from '../scripts/render-experiment-summary.mjs'

function withSyntheticDocs(run) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-summary-render-')))
  const root = join(parent, 'repository')
  try {
    mkdirSync(join(root, 'docs'), { recursive: true })
    for (const name of SUMMARY_DOCUMENTS) {
      writeFileSync(join(root, name === 'README' ? 'README.md' : `docs/${name}.md`), '# Synthetic summary\n\n[Summary](docs/EXPERIMENT-SUMMARY.md#synthetic-summary)\n\n| Item | Value |\n| --- | --- |\n| Fixture | Synthetic |\n')
    }
    run({ root, parent, outputDirectory: join(root, 'scratch', 'experiment-summary') })
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
}

test('relocated summary generator renders synthetic docs into scratch without public assets or workstation paths', () => withSyntheticDocs(({ root }) => {
  const result = renderExperimentSummary({ root })
  assert.equal(result.outputDirectory, join(root, 'scratch', 'experiment-summary'))
  assert.equal(result.documents, 10)
  assert.equal(readdirSync(result.outputDirectory).length, 10)
  const html = readFileSync(join(result.outputDirectory, 'index.html'), 'utf8')
  assert.match(html, /<h1 id="synthetic-summary">Synthetic summary<\/h1>/)
  assert.match(html, /href="index.html#synthetic-summary"/)
  assert.match(html, /<table>/)
  assert.equal(existsSync(join(root, 'public')), false)
  writeFileSync(join(result.outputDirectory, 'index.html'), 'stale generated text'.repeat(1000))
  renderExperimentSummary({ root })
  assert.equal(readFileSync(join(result.outputDirectory, 'index.html'), 'utf8'), html)
}))

test('a scratch symlink to public is rejected before directories or reports are written', () => withSyntheticDocs(({ root }) => {
  const publicDirectory = join(root, 'public')
  mkdirSync(publicDirectory)
  const sentinel = join(publicDirectory, 'sentinel.txt')
  writeFileSync(sentinel, 'public sentinel remains unchanged')
  symlinkSync(publicDirectory, join(root, 'scratch'), 'dir')
  assert.throws(() => renderExperimentSummary({ root }), /output directory symlink/)
  assert.equal(readFileSync(sentinel, 'utf8'), 'public sentinel remains unchanged')
  assert.deepEqual(readdirSync(publicDirectory), ['sentinel.txt'])
}))

for (const target of ['index.html', 'README.html']) {
  test(`target ${target} symlink cannot overwrite an outside file or produce partial reports`, () => withSyntheticDocs(({ root, parent, outputDirectory }) => {
    mkdirSync(outputDirectory, { recursive: true })
    const sentinel = join(parent, 'outside-sentinel.txt')
    writeFileSync(sentinel, 'outside sentinel remains unchanged')
    symlinkSync(sentinel, join(outputDirectory, target))
    const existing = target === 'index.html' ? 'ARCHITECTURE.html' : 'index.html'
    writeFileSync(join(outputDirectory, existing), 'existing report remains unchanged')
    assert.throws(() => renderExperimentSummary({ root }), /output file symlink/)
    assert.equal(readFileSync(sentinel, 'utf8'), 'outside sentinel remains unchanged')
    assert.equal(readFileSync(join(outputDirectory, existing), 'utf8'), 'existing report remains unchanged')
    assert.deepEqual(readdirSync(outputDirectory).sort(), [target, existing].sort())
  }))
}

test('a non-directory output ancestor is rejected without changing it', () => withSyntheticDocs(({ root }) => {
  const scratch = join(root, 'scratch')
  writeFileSync(scratch, 'ancestor sentinel remains unchanged')
  assert.throws(() => renderExperimentSummary({ root }), /Output ancestor must be a directory/)
  assert.equal(readFileSync(scratch, 'utf8'), 'ancestor sentinel remains unchanged')
  assert.equal(existsSync(join(root, 'public')), false)
}))

test('a late non-regular target is rejected before an existing earlier report is overwritten', () => withSyntheticDocs(({ root, outputDirectory }) => {
  mkdirSync(join(outputDirectory, 'README.html'), { recursive: true })
  writeFileSync(join(outputDirectory, 'index.html'), 'existing report remains unchanged')
  assert.throws(() => renderExperimentSummary({ root }), /Output destination must be a regular file/)
  assert.equal(readFileSync(join(outputDirectory, 'index.html'), 'utf8'), 'existing report remains unchanged')
  assert.deepEqual(readdirSync(outputDirectory).sort(), ['README.html', 'index.html'])
}))
