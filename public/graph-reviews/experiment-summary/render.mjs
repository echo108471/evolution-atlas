import { readFileSync, writeFileSync } from 'node:fs'
import { marked } from '/Users/echo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/marked/lib/marked.esm.js'
const root = '/Users/echo/Projects/evolution-atlas'
const docs = ['EXPERIMENT-SUMMARY', 'ARCHITECTURE', 'ROADMAP', 'CAPABILITY-GRAPH', 'CAPABILITIES', 'CAPABILITY-INDUCTION', 'PER-COMMIT', 'EPOCHS', 'INTERPRETATION-FINDINGS']
for (const name of [...docs, 'README']) {
  const source = readFileSync(`${root}/${name === 'README' ? 'README.md' : `docs/${name}.md`}`, 'utf8')
  const body = marked.parse(source).replace(/href="(?:docs\/)?([A-Z-]+)\.md(#[^"]*)?"/g, (_, n, hash = '') => `href="${n === 'EXPERIMENT-SUMMARY' ? 'index' : n}.html${hash}"`).replace(/<h([1-6])>(.*?)<\/h\1>/g, (_, level, text) => `<h${level} id="${text.replace(/<[^>]*>/g, '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-')}">${text}</h${level}>`)
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title><style>body{font:16px/1.65 system-ui;color:#23313b;background:#f6f8fa;margin:0;padding:24px}main{max-width:1120px;margin:auto}h1{font-size:32px}h2{margin-top:36px}a{color:#175db0}table{border-collapse:collapse;width:100%;font-size:14px;background:white}th,td{text-align:left;vertical-align:top;padding:12px;border:1px solid #d5dce2}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#e8edf1;padding:14px}code{overflow-wrap:anywhere}blockquote{border-left:4px solid #adb9c5;padding-left:18px}@media(max-width:700px){body{padding:12px}table{font-size:12px}th,td{padding:7px}}</style><main>${body}</main></html>`
  writeFileSync(`${root}/public/graph-reviews/experiment-summary/${name === 'EXPERIMENT-SUMMARY' ? 'index' : name}.html`, html)
}
