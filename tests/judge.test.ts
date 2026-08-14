import { describe, expect, it } from 'vitest'
import {
  aggregateVerdicts,
  decide,
  extractJsonObjects,
  normalizeVerdict,
  parseVerdict,
  weightedScore
} from '../src/main/engines/judge-engine'
import { DEFAULT_RUBRIC_DIMENSIONS, type JudgeVerdict } from '../src/shared/domain'

describe('parseVerdict', () => {
  it('reads a bare JSON object', () => {
    const parsed = parseVerdict('{"score":0.9,"decision":"APPROVED"}')
    expect(parsed?.score).toBe(0.9)
  })

  it('reads JSON out of a fenced block surrounded by prose', () => {
    const parsed = parseVerdict(
      'Here is my verdict.\n```json\n{"score":0.4,"decision":"REJECTED"}\n```\nThanks.'
    )
    expect(parsed?.decision).toBe('REJECTED')
  })

  it('survives the object being repeated', () => {
    const one = '{"score":0.7,"decision":"REJECTED"}'
    const parsed = parseVerdict(`${one}\n\n${one}\n[Ended without calling complete_task.]`)
    expect(parsed?.score).toBe(0.7)
  })

  it('ignores braces inside strings', () => {
    const objects = extractJsonObjects('{"summary":"uses {braces} inside","score":1}')
    expect(objects).toHaveLength(1)
    expect(JSON.parse(objects[0]).summary).toBe('uses {braces} inside')
  })

  it('returns null when there is no verdict to find', () => {
    expect(parseVerdict('I think it looks fine to me!')).toBeNull()
    expect(parseVerdict('')).toBeNull()
  })
})

describe('scoring', () => {
  it('weights dimensions rather than trusting the headline number', () => {
    const criteria = [
      { name: 'Correctness', score: 0.2, reason: 'broken' },
      { name: 'Completeness', score: 0.2, reason: 'partial' },
      { name: 'Tests', score: 0, reason: 'none' }
    ]
    const score = weightedScore(criteria, DEFAULT_RUBRIC_DIMENSIONS)
    expect(score).toBeLessThan(0.25)

    // A judge claiming 0.95 while scoring every dimension badly does not win.
    const normalized = normalizeVerdict(
      { score: 0.95, decision: 'APPROVED', criteria },
      DEFAULT_RUBRIC_DIMENSIONS
    )
    expect(normalized.score).toBeLessThan(0.25)
  })

  it('accepts percentages as well as fractions', () => {
    const normalized = normalizeVerdict({ score: 87, decision: 'APPROVED' })
    expect(normalized.score).toBeCloseTo(0.87)
  })

  it('applies pass and escalate thresholds', () => {
    const thresholds = { pass: 0.8, escalate: 0.3 }
    expect(decide(0.9, thresholds)).toBe('APPROVED')
    expect(decide(0.5, thresholds)).toBe('REJECTED')
    expect(decide(0.1, thresholds)).toBe('ESCALATE')
    expect(decide(0.99, { ...thresholds, judgeSaid: 'ESCALATE' })).toBe('ESCALATE')
  })
})

describe('panel aggregation', () => {
  const base: JudgeVerdict = {
    score: 0.9,
    decision: 'APPROVED',
    criteria: [],
    issues: [],
    requiredChanges: [],
    summary: 'fine'
  }

  it('averages scores and unions findings', () => {
    const merged = aggregateVerdicts([
      { ...base, score: 0.9, issues: ['a'] },
      { ...base, score: 0.5, decision: 'REJECTED', issues: ['a', 'b'], requiredChanges: ['fix b'] }
    ])
    expect(merged.score).toBeCloseTo(0.7)
    expect(merged.decision).toBe('REJECTED')
    expect(merged.issues).toEqual(['a', 'b'])
    expect(merged.requiredChanges).toEqual(['fix b'])
  })

  it('lets any single escalation win', () => {
    const merged = aggregateVerdicts([base, { ...base, decision: 'ESCALATE' }])
    expect(merged.decision).toBe('ESCALATE')
  })
})
