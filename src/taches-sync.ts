// src/taches-sync.ts
// Use-case : régénérer/rafraîchir les données JIRA dans le markdown de TACHES.md.
// Porté de gestion/src/taches-sync.ts. Aucun fs ni CLI ici.
// La lecture de TACHES.md et l'écriture du fichier restent dans gestion.

import type { RawIssue } from './snapshot.js';
import { deriveCategory } from './jira-conventions.js';
import type { StatusCategory } from './types.js';

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

export interface RefreshStats {
  matched: number;
  updatedRows: number;
  planRowsUnmatched: string[];
  jiraNotInPlan: string[];
  columnMismatches: string[];
}

export interface RefreshResult {
  markdown: string;
  warnings: string[];
  stats: RefreshStats;
}

// ---------------------------------------------------------------------------
// Helpers internes
// ---------------------------------------------------------------------------

/** Identifiant fonctionnel d'une issue, tiré du label `nid-<ID>` (ou null). */
export function nidOf(issue: Pick<RawIssue, 'labels'>): string | null {
  return (issue.labels || []).find((l) => l.startsWith('nid-'))?.slice(4) ?? null;
}

function cleanId(cell: string): string {
  return (cell || '').replace(/\*\*/g, '').replace(/~~/g, '').trim();
}

function glyphFor(cat: StatusCategory): string {
  if (cat === 'done' || cat === 'cancelled') return '[x]';
  if (cat === 'in_progress' || cat === 'review' || cat === 'blocked') return '[~]';
  return '[ ]';
}

function displayStatus(status: string): string {
  const s = status.trim();
  if (s.toLowerCase() === 'revision') return 'Révision';
  return s;
}

function statusCategoryName(status: string): string | null {
  const idx = status.indexOf(' - ');
  return idx >= 0 ? status.slice(0, idx).trim() : null;
}

function bareDate(cell: string): string | null {
  return cell.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

function replaceDate(cell: string, iso: string): string {
  if (bareDate(cell)) return cell.replace(/\d{4}-\d{2}-\d{2}/, iso);
  return iso;
}

function splitRow(line: string): string[] {
  const cells = line.split('|');
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}

function renderTableRow(cells: string[]): string {
  return '|' + cells.map((c) => (c.length > 0 ? ` ${c} |` : ' |')).join('');
}

function isSeparator(line: string): boolean {
  return /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-');
}

interface ColIndex {
  id: number; projet: number; colonne: number; debut: number; fin: number; statut: number;
}

function taskHeaderIndices(cells: string[]): ColIndex | null {
  const find = (label: string) => cells.findIndex((c) => c === label);
  const id = find('ID');
  const colonne = find('Colonne');
  const statut = find('Statut');
  const hasBloc = cells.some((c) => c.startsWith('Bloc (Epic)'));
  const hasDeps = cells.some((c) => c.startsWith('Dépend de'));
  if (id !== 0 || colonne < 0 || statut < 0 || !hasBloc || !hasDeps) return null;
  return { id, projet: find('Projet'), colonne, debut: find('Début'), fin: find('Fin'), statut };
}

// ---------------------------------------------------------------------------
// refreshTaches — PURE
// ---------------------------------------------------------------------------

export function refreshTaches(markdown: string, issues: RawIssue[]): RefreshResult {
  const byNid = new Map<string, RawIssue>();
  for (const i of issues) {
    const n = nidOf(i);
    if (n) byNid.set(n, i);
  }

  const seen = new Set<string>();
  const planRowsUnmatched: string[] = [];
  const columnMismatches: string[] = [];
  let updatedRows = 0;

  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  let cols: ColIndex | null = null;

  for (const line of lines) {
    if (!line.trim().startsWith('|')) {
      if (line.trim() === '') cols = null;
      out.push(line);
      continue;
    }
    const cells = splitRow(line);
    const maybe = taskHeaderIndices(cells);
    if (maybe) { cols = maybe; out.push(line); continue; }
    if (cols && isSeparator(line)) { out.push(line); continue; }
    if (!cols) { out.push(line); continue; }

    const id = cleanId(cells[cols.id]);
    if (!id) { out.push(line); continue; }
    const issue = byNid.get(id);
    if (!issue) { planRowsUnmatched.push(id); out.push(line); continue; }
    seen.add(id);

    const next = [...cells];
    const cat = deriveCategory(issue.status, issue.labels || []);

    if (cols.statut >= 0) next[cols.statut] = glyphFor(cat);

    const projet = cols.projet >= 0 ? cells[cols.projet] : '';
    if ((projet === 'LIVS' || projet === 'GES') && cols.colonne >= 0) {
      next[cols.colonne] = displayStatus(issue.status);
    } else if ((projet === 'DC' || projet === 'DEV') && cols.colonne >= 0) {
      const jiraCat = statusCategoryName(issue.status);
      if (jiraCat && jiraCat !== cells[cols.colonne]) {
        columnMismatches.push(`${id} : colonne JIRA « ${jiraCat} » ≠ plan « ${cells[cols.colonne]} »`);
      }
    }

    if (cols.debut >= 0 && issue.start && bareDate(cells[cols.debut]) !== issue.start) {
      next[cols.debut] = replaceDate(cells[cols.debut], issue.start);
    }
    if (cols.fin >= 0 && issue.due && bareDate(cells[cols.fin]) !== issue.due) {
      next[cols.fin] = replaceDate(cells[cols.fin], issue.due);
    }

    if (next.some((c, k) => c !== cells[k])) { out.push(renderTableRow(next)); updatedRows++; }
    else out.push(line);
  }

  const jiraNotInPlan = [...byNid.keys()].filter((n) => !seen.has(n)).sort();
  const warnings: string[] = [];
  if (planRowsUnmatched.length) {
    warnings.push(`${planRowsUnmatched.length} ligne(s) du plan sans correspondance JIRA : ${planRowsUnmatched.join(', ')}`);
  }
  if (jiraNotInPlan.length) {
    warnings.push(`${jiraNotInPlan.length} issue(s) JIRA (nid) absentes du plan : ${jiraNotInPlan.join(', ')}`);
  }
  warnings.push(...columnMismatches);

  return {
    markdown: out.join('\n'),
    warnings,
    stats: { matched: seen.size, updatedRows, planRowsUnmatched, jiraNotInPlan, columnMismatches },
  };
}
