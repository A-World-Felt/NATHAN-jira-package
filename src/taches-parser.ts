import { sessionFromDate } from './mapping.js';
import type { Task, StatusCategory } from './types.js';

function splitRow(line: string): string[] {
  const cells = line.split('|');
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}
function isTaskHeader(cells: string[]): boolean {
  return cells[0] === 'ID' && cells.includes('Tâche') && cells.includes('Statut');
}
function isSeparator(line: string): boolean {
  return line.includes('-') && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line);
}
function headingText(line: string): string | null {
  const m = /^(#{2,4})\s+(.*?)\s*$/.exec(line);
  return m ? m[2].trim() : null;
}
function parseEstimate(cell: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*h/i.exec(cell);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}
function parseDate(cell: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(cell.trim()) ? cell.trim() : null;
}
function parseDeps(cell: string): string[] {
  if (!cell || cell === '—') return [];
  return cell.split(',').map((s) => s.trim()).filter((s) => s && s !== '—');
}
const CANCEL_RE = /^~~(.*)~~$/;

export function parseTasks(markdown: string): Task[] {
  const lines = markdown.split(/\r?\n/);
  const tasks: Task[] = [];
  let currentBlock = '';
  let header: string[] | null = null;
  let colIndex: Record<string, number> = {};

  for (const line of lines) {
    const h = headingText(line);
    if (h) { currentBlock = h; header = null; continue; }

    if (line.trim().startsWith('|')) {
      const cells = splitRow(line);
      if (isTaskHeader(cells)) {
        header = cells;
        colIndex = {};
        cells.forEach((c, idx) => { colIndex[c] = idx; });
        continue;
      }
      if (header && isSeparator(line)) continue;
      if (header) {
        const at = (name: string): string => {
          const idx = colIndex[name];
          return idx != null ? (cells[idx] ?? '') : '';
        };
        const id = at('ID');
        if (!id) continue;
        const rawTitle = at('Tâche');
        const cm = CANCEL_RE.exec(rawTitle);
        const cancelled = !!cm;
        const statut = at('Statut');
        let statusCategory: StatusCategory = 'todo';
        if (cancelled) statusCategory = 'cancelled';
        else if (statut.includes('[x]')) statusCategory = 'done';
        const start = parseDate(at('Début'));
        tasks.push({
          id,
          jiraKey: null,
          title: cancelled ? cm![1].trim() : rawTitle,
          role: at('Rôle'),
          block: currentBlock,
          estimateHours: parseEstimate(at('Est.')),
          start,
          due: parseDate(at('Fin')),
          session: sessionFromDate(start),
          dependsOn: parseDeps(at('Dépend de')),
          status: '',
          statusCategory,
          notes: at('Notes'),
          url: null,
        });
        continue;
      }
      continue; // ligne de table non-tâche
    }
    if (line.trim() === '') header = null; // fin du tableau courant
  }
  return tasks;
}
