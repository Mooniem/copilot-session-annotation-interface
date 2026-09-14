import type { TextSpan } from './annotationTypes'

export function createTextSpan(
  blockId: string,
  markdown: string,
  selectedText: string,
): TextSpan | null {
  const text = selectedText.trim()
  if (!text) return null

  const first = markdown.indexOf(text)
  if (first === -1) return null
  if (markdown.indexOf(text, first + text.length) !== -1) return null

  return {
    blockId,
    start: first,
    end: first + text.length,
    text,
  }
}

export function isValidTextSpan(
  value: unknown,
  blockId: string,
  markdown: string,
): value is TextSpan {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (
    candidate.blockId !== blockId ||
    typeof candidate.start !== 'number' ||
    typeof candidate.end !== 'number' ||
    typeof candidate.text !== 'string' ||
    !Number.isInteger(candidate.start) ||
    !Number.isInteger(candidate.end) ||
    candidate.start < 0 ||
    candidate.end <= candidate.start ||
    candidate.end > markdown.length
  ) {
    return false
  }

  return markdown.slice(candidate.start, candidate.end) === candidate.text
}