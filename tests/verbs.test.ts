import { describe, it, expect } from 'vitest';
import { addTask, reschedule, assign, setEstimate, setStatus, link, deleteTask, addSubtasks } from '../src/mcp/verbs.js';
import { collectRefs } from '../src/mcp/guard.js';
import type { ConventionProfile } from '../src/profile.js';

const nathan: ConventionProfile = {
  name: 'nathan',
  mapLabels: (b) => (b.toLowerCase() === 'e' ? ['bloc-moteur-de-jeu'] : []),
  lintSummary: (s) => (/\*\*/.test(s) ? { ok: false, violations: 'markdown', suggestion: s.replace(/\*\*/g, '') } : { ok: true }),
};

describe('addTask', () => {
  it('construit un CreateChange avec projet, epic, dates, estimation', () => {
    const { changeset, preview } = addTask({
      project: 'DEV', summary: 'Créer le module audio', epicKey: 'DEV-100',
      start: '2026-08-01', due: '2026-08-10', estimateHours: 4,
    });
    expect(changeset.create).toHaveLength(1);
    const c = changeset.create![0];
    expect(c).toMatchObject({ projet: 'DEV', nom: 'Créer le module audio', epic: 'DEV-100',
      debut: '2026-08-01', fin: '2026-08-10', estimateHours: 4 });
    expect(preview).toContain('DEV');
    expect(preview).toContain('Créer le module audio');
  });

  it('sans profil : les labels explicites sont conservés tels quels', () => {
    const { changeset } = addTask({ project: 'DEV', summary: 'X', epicKey: 'DEV-1', labels: ['perso'] });
    expect(changeset.create![0].labels).toEqual(['perso']);
  });

  it('avec profil + bloc : ajoute le label de bloc mappé', () => {
    const { changeset } = addTask({ project: 'DEV', summary: 'X', epicKey: 'DEV-1', bloc: 'E' }, nathan);
    expect(changeset.create![0].labels).toContain('bloc-moteur-de-jeu');
  });

  it('avec profil : un résumé non conforme apparaît dans l’aperçu (avertissement, non bloquant)', () => {
    const { preview, changeset } = addTask({ project: 'DEV', summary: '**Gras**', epicKey: 'DEV-1' }, nathan);
    expect(preview.toLowerCase()).toContain('markdown');
    expect(changeset.create).toHaveLength(1); // non bloquant : la tâche est quand même proposée
  });
});

describe('verbes de mise à jour', () => {
  it('reschedule → UpdateChange dates', () => {
    const { changeset } = reschedule({ key: 'DEV-2', start: '2026-08-01', due: '2026-08-05' });
    expect(changeset.update![0]).toMatchObject({ ref: 'DEV-2', debut: '2026-08-01', fin: '2026-08-05' });
    expect(collectRefs(changeset)).toEqual(['DEV-2']);
  });
  it('assign → UpdateChange assignee (null = désassigner)', () => {
    expect(assign({ key: 'DEV-2', assignee: 'Mathieu Nicol' }).changeset.update![0]).toMatchObject({ ref: 'DEV-2', assignee: 'Mathieu Nicol' });
    expect(assign({ key: 'DEV-2', assignee: null }).changeset.update![0]).toMatchObject({ ref: 'DEV-2', assignee: null });
  });
  it('setEstimate → UpdateChange estimateHours (null = effacer)', () => {
    expect(setEstimate({ key: 'DEV-2', hours: 3 }).changeset.update![0]).toMatchObject({ ref: 'DEV-2', estimateHours: 3 });
    expect(setEstimate({ key: 'DEV-2', hours: null }).changeset.update![0]).toMatchObject({ ref: 'DEV-2', estimateHours: null });
  });
  it('setStatus → UpdateChange statut', () => {
    expect(setStatus({ key: 'DEV-2', statusName: 'En cours' }).changeset.update![0]).toMatchObject({ ref: 'DEV-2', statut: 'En cours' });
  });
});

describe('link', () => {
  it('crée une dépendance existante prereq→task, surveille les deux clés', () => {
    const { changeset } = link({ prereqKey: 'DEV-1', taskKey: 'DEV-2', type: 'FS' });
    const u = changeset.update![0];
    expect(u.ref).toBe('DEV-2');
    expect(u.dependsOn).toEqual([{ ref: 'DEV-1', type: 'FS', existingKey: true }]);
    expect(collectRefs(changeset).sort()).toEqual(['DEV-1', 'DEV-2']);
  });
});

describe('deleteTask', () => {
  it('DeleteChange avec raison', () => {
    const { changeset } = deleteTask({ key: 'DEV-9', reason: 'doublon' });
    expect(changeset.delete![0]).toMatchObject({ ref: 'DEV-9', raison: 'doublon' });
  });
});

describe('addSubtasks', () => {
  it('UpdateChange du parent avec les sous-tâches', () => {
    const { changeset } = addSubtasks({ parentKey: 'DEV-2', subtasks: [
      { summary: 'partie A', estimateHours: 1 }, { summary: 'partie B', assignee: 'Nathan' },
    ] });
    const u = changeset.update![0];
    expect(u.ref).toBe('DEV-2');
    expect(u.subtasks).toHaveLength(2);
    expect(u.subtasks![0]).toMatchObject({ nom: 'partie A', estimateHours: 1 });
    expect(u.subtasks![1]).toMatchObject({ nom: 'partie B', assignee: 'Nathan' });
  });
});
