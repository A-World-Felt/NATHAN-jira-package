# Phase 0 — Couche connexion JIRA (extraction depuis NATHAN-gestion) — Plan d'implémentation

> Piloté par `/cycle`. Le researcher VALIDE ce plan, le builder l'implémente en TDD.

**Objectif :** peupler ce repo (`NATHAN-jira-package`, package npm `nathan-jira-core`) avec la
couche connexion JIRA (client, config, types, mapping) extraite de NATHAN-gestion, buildable et
consommable par git dependency.

**Branche :** `feat/phase0-connexion`

## État du repo (point de départ réel)

- Repo `A-World-Felt/NATHAN-jira-package` **déjà créé**, **privé**, remote `origin` configuré, **0 commit**.
- Le builder fait donc le **commit initial sur `main`** (scaffold), pousse `main`, PUIS bascule
  sur `feat/phase0-connexion` pour la suite (cas « repo vide » prévu par l'agent builder).
- Source des fichiers à porter : `../NATHAN-gestion/src/` et `../NATHAN-gestion/tests/`.

## Contraintes globales

- `package.json` : `"name": "nathan-jira-core"`, `"type": "module"`, `"private": true`.
- `moduleResolution: NodeNext` → **tous les imports relatifs portent l'extension `.js`** (src ET tests).
- **Aucun changement de comportement** vs NATHAN-gestion : les tests portés passent à l'identique.
- Pas de secret committé (`.env` git-ignoré ; seul `.env.example` versionné). `data/cycle/` git-ignoré.

---

### Task 1 — Scaffold + modules purs (`types`, `mapping`)

**Fichiers :**
- Créer : `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `.gitignore`, `tests/setup.ts`, `src/types.ts`, `src/mapping.ts`
- Test : `tests/mapping.test.ts`

- [ ] **Step 1.1 : `package.json`**

```json
{
  "name": "nathan-jira-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Couche JIRA partagée NATHAN : client, conventions, types, mapping.",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "dotenv": "^16.4.5" },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "typescript": "^5.5.0",
    "vitest": "^1.6.0"
  }
}
```

> `"prepare"` est volontairement absent ici : `npm install` déclencherait le build avant
> que `src/` existe. Il sera ajouté explicitement en Step 4.2.

- [ ] **Step 1.2 : `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 1.3 : `tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "declaration": true, "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 1.4 : `vitest.config.ts`, `tests/setup.ts`, `.gitignore`**

`vitest.config.ts` :
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { setupFiles: ['./tests/setup.ts'] } });
```

`tests/setup.ts` (copié verbatim de `../NATHAN-gestion/tests/setup.ts`) :
```ts
const NO_BODY_STATUSES = new Set([204, 205, 304]);
const OrigResponse = globalThis.Response;
class PatchedResponse extends OrigResponse {
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    if (NO_BODY_STATUSES.has(init?.status ?? 200) && body !== null && body !== undefined) {
      super(null, init);
    } else {
      super(body, init);
    }
  }
}
// @ts-ignore — intentional patch of the global
globalThis.Response = PatchedResponse;
```

`.gitignore` :
```
node_modules/
dist/
.env
data/cycle/
```

- [ ] **Step 1.5 : `npm install`** (avec `prepare` temporairement retiré)

```bash
npm install
```
Attendu : `node_modules/` créé, pas d'erreur.

- [ ] **Step 1.6 : `src/types.ts`** — copier verbatim `../NATHAN-gestion/src/types.ts` (aucun import relatif, aucune modif).

- [ ] **Step 1.7 : test `tests/mapping.test.ts`** — copier `../NATHAN-gestion/tests/mapping.test.ts`, imports en `.js` :
```ts
import { sessionFromDate, statusInfo, computeOrder, findOrphanDeps, hasCycle } from '../src/mapping.js';
import type { Task } from '../src/types.js';
```

- [ ] **Step 1.8 : voir le test échouer** — `npx vitest run tests/mapping.test.ts` → FAIL (`Cannot find module '../src/mapping.js'`).

- [ ] **Step 1.9 : `src/mapping.ts`** — copier `../NATHAN-gestion/src/mapping.ts`, 1re ligne :
```ts
import type { Task, StatusCategory } from './types.js';
```
(reste inchangé : `SESSIONS`, `sessionFromDate`, `STATUS_TABLE`, `statusInfo`, `computeOrder`, `findOrphanDeps`, `hasCycle`.)

- [ ] **Step 1.10 : voir le test passer** — `npx vitest run tests/mapping.test.ts` → PASS.

- [ ] **Step 1.11 : commit initial (repo vide) + push main**

```bash
git add -A
git commit -m "feat: scaffold nathan-jira-core + couche pure (types, mapping)"
git branch -M main
git push -u origin main
git checkout -b feat/phase0-connexion
```

---

### Task 2 — Module `config`

**Fichiers :** Créer `src/config.ts`, `.env.example` ; Test `tests/config.test.ts`

- [ ] **Step 2.1 : test `tests/config.test.ts`** (import `.js`)

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

const full = {
  JIRA_BASE_URL: 'https://x.atlassian.net/',
  JIRA_EMAIL: 'a@b.c',
  JIRA_API_TOKEN: 'tok',
  JIRA_PROJECT_KEY: 'NATHAN',
};

describe('loadConfig', () => {
  it('charge une config complète et retire le slash final', () => {
    const c = loadConfig(full);
    expect(c.baseUrl).toBe('https://x.atlassian.net');
    expect(c.projectKey).toBe('NATHAN');
    expect(c.issueType).toBe('Task');
  });
  it('lève si une variable manque', () => {
    expect(() => loadConfig({ ...full, JIRA_API_TOKEN: '' })).toThrow(/JIRA_API_TOKEN/);
  });
});
```

- [ ] **Step 2.2 : voir échouer** — `npx vitest run tests/config.test.ts` → FAIL.

- [ ] **Step 2.3 : `src/config.ts`** (import `.js`)

```ts
import 'dotenv/config';
import type { Config } from './types.js';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT_KEY'] as const;
  const missing = required.filter((k) => !env[k] || env[k]!.trim() === '');
  if (missing.length) {
    throw new Error(`Variables d'environnement manquantes : ${missing.join(', ')}. Voir .env.example`);
  }
  return {
    baseUrl: env.JIRA_BASE_URL!.replace(/\/+$/, ''),
    email: env.JIRA_EMAIL!.trim(),
    apiToken: env.JIRA_API_TOKEN!.trim(),
    projectKey: env.JIRA_PROJECT_KEY!.trim(),
    issueType: (env.JIRA_ISSUE_TYPE && env.JIRA_ISSUE_TYPE.trim()) || 'Task',
  };
}
```

- [ ] **Step 2.4 : `.env.example`**

```
JIRA_BASE_URL=https://ton-site.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=ton_jeton_api_atlassian
JIRA_PROJECT_KEY=NATHAN
JIRA_ISSUE_TYPE=Task
```

- [ ] **Step 2.5 : voir passer** — `npx vitest run tests/config.test.ts` → PASS.

- [ ] **Step 2.6 : commit** — `git add -A && git commit -m "feat: loadConfig + .env.example"`

---

### Task 3 — `JiraClient`

**Fichiers :** Créer `src/jira-client.ts` ; Test `tests/jira-client.test.ts`

- [ ] **Step 3.1 : test `tests/jira-client.test.ts`** — copier verbatim `../NATHAN-gestion/tests/jira-client.test.ts`, imports en `.js` :
```ts
import { JiraClient } from '../src/jira-client.js';
import type { Config } from '../src/types.js';
```
(les 4 describe — `fetchNathanIssues`, `fetchPlanData`, `init (champ date)`, `createIssue` — inchangés.)

- [ ] **Step 3.2 : voir échouer** — `npx vitest run tests/jira-client.test.ts` → FAIL.

- [ ] **Step 3.3 : `src/jira-client.ts`** — copier verbatim `../NATHAN-gestion/src/jira-client.ts`, seules les 2 premières lignes changent :
```ts
import type { Config, Task, StatusCategory } from './types.js';
import { statusInfo } from './mapping.js';
```
(tout le corps inchangé : `RawIssue`, `SeedClient`, `textToAdf`, `adfToText`, `roleLabel`, classe `JiraClient`.)

- [ ] **Step 3.4 : voir passer** — `npx vitest run tests/jira-client.test.ts` → PASS.

- [ ] **Step 3.5 : suite complète** — `npm test` → mapping + config + jira-client, 0 échec.

- [ ] **Step 3.6 : commit** — `git add -A && git commit -m "feat: JiraClient (fetch + mapping ADF) porté avec ses tests"`

---

### Task 4 — Barrel public `index.ts` + build

**Fichiers :** Créer `src/index.ts` ; Modifier `package.json` (réactiver `prepare`)

- [ ] **Step 4.1 : `src/index.ts`**

```ts
export { JiraClient } from './jira-client.js';
export type { SeedClient } from './jira-client.js';
export { loadConfig } from './config.js';
export { sessionFromDate, statusInfo, computeOrder, findOrphanDeps, hasCycle } from './mapping.js';
export type { Task, Config, StatusCategory, PlanFieldDiff, PlanItem, SeedPlan } from './types.js';
```

- [ ] **Step 4.2 : ajouter `prepare` dans `package.json`**

```bash
npm pkg set scripts.prepare="npm run build"
```
Vérification : `cat package.json | grep prepare` doit afficher `"prepare": "npm run build"`.

- [ ] **Step 4.3 : build** — `npm run build` → `dist/` avec `index.js`, `*.js` et `*.d.ts`, sans erreur.

- [ ] **Step 4.4 : vérif Node nu (valide la résolution `.js`)**

```bash
node -e "import('./dist/index.js').then(m => console.log(Object.keys(m).sort().join(',')))"
```
Attendu : `JiraClient,computeOrder,findOrphanDeps,hasCycle,loadConfig,sessionFromDate,statusInfo` (sans `ERR_MODULE_NOT_FOUND`).

- [ ] **Step 4.5 : typecheck** — `npm run typecheck` → aucune erreur.

- [ ] **Step 4.6 : commit** — `git add -A && git commit -m "feat: barrel public index.ts + build dist (prepare)"`

---

### Task 5 — README + portes finales + PR

**Fichiers :** Créer `README.md`

- [ ] **Step 5.1 : `README.md`**

```markdown
# nathan-jira-core

Couche JIRA partagée des projets NATHAN : client REST, conventions (`nid-`, `role-`),
types et mapping. Consommé en git dependency par NATHAN-gestion et NATHAN-web.
Repo : `A-World-Felt/NATHAN-jira-package` (privé). Package npm : `nathan-jira-core`.

## Surface publique
`JiraClient`, `loadConfig`, `sessionFromDate`, `statusInfo`, `computeOrder`,
`findOrphanDeps`, `hasCycle` + types (`Task`, `Config`, …).

## Dev
- `npm test` — Vitest
- `npm run build` — émet `dist/`
- `npm run typecheck`

## Consommation (git dependency privée)
```bash
npm i github:A-World-Felt/NATHAN-jira-package#<commit-sha>
```
Les consommateurs publics (NATHAN-web sur Cloudflare Pages) fournissent un token de lecture pour cloner
ce repo privé au build.
```

- [ ] **Step 5.2 : portes** — `npm test` ; `npm run typecheck` ; `npm run build`. Toutes vertes.

- [ ] **Step 5.3 : commit + push + PR**

```bash
git add -A && git commit -m "docs: README"
git push -u origin feat/phase0-connexion
gh pr create --base main --title "feat: Phase 0 — couche connexion JIRA" --body "Voir docs/plans/2026-06-29-phase0-core-plan.md"
```

---

## Auto-revue (researcher)

- Couverture : repo privé existant ✅ ; client/config/types/mapping portés ✅ (Tasks 1-3) ;
  `prepare`+dist ✅ (Task 4) ; tests portés ✅. Conforme au design Phase 0.
- Placeholders : aucun (code complet à chaque step).
- Cohérence : signatures du barrel (Task 4) == produites par Tasks 1-3.
- Hors périmètre : écriture gardée/snapshot/restore, skill/agent, MCP, plugin, refactor gestion,
  route web → phases suivantes.
