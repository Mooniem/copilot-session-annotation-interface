import { useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import './App.css'
import { parseSession } from './parseSession'
import type {
  BlockKind,
  ParsedSession,
  SessionBlock,
} from './parseSession'

const categories = [
  'Helpful',
  'Not helpful',
  'Other',
] as const
const legacyCategories = ['Incorrect', 'Confusing', 'Interesting strategy']

type Category = (typeof categories)[number]

type ExportedEvent = {
  blockId: string
  title: string
  kind: BlockKind
  elapsed: string
  markdown: string
}

type AnnotationContext = {
  annotatedEvent: ExportedEvent
  copilotGeneratedText: string | null
  userBefore: ExportedEvent | null
  userAfter: ExportedEvent | null
}

type Annotation = {
  id: string
  blockId: string
  blockTitle: string
  elapsed: string
  category: Category
  comment: string
  createdAt: string
  context?: AnnotationContext
}

type LoadedDocument = {
  id: string
  filename: string
  size: number
  session: ParsedSession
}

const kindLabels: Record<BlockKind, string> = {
  user: 'User',
  copilot: 'Copilot',
  reasoning: 'Reasoning',
  tool: 'Tools',
  info: 'Info',
}

async function fingerprint(source: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(source),
  )
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function annotationStorageKey(documentId: string) {
  return `copilot-log-annotations:${documentId}`
}

function toExportedEvent(block: SessionBlock): ExportedEvent {
  return {
    blockId: block.id,
    title: block.title,
    kind: block.kind,
    elapsed: block.elapsed,
    markdown: block.markdown,
  }
}

function getAnnotationContext(
  blocks: SessionBlock[],
  blockId: string,
): AnnotationContext | null {
  const annotatedIndex = blocks.findIndex((block) => block.id === blockId)
  if (annotatedIndex === -1) return null

  const annotatedBlock = blocks[annotatedIndex]
  const userBefore = blocks
    .slice(0, annotatedIndex)
    .findLast((block) => block.kind === 'user')
  const userAfter = blocks
    .slice(annotatedIndex + 1)
    .find((block) => block.kind === 'user')

  return {
    annotatedEvent: toExportedEvent(annotatedBlock),
    copilotGeneratedText:
      annotatedBlock.kind === 'copilot' ? annotatedBlock.markdown : null,
    userBefore: userBefore ? toExportedEvent(userBefore) : null,
    userAfter: userAfter ? toExportedEvent(userAfter) : null,
  }
}

function normalizeAnnotation(value: unknown): Annotation | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>

  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.blockId !== 'string' ||
    typeof candidate.blockTitle !== 'string' ||
    typeof candidate.elapsed !== 'string' ||
    typeof candidate.category !== 'string' ||
    typeof candidate.comment !== 'string' ||
    typeof candidate.createdAt !== 'string'
  ) {
    return null
  }

  const category = categories.find((item) => item === candidate.category)
  const migratedCategory =
    category ??
    (legacyCategories.includes(candidate.category) ? 'Other' : undefined)
  if (!migratedCategory) return null

  return {
    id: candidate.id,
    blockId: candidate.blockId,
    blockTitle: candidate.blockTitle,
    elapsed: candidate.elapsed,
    category: migratedCategory,
    comment: candidate.comment,
    createdAt: candidate.createdAt,
  }
}

function loadAnnotations(documentId: string): Annotation[] {
  const saved = localStorage.getItem(annotationStorageKey(documentId))
  if (!saved) return []

  const parsed: unknown = JSON.parse(saved)
  if (!Array.isArray(parsed)) {
    throw new Error('Saved annotation data has an invalid format.')
  }
  const normalized = parsed.map(normalizeAnnotation)
  if (normalized.some((annotation) => annotation === null)) {
    throw new Error('Saved annotation data has an invalid format.')
  }
  return normalized.filter(
    (annotation): annotation is Annotation => annotation !== null,
  )
}

function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, rehypeSanitize]}
    >
      {children}
    </ReactMarkdown>
  )
}

function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [loadedDocument, setLoadedDocument] =
    useState<LoadedDocument | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [category, setCategory] = useState<Category>('Helpful')
  const [comment, setComment] = useState('')
  const [filter, setFilter] = useState<BlockKind | 'all'>('all')
  const [search, setSearch] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState('')

  const selectedBlock =
    loadedDocument?.session.blocks.find(
      (block) => block.id === selectedBlockId,
    ) ?? null

  const annotationCounts = useMemo(
    () =>
      annotations.reduce<Record<string, number>>((counts, annotation) => {
        counts[annotation.blockId] = (counts[annotation.blockId] ?? 0) + 1
        return counts
      }, {}),
    [annotations],
  )

  const visibleBlocks = useMemo(() => {
    if (!loadedDocument) return []
    const query = search.trim().toLowerCase()

    return loadedDocument.session.blocks.filter(
      (block) =>
        (filter === 'all' || block.kind === filter) &&
        (!query ||
          block.title.toLowerCase().includes(query) ||
          block.markdown.toLowerCase().includes(query)),
    )
  }, [loadedDocument, filter, search])

  async function importFile(file: File) {
    setError('')

    if (!file.name.toLowerCase().endsWith('.md')) {
      setError('Choose a Markdown (.md) file exported with /share.')
      return
    }

    try {
      const source = await file.text()
      const id = await fingerprint(source)
      const session = parseSession(source)
      const savedAnnotations = loadAnnotations(id)

      setLoadedDocument({
        id,
        filename: file.name,
        size: file.size,
        session,
      })
      setAnnotations(savedAnnotations)
      setSelectedBlockId(session.blocks[0]?.id ?? null)
      setFilter('all')
      setSearch('')
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : 'The file could not be read.'
      setError(`Could not open this log: ${message}`)
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) void importFile(file)
  }

  function selectBlock(block: SessionBlock) {
    setSelectedBlockId(block.id)
    setComment('')
    setError('')
  }

  function saveAnnotation() {
    if (!loadedDocument || !selectedBlock) return
    if (!comment.trim()) {
      setError('Add a comment before saving the annotation.')
      return
    }

    const next: Annotation[] = [
      ...annotations,
      {
        id: crypto.randomUUID(),
        blockId: selectedBlock.id,
        blockTitle: selectedBlock.title,
        elapsed: selectedBlock.elapsed,
        category,
        comment: comment.trim(),
        createdAt: new Date().toISOString(),
        context:
          getAnnotationContext(
            loadedDocument.session.blocks,
            selectedBlock.id,
          ) ?? undefined,
      },
    ]
    localStorage.setItem(
      annotationStorageKey(loadedDocument.id),
      JSON.stringify(next),
    )
    setAnnotations(next)
    setComment('')
    setError('')
  }

  function deleteAnnotation(annotationId: string) {
    if (!loadedDocument) return
    const next = annotations.filter(
      (annotation) => annotation.id !== annotationId,
    )
    localStorage.setItem(
      annotationStorageKey(loadedDocument.id),
      JSON.stringify(next),
    )
    setAnnotations(next)
  }

  function exportAnnotations() {
    if (!loadedDocument) return

    const exportedAnnotations = annotations.map((annotation) => ({
      ...annotation,
      context:
        annotation.context ??
        getAnnotationContext(
          loadedDocument.session.blocks,
          annotation.blockId,
        ),
    }))
    const payload = {
      schemaVersion: 2,
      document: {
        filename: loadedDocument.filename,
        sha256: loadedDocument.id,
        size: loadedDocument.size,
        sessionId: loadedDocument.session.sessionId,
        title: loadedDocument.session.title,
      },
      exportedAt: new Date().toISOString(),
      annotations: exportedAnnotations,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = window.document.createElement('a')
    link.href = url
    link.download = `${loadedDocument.filename.replace(/\.md$/i, '')}-annotations.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  function clearDocument() {
    setLoadedDocument(null)
    setAnnotations([])
    setSelectedBlockId(null)
    setError('')
  }

  if (!loadedDocument) {
    return (
      <main className="welcome">
        <section className="welcome-card">
          <div className="brand-mark" aria-hidden="true">
            ✦
          </div>
          <p className="eyebrow">Research annotation tool</p>
          <h1>Annotate a Copilot session</h1>
          <p className="welcome-copy">
            Import the Markdown file created by <code>/share</code>. Your log
            and annotations stay in this browser.
          </p>
          <div
            className={`drop-zone ${isDragging ? 'is-dragging' : ''}`}
            onDragEnter={() => setIsDragging(true)}
            onDragLeave={() => setIsDragging(false)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            <span className="upload-icon" aria-hidden="true">
              ↑
            </span>
            <strong>Drop a Markdown log here</strong>
            <span>or</span>
            <button type="button" onClick={() => inputRef.current?.click()}>
              Choose a file
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".md,text/markdown"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void importFile(file)
              }}
            />
          </div>
          {error && <p className="error-message">{error}</p>}
        </section>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark small" aria-hidden="true">
            ✦
          </span>
          <div>
            <strong>Session notes</strong>
            <span>{loadedDocument.filename}</span>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="save-status">
            <span className="status-dot" />
            Saved locally
          </span>
          <button
            className="secondary-button"
            type="button"
            onClick={clearDocument}
          >
            Open another
          </button>
          <button type="button" onClick={exportAnnotations}>
            Export annotations
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="outline-panel">
          <div className="outline-heading">
            <p className="eyebrow">Session outline</p>
            <h2>{loadedDocument.session.title}</h2>
            <span>
              {loadedDocument.session.blocks.length} events ·{' '}
              {annotations.length} annotations
            </span>
          </div>
          <input
            className="search-input"
            type="search"
            placeholder="Search the log"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="filter-list" aria-label="Filter events">
            {(
              ['all', 'user', 'copilot', 'tool', 'reasoning', 'info'] as const
            ).map((kind) => (
              <button
                key={kind}
                type="button"
                className={filter === kind ? 'active' : ''}
                onClick={() => setFilter(kind)}
              >
                {kind === 'all' ? 'All events' : kindLabels[kind]}
              </button>
            ))}
          </div>
          <nav className="outline-list" aria-label="Session events">
            {visibleBlocks.map((block) => (
              <button
                key={block.id}
                type="button"
                className={selectedBlockId === block.id ? 'active' : ''}
                onClick={() => {
                  selectBlock(block)
                  window.document
                    .getElementById(block.id)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }}
              >
                <span className={`kind-dot ${block.kind}`} />
                <span className="outline-label">
                  <strong>{block.title}</strong>
                  <small>{block.elapsed || 'Document'}</small>
                </span>
                {!!annotationCounts[block.id] && (
                  <span className="count-badge">
                    {annotationCounts[block.id]}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </aside>

        <main className="document-panel">
          <div className="document-meta">
            <Markdown>{loadedDocument.session.metadataMarkdown}</Markdown>
          </div>
          <div className="event-list">
            {visibleBlocks.map((block) => (
              <article
                id={block.id}
                key={block.id}
                className={`event-card ${block.kind} ${
                  selectedBlockId === block.id ? 'selected' : ''
                }`}
                aria-current={
                  selectedBlockId === block.id ? 'true' : undefined
                }
                onClick={() => selectBlock(block)}
              >
                <header>
                  <div>
                    <span className={`kind-dot ${block.kind}`} />
                    <strong>{block.title}</strong>
                  </div>
                  <div className="event-status">
                    {selectedBlockId === block.id && (
                      <span className="selected-badge">Selected</span>
                    )}
                    <span>{block.elapsed}</span>
                  </div>
                </header>
                <div className="markdown-body">
                  <Markdown>{block.markdown}</Markdown>
                </div>
                {!!annotationCounts[block.id] && (
                  <div className="annotation-indicator">
                    {annotationCounts[block.id]} annotation
                    {annotationCounts[block.id] === 1 ? '' : 's'}
                  </div>
                )}
              </article>
            ))}
            {visibleBlocks.length === 0 && (
              <div className="empty-state">No events match this filter.</div>
            )}
          </div>
        </main>

        <aside className="annotation-panel">
          <div className="annotation-heading">
            <p className="eyebrow">Annotation</p>
            <h2>{selectedBlock?.title ?? 'Select an event'}</h2>
            {selectedBlock && <span>{selectedBlock.elapsed}</span>}
          </div>

          {selectedBlock ? (
            <>
              <fieldset>
                <legend>How would you label this?</legend>
                <div className="category-grid">
                  {categories.map((item) => (
                    <label
                      key={item}
                      className={category === item ? 'selected' : ''}
                    >
                      <input
                        type="radio"
                        name="category"
                        value={item}
                        checked={category === item}
                        onChange={() => setCategory(item)}
                      />
                      {item}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="comment-label" htmlFor="annotation-comment">
                Add details
              </label>
              <textarea
                id="annotation-comment"
                rows={6}
                placeholder="Describe what was useful, confusing, or worth revisiting..."
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
              {error && <p className="error-message compact">{error}</p>}
              <button
                className="save-button"
                type="button"
                onClick={saveAnnotation}
              >
                Save annotation
              </button>

              <div className="saved-annotations">
                <h3>
                  Saved here
                  <span>{annotationCounts[selectedBlock.id] ?? 0}</span>
                </h3>
                {annotations
                  .filter(
                    (annotation) => annotation.blockId === selectedBlock.id,
                  )
                  .map((annotation) => (
                    <div className="annotation-note" key={annotation.id}>
                      <div>
                        <span className="category-badge">
                          {annotation.category}
                        </span>
                        <button
                          type="button"
                          className="delete-button"
                          onClick={() => deleteAnnotation(annotation.id)}
                          aria-label="Delete annotation"
                        >
                          Delete
                        </button>
                      </div>
                      <p>{annotation.comment}</p>
                    </div>
                  ))}
              </div>
            </>
          ) : (
            <p className="panel-help">
              Choose an event from the session to add a note.
            </p>
          )}
        </aside>
      </div>
    </div>
  )
}

export default App
