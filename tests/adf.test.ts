import { describe, it, expect } from 'vitest';
import { textToAdf, adfToText } from '../src/adf.js';

describe('textToAdf', () => {
  it('chaîne vide → un paragraphe vide', () => {
    const result = textToAdf('');
    expect(result.type).toBe('doc');
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({ type: 'paragraph' });
  });

  it('une ligne non-vide → paragraphe avec nœud text', () => {
    const result = textToAdf('Hello');
    expect(result.content[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Hello' }],
    });
  });

  it('deux lignes → deux paragraphes', () => {
    const result = textToAdf('Ligne A\nLigne B');
    expect(result.content).toHaveLength(2);
    expect(result.content[1]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Ligne B' }],
    });
  });

  it('ligne vide intercalée → paragraphe sans content', () => {
    const result = textToAdf('A\n\nB');
    expect(result.content[1]).toEqual({ type: 'paragraph' });
  });
});

describe('adfToText', () => {
  it('null → chaîne vide', () => expect(adfToText(null)).toBe(''));
  it('nœud text → texte brut', () => {
    expect(adfToText({ type: 'text', text: 'Hello' })).toBe('Hello');
  });
  it('paragraphe avec texte → texte + newline', () => {
    const node = { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] };
    expect(adfToText(node)).toBe('Hello\n');
  });
  it('round-trip textToAdf → adfToText reconstruit le texte (trim)', () => {
    const original = 'Sévérité : Critique\nMitigation : Filtres courts';
    const adf = textToAdf(original);
    const back = adfToText(adf).trim();
    expect(back).toBe(original);
  });
});
