import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseRubric } from '../src/parseRubric.ts'

const jsonSource = await readFile('public/templates/skill-validation-rubric.json', 'utf8')
const csvSource = await readFile('public/templates/skill-validation-rubric.csv', 'utf8')
const jsonRubric = parseRubric(jsonSource, 'rubric.json')
const csvRubric = parseRubric(csvSource, 'rubric.csv')

assert.deepEqual(csvRubric, jsonRubric)

const multilineCsv = `rubric_id,rubric_title,rubric_description,criterion_id,criterion_prompt,criterion_description,option_value,option_label
rubric-1,"Quoted, rubric","First line
Second line",criterion-1,"Prompt, with comma",,yes,"Yes, fully"
rubric-1,"Quoted, rubric","First line
Second line",criterion-1,"Prompt, with comma",,no,No`
const multilineRubric = parseRubric(multilineCsv, 'rubric.csv')
assert.equal(multilineRubric.description, 'First line\nSecond line')
assert.equal(multilineRubric.criteria[0].options[0].label, 'Yes, fully')

const oneOptionRubric = JSON.parse(jsonSource)
oneOptionRubric.criteria[0].options = oneOptionRubric.criteria[0].options.slice(0, 1)

const invalidCases: Array<[string, string, RegExp]> = [
  ['{', 'rubric.json', /Invalid rubric JSON/],
  [jsonSource.replace('"schemaVersion": 1', '"schemaVersion": 2'), 'rubric.json', /Unsupported rubric schemaVersion/],
  [jsonSource.replace('{ "value": "partial", "label": "Partially" }', '{ "value": "yes", "label": "Partially" }'), 'rubric.json', /Duplicate option value/],
  [JSON.stringify(oneOptionRubric), 'rubric.json', /at least two options/],
  [csvSource.replace('skill-validation-v1,Skill Validation Check,Evaluate whether', 'skill-validation-v1,Different title,Evaluate whether'), 'rubric.csv', /inconsistent rubric_title/],
  ['rubric_id,rubric_title\na,b', 'rubric.csv', /missing required columns/],
]

for (const [source, filename, expectedError] of invalidCases) {
  assert.throws(() => parseRubric(source, filename), expectedError)
}

console.log('Rubric parser checks passed.')
