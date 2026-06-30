export type StatusCategory = 'todo' | 'in_progress' | 'done' | 'cancelled';

export interface Task {
  id: string;                 // ex. "MIP-19" (= label nid-)
  jiraKey: string | null;     // ex. "NATHAN-123"
  title: string;
  role: string;               // ENG|AUD|ELEC|JEU|ÉQUIPE|INDIV|GESTION|TOUTES…
  block: string;              // titre de section (déduit du tableau)
  estimateHours: number | null;
  start: string | null;       // ISO YYYY-MM-DD
  due: string | null;         // ISO YYYY-MM-DD
  session: string | null;     // calculée depuis start
  dependsOn: string[];        // IDs prédécesseurs
  status: string;             // statut JIRA réel
  statusCategory: StatusCategory;
  notes: string;
  url: string | null;
}

export interface Config {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  issueType: string;
}

export interface PlanFieldDiff {
  field: string;
  jira: unknown;
  md: unknown;
}

export interface PlanItem {
  id: string;
  action: 'create' | 'update' | 'skip';
  jiraKey: string | null;
  reason: string;
  fields: Task;
  diffs: PlanFieldDiff[];
}

export interface SeedPlan {
  generatedAt: string;
  items: PlanItem[];
  orphans: Array<{ id: string; jiraKey: string }>;
  possibleDuplicates: Array<{ id: string; title: string; jiraKey: string }>;
  existingLinks: string[];
  summary: { create: number; update: number; skip: number; orphans: number; duplicates: number };
}

/** Client HTTP de base injecté dans les primitives JIRA bas-niveau.
 *  JiraWriteClient (Phase 2B) et la future interface restore.ts (Phase 2C) l'étendent. */
export interface JiraHttpClient {
  baseUrl: string;
  authHeader: string;
  fetchFn: typeof fetch;
}
