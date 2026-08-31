export type BlockKind = 'user' | 'copilot' | 'reasoning' | 'tool' | 'info'

export type SessionBlock = {
  id: string
  elapsed: string
  title: string
  kind: BlockKind
  markdown: string
}

export type ParsedSession = {
  title: string
  sessionId?: string
  metadataMarkdown: string
  blocks: SessionBlock[]
}

function classifyBlock(title: string): BlockKind {
  const normalized = title.toLowerCase()

  if (normalized === 'user') return 'user'
  if (normalized === 'copilot') return 'copilot'
  if (normalized === 'reasoning') return 'reasoning'
  if (normalized === 'info') return 'info'
  return 'tool'
}

export function parseSession(source: string): ParsedSession {
  const normalized = source.replace(/\r\n/g, '\n')
  const chunks = normalized.split(/\n---\n(?=\n?<sub>)/)
  const metadataMarkdown = chunks.shift()?.trim() ?? ''
  const title =
    metadataMarkdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? 'Copilot session'
  const sessionId = metadataMarkdown.match(
    /\*\*Session ID:\*\*\s*`([^`]+)`/,
  )?.[1]

  const blocks = chunks.flatMap((chunk, index) => {
    const match = chunk.match(
      /^\s*<sub>(.*?)<\/sub>\s*\n\s*###\s+(.+?)\n+([\s\S]*?)\s*$/,
    )

    if (!match) return []

    const titleText = match[2].replaceAll('`', '').trim()
    return [
      {
        id: `block-${index + 1}`,
        elapsed: match[1].trim(),
        title: titleText,
        kind: classifyBlock(titleText.replace(/\s+—\s+Failed$/, '')),
        markdown: match[3].trim(),
      },
    ]
  })

  if (blocks.length === 0 && normalized.trim()) {
    blocks.push({
      id: 'block-1',
      elapsed: '',
      title: 'Document',
      kind: 'info',
      markdown: normalized,
    })
  }

  return { title, sessionId, metadataMarkdown, blocks }
}
