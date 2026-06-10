// ════════════════════════════════════════════════════════════════════════════
// Tests — rich-editor/utils
// ════════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest'
import { EMPTY_DOC, docsEqual, isDocEmpty, extractPlainText } from './utils'

const docWithText = (txt) => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: txt }] },
  ],
})

describe('EMPTY_DOC', () => {
  it('est considéré vide', () => {
    expect(isDocEmpty(EMPTY_DOC)).toBe(true)
  })
})

describe('docsEqual', () => {
  it('compare structurellement', () => {
    expect(docsEqual(docWithText('foo'), docWithText('foo'))).toBe(true)
    expect(docsEqual(docWithText('foo'), docWithText('bar'))).toBe(false)
  })
  it('null/undefined comparé à EMPTY_DOC', () => {
    expect(docsEqual(null, EMPTY_DOC)).toBe(true)
    expect(docsEqual(undefined, EMPTY_DOC)).toBe(true)
  })
})

describe('isDocEmpty', () => {
  it('vrai pour doc null/undefined/sans content', () => {
    expect(isDocEmpty(null)).toBe(true)
    expect(isDocEmpty(undefined)).toBe(true)
    expect(isDocEmpty({})).toBe(true)
    expect(isDocEmpty({ type: 'doc' })).toBe(true)
  })

  it('vrai pour paragraphe vide', () => {
    expect(isDocEmpty({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    })).toBe(true)
  })

  it("vrai pour paragraphe contenant uniquement du whitespace", () => {
    expect(isDocEmpty({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: '   \t  ' }],
      }],
    })).toBe(true)
  })

  it('faux dès qu\'un text node a du contenu visible', () => {
    expect(isDocEmpty(docWithText('hello'))).toBe(false)
  })

  it('faux pour heading même vide (structure intentionnelle)', () => {
    expect(isDocEmpty({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 1 } }],
    })).toBe(false)
  })

  it('faux pour blockquote/liste/codeBlock', () => {
    expect(isDocEmpty({
      type: 'doc',
      content: [{ type: 'bulletList', content: [] }],
    })).toBe(false)
  })
})

describe('extractPlainText', () => {
  it('extrait le texte brut sans formatage', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Bonjour ' },
            {
              type: 'text',
              marks: [{ type: 'bold' }],
              text: 'monde',
            },
          ],
        },
      ],
    }
    expect(extractPlainText(doc)).toBe('Bonjour monde')
  })

  it('insère des newlines entre blocs', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Ligne 1' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Ligne 2' }] },
      ],
    }
    expect(extractPlainText(doc)).toBe('Ligne 1\nLigne 2')
  })

  it('compress newlines multiples', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'A' }] },
        { type: 'paragraph' },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'B' }] },
      ],
    }
    expect(extractPlainText(doc)).toBe('A\n\nB')
  })

  it("retourne '' pour doc vide / null", () => {
    expect(extractPlainText(null)).toBe('')
    expect(extractPlainText(EMPTY_DOC)).toBe('')
  })

  it('tronque à maxLen + ellipsis', () => {
    const longText = 'a'.repeat(20)
    const doc = docWithText(longText)
    expect(extractPlainText(doc, { maxLen: 5 })).toBe('aaaaa…')
  })
})
