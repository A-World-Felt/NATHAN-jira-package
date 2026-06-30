// src/adf.ts

/** Convertit du texte brut (multi-lignes) en nœud ADF doc. */
export function textToAdf(text: string): { type: string; version: number; content: any[] } {
  const paras = (text || '').split(/\r?\n/).map((line) =>
    line
      ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
      : { type: 'paragraph' },
  );
  return { type: 'doc', version: 1, content: paras.length ? paras : [{ type: 'paragraph' }] };
}

/** Extrait le texte brut depuis un nœud ADF (récursif). */
export function adfToText(node: any): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  const inner = (node.content || []).map(adfToText).join('');
  return node.type === 'paragraph' ? inner + '\n' : inner;
}
