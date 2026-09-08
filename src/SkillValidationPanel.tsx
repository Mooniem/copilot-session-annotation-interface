import { useEffect, useMemo, useRef, useState } from 'react'
import type { RubricDefinition, RubricResponse } from './annotationTypes'
import type { SessionBlock } from './parseSession'

type Props = {
  rubric: RubricDefinition | null
  rubricFilename: string
  responses: RubricResponse[]
  blocks: SessionBlock[]
  error: string
  onImport: (file: File) => void
  onUpdateResponse: (
    criterionId: string,
    update: Partial<Pick<RubricResponse, 'selectedOptionValue' | 'note' | 'evidenceBlockIds'>>,
  ) => void
}

type EvidenceDialogProps = {
  blocks: SessionBlock[]
  selectedBlockIds: string[]
  onConfirm: (blockIds: string[]) => void
  onClose: () => void
}

function preview(markdown: string) {
  return markdown
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_>#]/g, ' ')
    .replaceAll('[', ' ')
    .replaceAll(']', ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
}

function EvidenceDialog({
  blocks,
  selectedBlockIds,
  onConfirm,
  onClose,
}: EvidenceDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [draftIds, setDraftIds] = useState<string[]>(selectedBlockIds)
  const [search, setSearch] = useState('')
  const [conversationOnly, setConversationOnly] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    dialog.showModal()
    return () => dialog.close()
  }, [])

  const visibleBlocks = useMemo(() => {
    const query = search.trim().toLowerCase()
    return blocks.filter(
      (block) =>
        (!conversationOnly || block.kind === 'user' || block.kind === 'copilot') &&
        (!query ||
          block.title.toLowerCase().includes(query) ||
          block.markdown.toLowerCase().includes(query)),
    )
  }, [blocks, conversationOnly, search])

  return (
    <dialog
      ref={dialogRef}
      className="evidence-dialog"
      aria-labelledby="evidence-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="evidence-dialog-heading">
        <div>
          <p className="eyebrow">Criterion evidence</p>
          <h2 id="evidence-title">Select transcript blocks</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close evidence picker">
          ×
        </button>
      </div>
      <div className="evidence-controls">
        <input
          type="search"
          placeholder="Search transcript"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={conversationOnly}
            onChange={(event) => setConversationOnly(event.target.checked)}
          />
          Conversation only
        </label>
      </div>
      <div className="evidence-list">
        {visibleBlocks.map((block) => {
          const checked = draftIds.includes(block.id)
          return (
            <label key={block.id} className="evidence-option">
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  setDraftIds((current) =>
                    checked
                      ? current.filter((id) => id !== block.id)
                      : [...current, block.id],
                  )
                }
              />
              <span className={`kind-dot ${block.kind}`} />
              <span>
                <strong>{block.title}</strong>
                <small>{block.elapsed || 'Document'}</small>
                <span>{preview(block.markdown) || 'No text content'}</span>
              </span>
            </label>
          )
        })}
        {visibleBlocks.length === 0 && <p className="empty-state">No blocks match this search.</p>}
      </div>
      <div className="evidence-actions">
        <span>{draftIds.length} selected</span>
        <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
        <button type="button" onClick={() => onConfirm(draftIds)}>Use evidence</button>
      </div>
    </dialog>
  )
}

export function SkillValidationPanel({
  rubric,
  rubricFilename,
  responses,
  blocks,
  error,
  onImport,
  onUpdateResponse,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [evidenceCriterionId, setEvidenceCriterionId] = useState<string | null>(null)
  const responseByCriterion = useMemo(
    () => new Map(responses.map((response) => [response.criterionId, response])),
    [responses],
  )
  const evidenceResponse = evidenceCriterionId
    ? responseByCriterion.get(evidenceCriterionId)
    : undefined
  const answeredCount = rubric?.criteria.filter(
    (criterion) => responseByCriterion.get(criterion.id)?.selectedOptionValue,
  ).length ?? 0

  return (
    <aside className="annotation-panel skill-validation-panel">
      {evidenceCriterionId && (
        <EvidenceDialog
          blocks={blocks}
          selectedBlockIds={evidenceResponse?.evidenceBlockIds ?? []}
          onClose={() => setEvidenceCriterionId(null)}
          onConfirm={(blockIds) => {
            onUpdateResponse(evidenceCriterionId, { evidenceBlockIds: blockIds })
            setEvidenceCriterionId(null)
          }}
        />
      )}
      {!rubric ? (
        <div className="rubric-empty-state">
          <p className="eyebrow">Skill Validation Check</p>
          <h2>Import a session rubric</h2>
          <p>Use a JSON or normalized CSV rubric to evaluate this entire session.</p>
          <button type="button" onClick={() => inputRef.current?.click()}>Import rubric</button>
          <input
            ref={inputRef}
            type="file"
            accept=".json,.csv,application/json,text/csv"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) onImport(file)
              event.target.value = ''
            }}
          />
          <div className="template-links">
            <a href="./templates/skill-validation-rubric.json" download>JSON template</a>
            <a href="./templates/skill-validation-rubric.csv" download>CSV template</a>
          </div>
          {error && <p className="error-message compact">{error}</p>}
        </div>
      ) : (
        <>
          <div className="rubric-heading">
            <p className="eyebrow">Skill Validation Check</p>
            <h2>{rubric.title}</h2>
            {rubric.description && <p>{rubric.description}</p>}
            <div className="rubric-progress" aria-label={`${answeredCount} of ${rubric.criteria.length} criteria answered`}>
              <span style={{ width: `${(answeredCount / rubric.criteria.length) * 100}%` }} />
            </div>
            <div className="rubric-meta">
              <span>{answeredCount} of {rubric.criteria.length} answered</span>
              <button type="button" className="text-button" onClick={() => inputRef.current?.click()}>Change rubric</button>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".json,.csv,application/json,text/csv"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) onImport(file)
                event.target.value = ''
              }}
            />
            <small>{rubricFilename}</small>
            {error && <p className="error-message compact">{error}</p>}
          </div>
          <div className="criterion-list">
            {rubric.criteria.map((criterion, index) => {
              const response = responseByCriterion.get(criterion.id)
              const evidenceBlocks = (response?.evidenceBlockIds ?? [])
                .map((blockId) => blocks.find((block) => block.id === blockId))
                .filter((block): block is SessionBlock => Boolean(block))
              return (
                <section
                  className={`criterion ${response?.selectedOptionValue ? 'answered' : ''}`}
                  id={`criterion-${criterion.id}`}
                  key={criterion.id}
                >
                  <div className="criterion-heading">
                    <span>{index + 1}</span>
                    <div>
                      <h3>{criterion.prompt}</h3>
                      {criterion.description && <p>{criterion.description}</p>}
                    </div>
                  </div>
                  <fieldset>
                    <legend>Choose one</legend>
                    {criterion.options.map((option) => (
                      <label key={option.value}>
                        <input
                          type="radio"
                          name={`criterion-${criterion.id}`}
                          value={option.value}
                          checked={response?.selectedOptionValue === option.value}
                          onChange={() => onUpdateResponse(criterion.id, { selectedOptionValue: option.value })}
                        />
                        {option.label}
                      </label>
                    ))}
                  </fieldset>
                  <label className="criterion-note">
                    <span>Note <small>optional</small></span>
                    <textarea
                      rows={3}
                      value={response?.note ?? ''}
                      placeholder="Add rationale or context"
                      onChange={(event) => onUpdateResponse(criterion.id, { note: event.target.value })}
                    />
                  </label>
                  <div className="criterion-evidence">
                    <div>
                      <strong>Evidence</strong>
                      <button type="button" className="text-button" onClick={() => setEvidenceCriterionId(criterion.id)}>
                        Add evidence
                      </button>
                    </div>
                    {evidenceBlocks.map((block) => (
                      <div className="evidence-chip" key={block.id}>
                        <span><strong>{block.title}</strong> {block.elapsed}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${block.title} evidence`}
                          onClick={() => onUpdateResponse(criterion.id, {
                            evidenceBlockIds: evidenceBlocks
                              .filter((item) => item.id !== block.id)
                              .map((item) => item.id),
                          })}
                        >×</button>
                      </div>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        </>
      )}
    </aside>
  )
}
