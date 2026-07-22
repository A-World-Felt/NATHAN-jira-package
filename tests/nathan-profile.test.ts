import { describe, it, expect } from 'vitest';
import { profile } from '../src/nathan-profile.js';
import { loadProfile } from '../src/profile.js';

describe('nathan-profile — identité & contrat', () => {
  it('a le nom « nathan » et satisfait loadProfile', async () => {
    expect(profile.name).toBe('nathan');
    const loaded = await loadProfile('x', () => Promise.resolve({ profile }));
    expect(loaded).toBe(profile);
  });
  it('n’est PAS réexporté depuis l’entrée neutre index.ts', async () => {
    const index = await import('../src/index.js');
    expect('profile' in index).toBe(false);
  });
});

describe('lintSummary', () => {
  it('texte brut → ok', () => {
    expect(profile.lintSummary!('Créer le module audio')).toEqual({ ok: true });
  });
  it('markdown → violation + suggestion normalisée', () => {
    const r = profile.lintSummary!('**Créer** le `module`');
    expect(r.ok).toBe(false);
    expect(r.violations).toContain('markdown');
    expect(r.suggestion).toBe('Créer le module');
  });
  it('symbole décoratif + espaces multiples → violations cumulées', () => {
    const r = profile.lintSummary!('◆ Créer  le  module');
    expect(r.violations).toContain('symbole décoratif');
    expect(r.violations).toContain('espaces multiples');
    expect(r.suggestion).toBe('Créer le module');
  });
});

describe('mapLabels', () => {
  it('par clé, libellé, ou label JIRA (insensible à la casse)', () => {
    expect(profile.mapLabels!('E')).toEqual(['bloc-moteur-de-jeu']);
    expect(profile.mapLabels!('IDE accessible')).toEqual(['bloc-ide']);
    expect(profile.mapLabels!('bloc-pcb')).toEqual(['bloc-pcb']);
  });
  it('inconnu ou vide → []', () => {
    expect(profile.mapLabels!('Zzz')).toEqual([]);
    expect(profile.mapLabels!('')).toEqual([]);
  });
});

describe('statusVocab', () => {
  it('fournit les 5 catégories avec le vocabulaire NATHAN', () => {
    const v = profile.statusVocab!();
    expect(v.done).toContain('terminé(e)');
    expect(v.cancelled).toContain('annulé');
    expect(v.blocked).toContain('bloqu');
    expect(v.review).toContain('révis');
    expect(v.inProgress).toContain('cours');
  });
});
