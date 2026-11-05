import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE_ROOTS = ['packages/settings/src', 'packages/userscript/src']
// eslint-disable-next-line no-misleading-character-class
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u

function collectFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectFiles(path))
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.vue')) {
      files.push(path)
    }
  }
  return files
}

describe('icon policy', () => {
  it('does not use emoji as icons anywhere in the source', () => {
    const offenders: string[] = []
    for (const root of SOURCE_ROOTS) {
      for (const file of collectFiles(root)) {
        const content = readFileSync(file, 'utf8')
        if (EMOJI.test(content)) offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })
})
