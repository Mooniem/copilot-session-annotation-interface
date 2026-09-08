import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const blockPattern =
  /<sub>(?<elapsed>\d+(?:m \s*\d+s|s))<\/sub>\s*\r?\n\s*###\s+(?<role>User|Copilot)\s*\r?\n\s*(?<message>.*?)(?=\r?\n---\r?\n|(?![\s\S]))/gis

function escapeCsv(value) {
  const text = String(value).replaceAll('\r\n', '\n')
  return `"${text.replaceAll('"', '""')}"`
}

function elapsedSeconds(elapsed) {
  const minutesMatch = elapsed.match(/^(\d+)m\s*(\d+)s$/)
  if (minutesMatch) return Number(minutesMatch[1]) * 60 + Number(minutesMatch[2])

  return Number(elapsed.replace(/s$/, ''))
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

function parseTurns(source) {
  const rows = Array.from(source.matchAll(blockPattern), (match, index) => ({
    '#turn': index + 1,
    '#time': match.groups.elapsed.replace(/\s+/g, ' ').trim(),
    '#duration': '',
    '#user or copilot': match.groups.role.toLowerCase(),
    '#message': match.groups.message.trim(),
  }))

  for (let index = 0; index < rows.length - 1; index++) {
    const duration = elapsedSeconds(rows[index + 1]['#time']) - elapsedSeconds(rows[index]['#time'])
    rows[index]['#duration'] = formatDuration(duration)
  }

  return rows
}

function toCsv(rows) {
  const columns = ['#turn', '#time', '#duration', '#user or copilot', '#message']
  const lines = [columns.map(escapeCsv).join(',')]

  for (const row of rows) {
    lines.push(columns.map((column) => escapeCsv(row[column])).join(','))
  }

  return `${lines.join('\n')}\n`
}

async function collectMarkdownFiles(inputPath) {
  const inputStat = await stat(inputPath)

  if (inputStat.isFile()) {
    return path.extname(inputPath).toLowerCase() === '.md' ? [inputPath] : []
  }

  if (!inputStat.isDirectory()) return []

  const entries = await readdir(inputPath, { withFileTypes: true })
  const nestedFiles = await Promise.all(
    entries
      .filter((entry) => entry.name !== 'node_modules' && entry.name !== '.git')
      .map((entry) => collectMarkdownFiles(path.join(inputPath, entry.name))),
  )

  return nestedFiles.flat()
}

function outputPathFor(inputPath) {
  const extension = path.extname(inputPath)
  return inputPath.slice(0, -extension.length) + '-turns.csv'
}

async function main() {
  const inputs = process.argv.slice(2)

  if (inputs.length === 0) {
    console.error('Usage: npm run export-turns -- <file-or-directory> [...]')
    process.exitCode = 1
    return
  }

  const files = (
    await Promise.all(inputs.map((input) => collectMarkdownFiles(path.resolve(input))))
  ).flat()
  const uniqueFiles = [...new Set(files)].sort()

  if (uniqueFiles.length === 0) {
    console.error('No Markdown files found.')
    process.exitCode = 1
    return
  }

  let exportedCount = 0

  for (const inputPath of uniqueFiles) {
    const source = await readFile(inputPath, 'utf8')
    const rows = parseTurns(source)

    if (rows.length === 0) {
      console.warn(`Skipped ${inputPath}: no User or Copilot turns found.`)
      continue
    }

    const outputPath = outputPathFor(inputPath)
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, toCsv(rows), 'utf8')
    console.log(`Exported ${rows.length} turns to ${outputPath}`)
    exportedCount++
  }

  if (exportedCount === 0) process.exitCode = 1
}

await main()