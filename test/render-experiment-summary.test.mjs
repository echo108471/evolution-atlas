import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderExperimentSummary, SUMMARY_DOCUMENTS } from '../scripts/render-experiment-summary.mjs'

test('relocated summary generator renders synthetic docs into scratch without public assets or workstation paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-summary-render-'))
  try {
    mkdirSync(join(root, 'docs'))
    for (const name of SUMMARY_DOCUMENTS) {
      writeFileSync(join(root, name === 'README' ? 'README.md' : `docs/${name}.md`), '# Synthetic summary\n\n[Summary](docs/EXPERIMENT-SUMMARY.md#synthetic-summary)\n\n| Item | Value |\n| --- | --- |\n| Fixture | Synthetic |\n')
    }
    const result = renderExperimentSummary({ root })
    assert.equal(result.outputDirectory, join(root, 'scratch', 'experiment-summary'))
    assert.equal(result.documents, 10)
    assert.equal(readdirSync(result.outputDirectory).length, 10)
    const html = readFileSync(join(result.outputDirectory, 'index.html'), 'utf8')
    assert.match(html, /<h1 id="synthetic-summary">Synthetic summary<\/h1>/)
    assert.match(html, /href="index.html#synthetic-summary"/)
    assert.match(html, /<table>/)
    assert.equal(existsSync(join(root, 'public')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
