#!/usr/bin/env node
import { readFileSync } from 'node:fs'

const version = (process.argv[2] ?? '').replace(/^v/, '').trim()
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Usage: node scripts/extract-release-notes.mjs <version>`)
  console.error(`Example: node scripts/extract-release-notes.mjs 0.2.10`)
  process.exit(1)
}

const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
const lines = changelog.split(/\r?\n/)
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const heading = new RegExp(`^##\\s+\\[?${escaped}\\]?(?:\\s|$)`)
const start = lines.findIndex((line) => heading.test(line))

if (start < 0) {
  console.error(`No CHANGELOG.md section found for version ${version}.`)
  console.error('Add a `## [' + version + '] - YYYY-MM-DD` section before tagging.')
  process.exit(1)
}

let end = start + 1
while (end < lines.length && !/^##\s+/.test(lines[end])) end += 1

const body = lines
  .slice(start + 1, end)
  .join('\n')
  .trim()
if (!body) {
  console.error(`CHANGELOG.md section for ${version} is empty.`)
  process.exit(1)
}

process.stdout.write(`${body}\n`)
