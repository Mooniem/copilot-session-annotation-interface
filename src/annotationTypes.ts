export type AnnotationGoal = 'skill-validation' | 'conversation-flow'

export type ExportedEvent = {
  blockId: string
  title: string
  kind: 'user' | 'copilot' | 'reasoning' | 'tool' | 'info'
  elapsed: string
  markdown: string
}

export type AnnotationContext = {
  annotatedEvent: ExportedEvent
  copilotGeneratedText: string | null
}

export type ConversationFlowAnnotation = {
  id: string
  blockId: string
  blockTitle: string
  elapsed: string
  category: string
  comment: string
  createdAt: string
  context?: AnnotationContext
}

export type RubricOption = {
  value: string
  label: string
}

export type RubricCriterion = {
  id: string
  prompt: string
  description?: string
  options: RubricOption[]
}

export type RubricDefinition = {
  schemaVersion: 1
  id: string
  title: string
  description?: string
  criteria: RubricCriterion[]
}

export type RubricResponse = {
  criterionId: string
  selectedOptionValue?: string
  note?: string
  evidenceBlockIds: string[]
  updatedAt: string
}