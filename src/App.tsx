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

const defaultCategory = 'Open coding'

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
}

type Annotation = {
  id: string
  blockId: string
  blockTitle: string
  elapsed: string
  category: string
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

function categoryStorageKey(documentId: string) {
  return `copilot-log-categories:${documentId}`
}

function filenameSafe(value: string) {
  return Array.from(value.trim(), (character) =>
    character.charCodeAt(0) < 32 ? '_' : character,
  )
    .join('')
    .replace(/[<>:"/\\|?*]/g, '_')
}

function localDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`
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

  return {
    annotatedEvent: toExportedEvent(annotatedBlock),
    copilotGeneratedText:
      annotatedBlock.kind === 'copilot' ? annotatedBlock.markdown : null,
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

  const category = candidate.category.trim()
  if (!category) return null

  return {
    id: candidate.id,
    blockId: candidate.blockId,
    blockTitle: candidate.blockTitle,
    elapsed: candidate.elapsed,
    category,
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

function loadCategories(documentId: string, annotations: Annotation[]) {
  const saved = localStorage.getItem(categoryStorageKey(documentId))
  const parsed: unknown = saved ? JSON.parse(saved) : []
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error('Saved category data has an invalid format.')
  }

  return Array.from(
    new Set([
      defaultCategory,
      ...parsed.map((item) => item.trim()).filter(Boolean),
      ...annotations.map((annotation) => annotation.category),
    ]),
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
  const [categories, setCategories] = useState([defaultCategory])
  const [selectedCategory, setSelectedCategory] = useState(defaultCategory)
  const [newCategory, setNewCategory] = useState('')
  const [comment, setComment] = useState('')
  const [annotatorName, setAnnotatorName] = useState('')
  const [filter, setFilter] = useState<BlockKind | 'all'>('all')
  const [conversationOnly, setConversationOnly] = useState(false)
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
        (!conversationOnly ||
          block.kind === 'user' ||
          block.kind === 'copilot') &&
        (filter === 'all' || block.kind === filter) &&
        (!query ||
          block.title.toLowerCase().includes(query) ||
          block.markdown.toLowerCase().includes(query)),
    )
  }, [loadedDocument, filter, conversationOnly, search])

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
      const savedCategories = loadCategories(id, savedAnnotations)

      setLoadedDocument({
        id,
        filename: file.name,
        size: file.size,
        session,
      })
      setAnnotations(savedAnnotations)
      setCategories(savedCategories)
      setSelectedCategory(savedCategories[0])
      setNewCategory('')
      setSelectedBlockId(session.blocks[0]?.id ?? null)
      setFilter('all')
      setConversationOnly(false)
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

  function addCategory() {
    if (!loadedDocument) return
    const category = newCategory.trim()
    if (!category) return

    const existingCategory = categories.find(
      (item) => item.toLowerCase() === category.toLowerCase(),
    )
    if (existingCategory) {
      setSelectedCategory(existingCategory)
      setNewCategory('')
      return
    }

    const nextCategories = [...categories, category]
    localStorage.setItem(
      categoryStorageKey(loadedDocument.id),
      JSON.stringify(nextCategories),
    )
    setCategories(nextCategories)
    setSelectedCategory(category)
    setNewCategory('')
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
        category: selectedCategory,
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
    if (!loadedDocument || !annotatorName.trim()) return

    const exportedAt = new Date()
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
      annotator: annotatorName.trim(),
      exportedAt: exportedAt.toISOString(),
      categories,
      annotations: exportedAnnotations,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = window.document.createElement('a')
    link.href = url
    const sourceName = loadedDocument.filename.replace(/\.md$/i, '')
    link.download = `${filenameSafe(sourceName)}-${filenameSafe(annotatorName)}-${localDate(exportedAt)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  function clearDocument() {
    setLoadedDocument(null)
    setAnnotations([])
    setSelectedBlockId(null)
    setCategories([defaultCategory])
    setSelectedCategory(defaultCategory)
    setNewCategory('')
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

  const stageSummary = loadedDocument.session.stageSummary
  const stageTotals = stageSummary.reduce(
    (totals, stage) => ({
      durationSeconds: totals.durationSeconds + stage.durationSeconds,
      turns: totals.turns + stage.turns,
      userTurns: totals.userTurns + stage.userTurns,
      copilotTurns: totals.copilotTurns + stage.copilotTurns,
    }),
    { durationSeconds: 0, turns: 0, userTurns: 0, copilotTurns: 0 },
  )

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
          <label className="annotator-field">
            <span>Annotator</span>
            <input
              type="text"
              value={annotatorName}
              placeholder="Enter name"
              onChange={(event) => setAnnotatorName(event.target.value)}
            />
          </label>
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
          <button
            type="button"
            onClick={exportAnnotations}
            disabled={!annotatorName.trim()}
            title={
              annotatorName.trim()
                ? 'Export annotations'
                : 'Enter an annotator name before exporting'
            }
          >
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
          <label className="conversation-toggle">
            <input
              type="checkbox"
              checked={conversationOnly}
              onChange={(event) => {
                const checked = event.target.checked
                setConversationOnly(checked)
                if (
                  checked &&
                  filter !== 'all' &&
                  filter !== 'user' &&
                  filter !== 'copilot'
                ) {
                  setFilter('all')
                }
              }}
            />
            <span>
              <strong>Conversation only</strong>
              <small>Show User and Copilot turns</small>
            </span>
          </label>
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
          {stageSummary.length > 0 && (
            <section className="stage-summary" aria-labelledby="summary-title">
              <div className="stage-summary-heading">
                <div>
                  <p className="eyebrow">Session overview</p>
                  <h2 id="summary-title">Stage summary</h2>
                </div>
                <span>{stageTotals.turns} conversation turns</span>
              </div>
              <div className="stage-summary-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Stage</th>
                      <th scope="col">Duration</th>
                      <th scope="col">Turns</th>
                      <th scope="col">User</th>
                      <th scope="col">Copilot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stageSummary.map((stage) => (
                      <tr key={stage.stage}>
                        <th scope="row">{stage.stage}</th>
                        <td>{formatDuration(stage.durationSeconds)}</td>
                        <td>{stage.turns}</td>
                        <td>{stage.userTurns}</td>
                        <td>{stage.copilotTurns}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">Total</th>
                      <td>{formatDuration(stageTotals.durationSeconds)}</td>
                      <td>{stageTotals.turns}</td>
                      <td>{stageTotals.userTurns}</td>
                      <td>{stageTotals.copilotTurns}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          )}
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
              <label className="category-label" htmlFor="annotation-category">
                Category
              </label>
              <select
                id="annotation-category"
                value={selectedCategory}
                onChange={(event) => setSelectedCategory(event.target.value)}
              >
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              <form
                className="category-creator"
                onSubmit={(event) => {
                  event.preventDefault()
                  addCategory()
                }}
              >
                <input
                  type="text"
                  value={newCategory}
                  placeholder="New category"
                  aria-label="New category"
                  onChange={(event) => setNewCategory(event.target.value)}
                />
                <button type="submit" disabled={!newCategory.trim()}>
                  Add
                </button>
              </form>
              <label className="comment-label" htmlFor="annotation-comment">
                Coding note
              </label>
              <textarea
                id="annotation-comment"
                rows={6}
                placeholder="Enter a coding note..."
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
