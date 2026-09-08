import Papa from 'papaparse'
import type {
  RubricCriterion,
  RubricDefinition,
  RubricOption,
} from './annotationTypes'

const supportedSchemaVersion = 1
const csvColumns = [
  'rubric_id',
  'rubric_title',
  'rubric_description',
  'criterion_id',
  'criterion_prompt',
  'criterion_description',
  'option_value',
  'option_label',
] as const

type CsvColumn = (typeof csvColumns)[number]
type CsvRow = Record<CsvColumn, string>

function recordValue(value: unknown, location: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${location} must be an object.`)
  }
  return value as Record<string, unknown>
}

function requiredText(value: unknown, location: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${location} must be a non-empty string.`)
  }
  return value.trim()
}

function optionalText(value: unknown, location: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') {
    throw new Error(`${location} must be a string when provided.`)
  }
  return value.trim() || undefined
}

function validateDefinition(value: unknown): RubricDefinition {
  const rubric = recordValue(value, 'Rubric')
  if (rubric.schemaVersion !== supportedSchemaVersion) {
    throw new Error(
      `Unsupported rubric schemaVersion ${String(rubric.schemaVersion)}. Expected ${supportedSchemaVersion}.`,
    )
  }
  if (!Array.isArray(rubric.criteria) || rubric.criteria.length === 0) {
    throw new Error('Rubric criteria must contain at least one criterion.')
  }

  const criterionIds = new Set<string>()
  const criteria = rubric.criteria.map((criterionValue, criterionIndex) => {
    const location = `Criterion ${criterionIndex + 1}`
    const criterion = recordValue(criterionValue, location)
    const id = requiredText(criterion.id, `${location} id`)
    if (criterionIds.has(id)) {
      throw new Error(`Duplicate criterion id "${id}".`)
    }
    criterionIds.add(id)

    if (!Array.isArray(criterion.options) || criterion.options.length < 2) {
      throw new Error(`Criterion "${id}" must contain at least two options.`)
    }
    const optionValues = new Set<string>()
    const options = criterion.options.map((optionValue, optionIndex) => {
      const option = recordValue(optionValue, `Option ${optionIndex + 1} in criterion "${id}"`)
      const value = requiredText(option.value, `Option ${optionIndex + 1} value in criterion "${id}"`)
      if (optionValues.has(value)) {
        throw new Error(`Duplicate option value "${value}" in criterion "${id}".`)
      }
      optionValues.add(value)
      return {
        value,
        label: requiredText(option.label, `Option "${value}" label in criterion "${id}"`),
      }
    })

    return {
      id,
      prompt: requiredText(criterion.prompt, `${location} prompt`),
      description: optionalText(criterion.description, `${location} description`),
      options,
    }
  })

  return {
    schemaVersion: supportedSchemaVersion,
    id: requiredText(rubric.id, 'Rubric id'),
    title: requiredText(rubric.title, 'Rubric title'),
    description: optionalText(rubric.description, 'Rubric description'),
    criteria,
  }
}

function parseJsonRubric(source: string): RubricDefinition {
  try {
    return validateDefinition(JSON.parse(source) as unknown)
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid rubric JSON: ${error.message}`)
    }
    throw error
  }
}

function assertConsistent(
  actual: string,
  expected: string,
  field: string,
  rowNumber: number,
): void {
  if (actual !== expected) {
    throw new Error(`CSV row ${rowNumber} has inconsistent ${field}.`)
  }
}

function parseCsvRubric(source: string): RubricDefinition {
  const result = Papa.parse<Record<string, string>>(source, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  })
  if (result.errors.length > 0) {
    const issue = result.errors[0]
    throw new Error(`Invalid rubric CSV${issue.row === undefined ? '' : ` at row ${issue.row + 2}`}: ${issue.message}`)
  }

  const fields = result.meta.fields ?? []
  const missingColumns = csvColumns.filter((column) => !fields.includes(column))
  if (missingColumns.length > 0) {
    throw new Error(`Rubric CSV is missing required columns: ${missingColumns.join(', ')}.`)
  }
  if (result.data.length === 0) {
    throw new Error('Rubric CSV must contain at least one option row.')
  }

  const rows = result.data.map((rawRow) => Object.fromEntries(
    csvColumns.map((column) => [column, (rawRow[column] ?? '').trim()]),
  ) as CsvRow)
  const firstRow = rows[0]
  const rubricId = requiredText(firstRow.rubric_id, 'CSV rubric_id')
  const rubricTitle = requiredText(firstRow.rubric_title, 'CSV rubric_title')
  const rubricDescription = firstRow.rubric_description
  const criteriaById = new Map<string, RubricCriterion>()

  rows.forEach((row, index) => {
    const rowNumber = index + 2
    assertConsistent(row.rubric_id, rubricId, 'rubric_id', rowNumber)
    assertConsistent(row.rubric_title, rubricTitle, 'rubric_title', rowNumber)
    assertConsistent(row.rubric_description, rubricDescription, 'rubric_description', rowNumber)

    const criterionId = requiredText(row.criterion_id, `CSV row ${rowNumber} criterion_id`)
    const criterionPrompt = requiredText(row.criterion_prompt, `CSV row ${rowNumber} criterion_prompt`)
    const criterionDescription = row.criterion_description
    let criterion = criteriaById.get(criterionId)
    if (!criterion) {
      criterion = {
        id: criterionId,
        prompt: criterionPrompt,
        description: criterionDescription || undefined,
        options: [],
      }
      criteriaById.set(criterionId, criterion)
    } else {
      assertConsistent(criterionPrompt, criterion.prompt, 'criterion_prompt', rowNumber)
      assertConsistent(criterionDescription, criterion.description ?? '', 'criterion_description', rowNumber)
    }

    const option: RubricOption = {
      value: requiredText(row.option_value, `CSV row ${rowNumber} option_value`),
      label: requiredText(row.option_label, `CSV row ${rowNumber} option_label`),
    }
    criterion.options.push(option)
  })

  return validateDefinition({
    schemaVersion: supportedSchemaVersion,
    id: rubricId,
    title: rubricTitle,
    description: rubricDescription || undefined,
    criteria: [...criteriaById.values()],
  })
}

export function parseRubric(source: string, filename: string): RubricDefinition {
  const extension = filename.toLowerCase().split('.').pop()
  if (extension === 'json') return parseJsonRubric(source)
  if (extension === 'csv') return parseCsvRubric(source)
  throw new Error('Rubric file must be JSON or CSV.')
}