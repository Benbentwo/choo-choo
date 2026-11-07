import { describe, it, expect } from 'vitest'
import { PLAN_REVIEWERS, combineFindings, revisePlanMessage, type ReviewerResult } from '../src/main/planReview'

const [design, readiness, codebase] = PLAN_REVIEWERS

describe('PLAN_REVIEWERS', () => {
  it('has three read-only lenses with distinct ids', () => {
    expect(PLAN_REVIEWERS.map((r) => r.id)).toEqual(['design', 'readiness', 'codebase'])
    for (const r of PLAN_REVIEWERS) {
      expect(r.prompt).toContain('never seen the conversation')
      expect(r.prompt).toContain('SILENT')
    }
  })
})

describe('combineFindings', () => {
  it('tags each finding with its reviewer and keeps blockers', () => {
    const results: ReviewerResult[] = [
      { reviewer: design, notes: ['[blocker] Step 2 races with the watcher.'], blocker: true },
      { reviewer: readiness, notes: [], blocker: false },
      { reviewer: codebase, notes: ['[NOTE] git.ts has a helper for this.', 'untagged line'], blocker: false }
    ]
    const out = combineFindings(results)
    expect(out.silent).toBe(false)
    expect(out.blocker).toBe(true)
    expect(out.text.split('\n')).toEqual([
      '[blocker] Design: Step 2 races with the watcher.',
      '[note] Codebase: git.ts has a helper for this.',
      '[note] Codebase: untagged line'
    ])
  })

  it('is silent when nobody found anything', () => {
    const out = combineFindings(PLAN_REVIEWERS.map((reviewer) => ({ reviewer, notes: [], blocker: false })))
    expect(out).toEqual({ text: 'No concerns from 3 fresh reviewers', blocker: false, silent: true })
  })

  it('says which reviewers failed', () => {
    const out = combineFindings([
      { reviewer: design, notes: [], blocker: false, error: 'boom' },
      { reviewer: readiness, notes: [], blocker: false },
      { reviewer: codebase, notes: ['[note] x'], blocker: false }
    ])
    expect(out.text).toContain('[note] Codebase: x')
    expect(out.text).toContain('Design reviewer failed: boom')
  })

  it('reports a failure when every reviewer failed', () => {
    const out = combineFindings(PLAN_REVIEWERS.map((reviewer) => ({ reviewer, notes: [], blocker: false, error: 'no auth' })))
    expect(out).toEqual({ text: 'Plan review failed: no auth', blocker: false, silent: true })
  })
})

describe('revisePlanMessage', () => {
  it('passes the findings back and asks for a revised plan', () => {
    const msg = revisePlanMessage(['[blocker] Design: a'])
    expect(msg).toContain('[blocker] Design: a')
    expect(msg).toContain('without seeing this conversation')
    expect(msg).toContain('revised plan')
  })
})
