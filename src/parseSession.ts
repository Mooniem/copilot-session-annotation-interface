export type BlockKind = 'user' | 'copilot' | 'reasoning' | 'tool' | 'info'

export type SessionBlock = {
  id: string
  elapsed: string
  title: string
  kind: BlockKind
  markdown: string
}

export type StageSummary = {
  stage: string
  durationSeconds: number
  turns: number
  userTurns: number
  copilotTurns: number
}

export type ParsedSession = {
  title: string
  sessionId?: string
  metadataMarkdown: string
  blocks: SessionBlock[]
  stageSummary: StageSummary[]
}

const activeStagePattern = /🔵\s*([^·\r\n]+)/

function classifyBlock(title: string): BlockKind {
  const normalized = title.toLowerCase()

  if (normalized === 'user') return 'user'
  if (normalized === 'copilot') return 'copilot'
  if (normalized === 'reasoning') return 'reasoning'
  if (normalized === 'info') return 'info'
  return 'tool'
}

function elapsedSeconds(elapsed: string) {
  const match = elapsed.match(/^(?:(\d+)m\s*)?(\d+)s$/)
  if (!match) return 0
  return Number(match[1] ?? 0) * 60 + Number(match[2])
}

function summarizeStages(blocks: SessionBlock[]): StageSummary[] {
  const turns = blocks.filter(
    (block) => block.kind === 'user' || block.kind === 'copilot',
  )
  const detectedStages = turns.map(
    (turn) => turn.markdown.match(activeStagePattern)?.[1].trim() ?? '',
  )
  const firstStage = detectedStages.find(Boolean)
  if (!firstStage) return []

  const summaries = new Map<string, StageSummary>()
  let currentStage = firstStage

  turns.forEach((turn, index) => {
    currentStage = detectedStages[index] || currentStage
    const summary = summaries.get(currentStage) ?? {
      stage: currentStage,
      durationSeconds: 0,
      turns: 0,
      userTurns: 0,
      copilotTurns: 0,
    }
    const nextTurn = turns[index + 1]
    if (nextTurn) {
      summary.durationSeconds += Math.max(
        0,
        elapsedSeconds(nextTurn.elapsed) - elapsedSeconds(turn.elapsed),
      )
    }
    summary.turns += 1
    if (turn.kind === 'user') summary.userTurns += 1
    if (turn.kind === 'copilot') summary.copilotTurns += 1
    summaries.set(currentStage, summary)
  })

  return Array.from(summaries.values())
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

  return {
    title,
    sessionId,
    metadataMarkdown,
    blocks,
    stageSummary: summarizeStages(blocks),
  }
}
