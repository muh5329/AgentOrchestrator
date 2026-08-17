import { describe, expect, it } from 'vitest'
import { toHtml } from '../src/shared/markdown'

/**
 * The document renderer runs on the renderer's only thread.
 *
 * A parser that can fail to advance does not produce wrong output - it freezes
 * the window, with no error, no stack and no way for the person looking at it
 * to tell what happened. So the property under test is not "does it render
 * tables nicely" but "does it always finish", for any input at all.
 */

/** Fails the test rather than the suite if the parser ever stops progressing. */
function render(markdown: string): string {
  const started = Date.now()
  const html = toHtml(markdown)
  expect(Date.now() - started).toBeLessThan(1000)
  return html
}

describe('a parser that always terminates', () => {
  it('does not hang on a pipe row with no separator beneath it', () => {
    // The bug this covers froze the whole application: the line looked like a
    // table, was not one, and no branch would consume it.
    const html = render('Some notes:\n| unfinished table row\nmore text')
    expect(html).toContain('unfinished table row')
    expect(html).toContain('more text')
  })

  it('does not hang on a pipe row at the very end of the document', () => {
    expect(render('Heading text\n\n| trailing')).toContain('trailing')
  })

  it('does not hang on a lone pipe, or a wall of them', () => {
    expect(render('|')).toContain('|')
    expect(render('|\n|\n|\n|')).toBeTruthy()
  })

  it('does not hang on an unclosed code fence', () => {
    expect(render('```ts\nconst a = 1')).toContain('const a = 1')
  })

  it('finishes on every prefix of a document that mixes every construct', () => {
    const doc = [
      '# Mission',
      '',
      'Ship the thing. Costs are in the table:',
      '',
      '| Item | Cost |',
      '| --- | --- |',
      '| Compute | $40 |',
      '',
      '> A quote',
      '- a list item',
      '1. an ordered item',
      '---',
      '```',
      'code',
      '```',
      '| a stray row',
      'trailing prose'
    ].join('\n')

    // Every truncation of a real document, because the failure mode was a
    // construct that had not been finished yet.
    for (let cut = 0; cut <= doc.length; cut += 7) {
      render(doc.slice(0, cut))
    }
  })

  it('still renders a well-formed table as a table', () => {
    const html = render('| Item | Cost |\n| --- | --- |\n| Compute | $40 |')
    expect(html).toContain('<table')
    expect(html).toContain('Compute')
  })

  it('escapes markup rather than letting an agent inject it', () => {
    const html = render('<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })
})
