// tests/jira-conventions.test.ts
import { describe, it, expect } from 'vitest';
import { deriveCategory, lintSummary } from '../src/jira-conventions.js';

describe('deriveCategory', () => {
  it('done pour terminé(e)', () => {
    expect(deriveCategory('Terminé(e)', [])).toBe('done');
    expect(deriveCategory('terminé', [])).toBe('done');
    expect(deriveCategory('Done', [])).toBe('done');
  });
  it('done pour statut terminé PRÉFIXÉ (workflow custom, ex. « Web - Terminé »)', () => {
    expect(deriveCategory('Web - Terminé', [])).toBe('done');
    expect(deriveCategory('Game Engine - Terminé', [])).toBe('done');
  });
  it('cancelled pour statut annulé préfixé', () => {
    expect(deriveCategory('Web - Annulé', [])).toBe('cancelled');
  });
  it('in_progress pour En cours / in progress', () => {
    expect(deriveCategory('En cours', [])).toBe('in_progress');
    expect(deriveCategory('in progress', [])).toBe('in_progress');
  });
  it('blocked pour statut contenant "bloqu"', () => {
    expect(deriveCategory('Bloqué', [])).toBe('blocked');
    expect(deriveCategory('PCB - Bloqué', [])).toBe('blocked');
  });
  it('review pour révision / revision', () => {
    expect(deriveCategory('Révision', [])).toBe('review');
    expect(deriveCategory('review', [])).toBe('review');
  });
  it('cancelled via label annulé', () => {
    expect(deriveCategory('À faire', ['annulé'])).toBe('cancelled');
    expect(deriveCategory('cancelled', [])).toBe('cancelled');
  });
  it('todo pour statut inconnu', () => {
    expect(deriveCategory('À faire', [])).toBe('todo');
    expect(deriveCategory('', [])).toBe('todo');
  });
});

describe('lintSummary', () => {
  it('null pour un résumé propre', () => {
    expect(lintSummary('Titre propre')).toBeNull();
  });
  it('détecte markdown bold **', () => {
    expect(lintSummary('**Titre**')).toContain('markdown');
  });
  it('détecte backtick', () => {
    expect(lintSummary('code `ici`')).toContain('markdown');
  });
  it('détecte symbole décoratif', () => {
    expect(lintSummary('◆ Item')).toContain('symbole décoratif');
  });
  it('détecte espace en bord', () => {
    expect(lintSummary(' Titre')).toContain('espaces en bord');
    expect(lintSummary('Titre ')).toContain('espaces en bord');
  });
  it('détecte espaces multiples', () => {
    expect(lintSummary('Titre  long')).toContain('espaces multiples');
  });
});
