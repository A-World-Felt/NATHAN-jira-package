# Assignation, estimation, sous-tâches sur update — Plan d'implémentation

**Objectif :** combler dans `@a-world-felt/nathan-jira-core` (dépôt
`NATHAN-jira-package`, actuellement v1.1.0) les trois lacunes qui bloquent
l'application de `NATHAN-gestion/data/jira-changes/2026-07-21-refonte-ai-pr.json`
(déjà écrit, en attente, dont `meta.notes` dit littéralement : *« Requiert
nathan-jira-core > 1.1.0 : champs assignee, estimateHours, et subtasks sur
update »*) : assignation (avec désassignation explicite), pose d'estimation
(time-tracking ACTIF sur l'instance depuis le 2026-07-07 — voir Constat A
ci-dessous), et création de sous-tâches sous une tâche **existante** via
`update`. Additif, rétrocompatible : aucun champ requis, aucune signature
existante cassée.

**Dépôt de travail :** `C:\Users\arthu\OneDrive - USherbrooke\Universite\Udes\PMC\NATHAN-jira-package`
(dépôt séparé de `NATHAN-gestion` — pas un worktree, mais aucun autre agent n'y
travaille en ce moment ; vérifier `git status` avant de commencer par prudence).
**Branche :** `feat/assignee-estimate-subtasks`

---

## Constats de vérification (avant de figer le design)

Vérifiés **en lecture seule** contre l'instance réelle (`nathan-pmc.atlassian.net`,
`.env` de `NATHAN-gestion`) le 2026-07-21 :

**Constat A — le time-tracking EST actif, `docs/CONVENTIONS-JIRA.md` §4 est
PÉRIMÉ.** `GET /rest/api/3/issue/LIVS-1?fields=timetracking` renvoie déjà
`{"originalEstimate":"30m","originalEstimateSeconds":1800,...}` — une
estimation de 0,5 h existe et a été acceptée par l'instance. `GET
/rest/api/3/issue/LIVS-1/editmeta` confirme `fields.timetracking.operations =
["set","edit"]` (champ éditable, pas bloqué). La phrase de
`docs/CONVENTIONS-JIRA.md` (« Time-tracking désactivé : ne jamais poser
d'estimation, sinon HTTP 400 ») ainsi que le commentaire
`src/jira-write.ts:106` (« NOTE : pas de timetracking à la création
(time-tracking désactivé → HTTP 400) ») sont **obsolètes** — à corriger
dans le code (Task 2) ; la correction de `CONVENTIONS-JIRA.md` reste dans
`NATHAN-gestion`, **hors périmètre de ce plan** (à signaler séparément).

**Constat B — format de durée attendu : unités ENTIÈRES composées, PAS de
décimale.** La lecture ci-dessus montre que JIRA restitue 0,5 h comme `"30m"`,
pas `"0.5h"`. Tentative de vérification par écriture réelle **bloquée par le
classifieur auto-mode de l'environnement** (écriture de test sur une issue de
production refusée par sécurité — comportement correct, je ne l'ai pas
contournée). Donc : pas de confirmation empirique directe du rejet des
décimales en écriture, mais **deux signaux convergents** : (1) le format de
lecture canonique de JIRA est en minutes pour les sous-heures, ce qui est un
indice fort que le format d'écriture attendu est le même (JIRA vise un
round-trip lecture/écriture cohérent sur ce champ) ; (2) c'est un
comportement JIRA documenté de longue date (grammaire de durée `Xw Yd Zh Wm`,
composants entiers uniquement — JIRA rejette les décimales avec un message
d'erreur explicite recommandant la conversion, ex. `"1h 30m"` plutôt que
`"1.5h"`). **Décision de design : émettre systématiquement le format entier
composé** (`hoursToJiraDuration`, Task 3), jamais de décimale — c'est le choix
sûr indépendamment de la question « les décimales marchent-elles aussi ».
Le fichier de changements réel à appliquer contient `estimateHours: 10.5` et
`estimateHours: 0.5` (`DEV-195`, `PR3-CONC`) : `hoursToJiraDuration` doit les
gérer explicitement (`10.5` → `"10h 30m"`, `0.5` → `"30m"`).
**Risque résiduel signalé à l'humain** : la Task 3 inclut une étape de
vérification manuelle (une seule écriture réelle, réversible, sur une issue
de test) à faire **avant publication**, gardée par l'humain — voir Task 3
Step 3.5.

**Constat C — résolution nom → `accountId`.** Deux options envisagées :
- *Dérivation depuis le snapshot* : rejetée. `RawIssue.assignee`
  (`src/snapshot.ts:153`, `f.assignee?.displayName`) ne capture **que** le nom
  d'affichage, jamais l'`accountId` — il faudrait d'abord modifier
  `fetchFullSnapshot` pour capturer `f.assignee?.accountId`, et ça ne
  résoudrait pas le cas d'une personne qui n'a **encore jamais** d'issue
  assignée dans l'instance (ex. un nouveau membre) ni la désassignation (pas
  besoin d'`accountId` pour désassigner).
- *`GET /rest/api/3/user/search?query=<nom>`* : **retenue**. Vérifié en
  lecture réelle : `query=Arthur` renvoie 1 correspondance humaine
  (`accountId: "712020:4bcf85a6-..."`, `displayName: "Arthur-Olivier Fortin"`,
  `accountType: "atlassian"`, `active: true`) parmi les comptes ; une requête
  large (`query=a`) renvoie aussi des comptes `accountType: "app"` (bots,
  intégrations) qu'il faut explicitement exclure. `query=` avec le nom
  d'affichage complet exact (`"Arthur-Olivier Fortin"`, `"Mathieu Nicol"`)
  renvoie exactement 1 résultat filtré. Design : filtrer
  `accountType === 'atlassian' && active === true && displayName` égal
  (insensible à la casse) au nom demandé ; 0 résultat → erreur explicite
  (« introuvable ») ; >1 résultat → erreur explicite (« ambigu ») — jamais de
  résolution silencieuse au premier résultat. **Cache** `Map<string,string>`
  local à chaque appel d'`applyChanges`, pour ne pas rappeler l'API par
  occurrence du même nom dans un changeset (le fichier réel en attente
  répète `"Arthur-Olivier Fortin"` 8 fois).

**Constat D — `null` vs `undefined`, la distinction qui compte.** Le fichier
de changements réel contient exactement 9 occurrences de `"assignee": null`
au niveau `update` (`DEV-197`, `DEV-198`, `DEV-204`, `DEV-205`, `DEV-199`,
`DEV-193`, `DEV-201`, `DEV-203`, `DEV-192`) plus 3 au niveau `subtasks`
(`PR2-REVU`, `PR3-REVU`, `PR4-REVU`) — la désassignation explicite est donc
un cas d'usage réel et majoritaire du fichier en attente, pas un cas de
bord théorique. `assignee` **absent** (`undefined`) doit laisser le champ
JIRA inchangé ; `assignee: null` doit désassigner ; `assignee: "Nom"` doit
résoudre et assigner. Toutes les fonctions ajoutées respectent
`!== undefined` (agir) vs `undefined` (ignorer) vs `=== null` (effacer).
Même logique pour `estimateHours` (0 occurrence de `null` dans le fichier
réel, mais le type l'autorise pour symétrie et pour permettre d'effacer une
estimation existante plus tard).

---

### Task 0 — Aucune (le runner de test existe déjà)

`vitest` est déjà en devDependency, `npm test` = `vitest run` (voir
`package.json`). Pas de Task 0 de configuration nécessaire.

---

### Task 1 — `hoursToJiraDuration` : conversion pure heures → durée JIRA

Fonction pure, testable sans mock réseau — base de tout ce qui suit.

**Fichiers :**
- Modifier : `src/jira-write.ts` (ajout en fin de section Helpers, après `isRealJiraKey`, avant la section « Primitives d'écriture bas-niveau »)
- Test : `tests/jira-write.test.ts` (nouveau bloc `describe`, avant `describe('createEpic', ...)`)

- [ ] **Step 1.1 : Écrire le test qui échoue**

Ajouter dans `tests/jira-write.test.ts`, juste après les imports (ligne 19) et
avant `describe('isRealJiraKey', ...)` (ligne 69) :

```ts
// ---------------------------------------------------------------------------
// hoursToJiraDuration — conversion pure heures → durée JIRA (unités entières)
// ---------------------------------------------------------------------------

describe('hoursToJiraDuration', () => {
  it('heure entière → "Xh"', () => {
    expect(hoursToJiraDuration(3)).toBe('3h');
  });
  it('demi-heure seule → "30m" (jamais de décimale)', () => {
    expect(hoursToJiraDuration(0.5)).toBe('30m');
  });
  it('heures + demi-heure composées → "Xh 30m"', () => {
    expect(hoursToJiraDuration(2.5)).toBe('2h 30m');
    expect(hoursToJiraDuration(10.5)).toBe('10h 30m');
  });
  it('quart d\'heure → minutes exactes', () => {
    expect(hoursToJiraDuration(1.25)).toBe('1h 15m');
  });
  it('ne produit jamais de point décimal dans la sortie', () => {
    expect(hoursToJiraDuration(0.5)).not.toMatch(/\./);
    expect(hoursToJiraDuration(10.5)).not.toMatch(/\./);
  });
});
```

Et remplacer l'import en tête de fichier (ligne 8-19) pour inclure la
nouvelle fonction :

```ts
import {
  isRealJiraKey,
  hoursToJiraDuration,
  createEpic,
  createTask,
  transitionTo,
  linkDep,
  restructureOriginal,
  deleteIssue,
  carryStatusThenDelete,
  createRisk,
  type JiraWriteClient,
} from '../src/jira-write.js';
```

- [ ] **Step 1.2 : Lancer le test, le voir échouer**

```bash
npx vitest run tests/jira-write.test.ts -t hoursToJiraDuration
```
Attendu : FAIL — `SyntaxError` ou `TypeError: hoursToJiraDuration is not a function` (l'export n'existe pas encore dans `src/jira-write.ts`).

- [ ] **Step 1.3 : Implémenter le minimum**

Dans `src/jira-write.ts`, insérer juste après `isRealJiraKey` (après la ligne
48, avant le commentaire `// Primitives d'écriture bas-niveau` ligne 50) :

```ts
/**
 * Convertit des heures (fractions de 0,5 h incluses) en chaîne de durée JIRA
 * en UNITÉS ENTIÈRES composées (ex. "2h 30m"). JIRA rejette les décimales
 * dans les champs de durée (`originalEstimate`) — voir docs/plans/
 * 2026-07-21-assignee-estimate-subtasks-plan.md, Constat B. Jamais de "1.5h" :
 * toujours "1h 30m".
 */
export function hoursToJiraDuration(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}
```

- [ ] **Step 1.4 : Lancer le test, le voir passer**

```bash
npx vitest run tests/jira-write.test.ts -t hoursToJiraDuration
```
Attendu : PASS (5 tests).

- [ ] **Step 1.5 : Commit**

```bash
git add src/jira-write.ts tests/jira-write.test.ts
git commit -m "feat(jira-write): hoursToJiraDuration — conversion pure heures vers duree JIRA (unites entieres)"
```

---

### Task 2 — `resolveAccountId` : résolution nom d'affichage → `accountId`

**Fichiers :**
- Modifier : `src/jira-write.ts`
- Test : `tests/jira-write.test.ts`

- [ ] **Step 2.1 : Écrire le test qui échoue**

Ajouter dans `tests/jira-write.test.ts`, après le bloc `createSubtask` (fin de
fichier, après la ligne 372) :

```ts
// ---------------------------------------------------------------------------
// resolveAccountId — nom d'affichage → accountId (cache + erreurs explicites)
// ---------------------------------------------------------------------------

import { resolveAccountId } from '../src/jira-write.js';

function makeUserSearchClient(
  responses: Record<string, Array<{ accountId: string; displayName: string; accountType: string; active: boolean }>>,
): JiraWriteClient & { calls: string[] } {
  const calls: string[] = [];
  const fetchFn: typeof fetch = async (input) => {
    const url = input.toString();
    calls.push(url);
    const q = new URL(url).searchParams.get('query') ?? '';
    const body = responses[q] ?? [];
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { baseUrl: 'https://fake.atlassian.net', authHeader: 'Basic fake=', startFieldId: null, fetchFn, calls };
}

describe('resolveAccountId', () => {
  it('renvoie l\'accountId sur correspondance unique', async () => {
    const client = makeUserSearchClient({
      'Arthur-Olivier Fortin': [
        { accountId: '712020:abc', displayName: 'Arthur-Olivier Fortin', accountType: 'atlassian', active: true },
      ],
    });
    const id = await resolveAccountId(client, 'Arthur-Olivier Fortin');
    expect(id).toBe('712020:abc');
  });

  it('exclut les comptes non-humains (accountType app/bot)', async () => {
    const client = makeUserSearchClient({
      'Mathieu Nicol': [
        { accountId: 'app-1', displayName: 'Mathieu Nicol Bot', accountType: 'app', active: true },
        { accountId: '712020:xyz', displayName: 'Mathieu Nicol', accountType: 'atlassian', active: true },
      ],
    });
    const id = await resolveAccountId(client, 'Mathieu Nicol');
    expect(id).toBe('712020:xyz');
  });

  it('lève une erreur explicite si 0 correspondance (introuvable)', async () => {
    const client = makeUserSearchClient({ 'Nom Inconnu': [] });
    await expect(resolveAccountId(client, 'Nom Inconnu')).rejects.toThrow(/introuvable/);
  });

  it('lève une erreur explicite si plusieurs correspondances (ambigu)', async () => {
    const client = makeUserSearchClient({
      'Alex Roy': [
        { accountId: 'a1', displayName: 'Alex Roy', accountType: 'atlassian', active: true },
        { accountId: 'a2', displayName: 'Alex Roy', accountType: 'atlassian', active: true },
      ],
    });
    await expect(resolveAccountId(client, 'Alex Roy')).rejects.toThrow(/ambigu/);
  });

  it('met en cache : un seul appel réseau pour deux résolutions du même nom', async () => {
    const client = makeUserSearchClient({
      'Arthur-Olivier Fortin': [
        { accountId: '712020:abc', displayName: 'Arthur-Olivier Fortin', accountType: 'atlassian', active: true },
      ],
    });
    const cache = new Map<string, string>();
    await resolveAccountId(client, 'Arthur-Olivier Fortin', cache);
    await resolveAccountId(client, 'Arthur-Olivier Fortin', cache);
    expect(client.calls).toHaveLength(1);
  });
});
```

- [ ] **Step 2.2 : Lancer le test, le voir échouer**

```bash
npx vitest run tests/jira-write.test.ts -t resolveAccountId
```
Attendu : FAIL — `resolveAccountId is not a function`.

- [ ] **Step 2.3 : Implémenter le minimum**

Dans `src/jira-write.ts`, ajouter après `hoursToJiraDuration` (fin de la
section Helpers, avant `// Primitives d'écriture bas-niveau`) :

```ts
interface JiraUserSearchResult {
  accountId: string;
  displayName: string;
  accountType: string;
  active: boolean;
}

/**
 * Résout un nom d'affichage JIRA vers son `accountId` (API v3 attend un
 * accountId, pas un displayName — voir docs/plans/
 * 2026-07-21-assignee-estimate-subtasks-plan.md, Constat C).
 * GET /rest/api/3/user/search?query=<nom>, filtré aux comptes humains actifs
 * dont le displayName correspond exactement (insensible à la casse).
 * `cache` évite un appel réseau par occurrence du même nom dans un changeset.
 * Lève une erreur explicite si 0 correspondance ou plusieurs (jamais de
 * résolution silencieuse au premier résultat).
 */
export async function resolveAccountId(
  client: JiraWriteClient,
  displayName: string,
  cache: Map<string, string> = new Map(),
): Promise<string> {
  const cached = cache.get(displayName);
  if (cached) return cached;

  const res = await client.fetchFn(
    `${client.baseUrl}/rest/api/3/user/search?query=${encodeURIComponent(displayName)}`,
    { headers: buildHeaders(client) },
  );
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`resolveAccountId("${displayName}") HTTP ${res.status}: ${text}`);
  }
  const users: JiraUserSearchResult[] = await res.json();
  const matches = users.filter(
    (u) => u.accountType === 'atlassian' && u.active && norm(u.displayName) === norm(displayName),
  );
  if (matches.length === 0) {
    throw new Error(`resolveAccountId("${displayName}") : introuvable — aucun compte JIRA actif avec ce nom exact.`);
  }
  if (matches.length > 1) {
    const ids = matches.map((m) => m.accountId).join(', ');
    throw new Error(`resolveAccountId("${displayName}") : ambigu — ${matches.length} correspondances (${ids}).`);
  }
  const accountId = matches[0].accountId;
  cache.set(displayName, accountId);
  return accountId;
}
```

- [ ] **Step 2.4 : Lancer le test, le voir passer**

```bash
npx vitest run tests/jira-write.test.ts -t resolveAccountId
```
Attendu : PASS (5 tests).

- [ ] **Step 2.5 : Commit**

```bash
git add src/jira-write.ts tests/jira-write.test.ts
git commit -m "feat(jira-write): resolveAccountId — resolution nom vers accountId, cache, erreurs explicites"
```

---

### Task 3 — `setAssignee` et `setEstimate` : primitives sur issue existante

**Fichiers :**
- Modifier : `src/jira-write.ts`
- Test : `tests/jira-write.test.ts`

- [ ] **Step 3.1 : Écrire le test qui échoue**

Ajouter dans `tests/jira-write.test.ts`, après le bloc `describe('resolveAccountId', ...)` :

```ts
// ---------------------------------------------------------------------------
// setAssignee — PUT assignee (accountId ou null pour désassigner)
// ---------------------------------------------------------------------------

import { setAssignee, setEstimate } from '../src/jira-write.js';

describe('setAssignee', () => {
  it('PUT fields.assignee.accountId quand accountId fourni', async () => {
    const client = makeFakeClient([
      { method: 'PUT', urlPart: 'rest/api/3/issue/DEV-191', status: 204, body: '' },
    ]);
    await setAssignee(client, 'DEV-191', '712020:abc');
    const f = client.calls[0].body.fields;
    expect(f.assignee).toEqual({ accountId: '712020:abc' });
  });

  it('PUT fields.assignee = null quand accountId === null (désassigne)', async () => {
    const client = makeFakeClient([
      { method: 'PUT', urlPart: 'rest/api/3/issue/DEV-197', status: 204, body: '' },
    ]);
    await setAssignee(client, 'DEV-197', null);
    const f = client.calls[0].body.fields;
    expect(f.assignee).toBeNull();
  });

  it('lève sur HTTP 400', async () => {
    const client = makeFakeClient([
      { method: 'PUT', urlPart: 'rest/api/3/issue/DEV-1', status: 400, body: { errorMessages: ['bad'] } },
    ]);
    await expect(setAssignee(client, 'DEV-1', '712020:abc')).rejects.toThrow(/400/);
  });
});

// ---------------------------------------------------------------------------
// setEstimate — PUT timetracking.originalEstimate (unités entières)
// ---------------------------------------------------------------------------

describe('setEstimate', () => {
  it('PUT timetracking.originalEstimate au format entier composé', async () => {
    const client = makeFakeClient([
      { method: 'PUT', urlPart: 'rest/api/3/issue/DEV-195', status: 204, body: '' },
    ]);
    await setEstimate(client, 'DEV-195', 10.5);
    const f = client.calls[0].body.fields;
    expect(f.timetracking).toEqual({ originalEstimate: '10h 30m' });
  });

  it('demi-heure seule → "30m"', async () => {
    const client = makeFakeClient([
      { method: 'PUT', urlPart: 'rest/api/3/issue/DEV-196', status: 204, body: '' },
    ]);
    await setEstimate(client, 'DEV-196', 0.5);
    expect(client.calls[0].body.fields.timetracking).toEqual({ originalEstimate: '30m' });
  });

  it('hours === null → efface l\'estimation (timetracking: {})', async () => {
    const client = makeFakeClient([
      { method: 'PUT', urlPart: 'rest/api/3/issue/DEV-1', status: 204, body: '' },
    ]);
    await setEstimate(client, 'DEV-1', null);
    expect(client.calls[0].body.fields.timetracking).toEqual({});
  });

  it('lève sur HTTP 400', async () => {
    const client = makeFakeClient([
      { method: 'PUT', urlPart: 'rest/api/3/issue/DEV-1', status: 400, body: { errorMessages: ['bad'] } },
    ]);
    await expect(setEstimate(client, 'DEV-1', 3)).rejects.toThrow(/400/);
  });
});
```

- [ ] **Step 3.2 : Lancer le test, le voir échouer**

```bash
npx vitest run tests/jira-write.test.ts -t "setAssignee|setEstimate"
```
Attendu : FAIL — `setAssignee is not a function`.

- [ ] **Step 3.3 : Implémenter le minimum**

Dans `src/jira-write.ts`, ajouter deux nouvelles primitives juste après
`restructureOriginal` (après la ligne 285, avant `deleteIssue`) :

```ts
/**
 * Assigne une issue existante à `accountId`, ou la DÉSASSIGNE si
 * `accountId === null`. Ne PAS confondre avec "ne pas toucher" : ce cas
 * n'existe pas ici — l'appelant ne doit appeler setAssignee que quand un
 * changement est explicitement demandé (voir applyChanges, Task 5).
 * PUT /rest/api/3/issue/{key}  { fields: { assignee: { accountId } | null } }.
 */
export async function setAssignee(
  client: JiraWriteClient,
  key: string,
  accountId: string | null,
): Promise<void> {
  const res = await client.fetchFn(`${client.baseUrl}/rest/api/3/issue/${key}`, {
    method: 'PUT',
    headers: buildHeaders(client),
    body: JSON.stringify({ fields: { assignee: accountId ? { accountId } : null } }),
  });
  if (!res.ok && res.status !== 204) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`setAssignee(${key}) HTTP ${res.status}: ${text}`);
  }
}

/**
 * Pose l'estimation originale d'une issue existante. `hours === null` efface
 * l'estimation (`timetracking: {}`). `hours` est converti en unités entières
 * via hoursToJiraDuration — JAMAIS de décimale envoyée à JIRA (Constat B).
 * PUT /rest/api/3/issue/{key}  { fields: { timetracking: {...} } }.
 */
export async function setEstimate(
  client: JiraWriteClient,
  key: string,
  hours: number | null,
): Promise<void> {
  const timetracking = hours === null ? {} : { originalEstimate: hoursToJiraDuration(hours) };
  const res = await client.fetchFn(`${client.baseUrl}/rest/api/3/issue/${key}`, {
    method: 'PUT',
    headers: buildHeaders(client),
    body: JSON.stringify({ fields: { timetracking } }),
  });
  if (!res.ok && res.status !== 204) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`setEstimate(${key}) HTTP ${res.status}: ${text}`);
  }
}
```

- [ ] **Step 3.4 : Lancer le test, le voir passer**

```bash
npx vitest run tests/jira-write.test.ts -t "setAssignee|setEstimate"
```
Attendu : PASS (7 tests).

- [ ] **Step 3.5 : Vérification manuelle (humaine, gardée) — À FAIRE AVANT PUBLICATION, PAS PENDANT CE TDD**

Cette étape n'est **pas** automatisée et **pas** exécutée par le builder : elle
documente le risque résiduel du Constat B pour l'humain qui validera la
publication. Avant de merger/publier, faire **une seule** vérification réelle
et réversible :
1. Choisir une issue de test (jamais une issue réelle du plan de projet).
2. `PUT` son `timetracking.originalEstimate` avec une valeur produite par
   `hoursToJiraDuration` (ex. `"2h 30m"`), vérifier HTTP 200/204.
3. `GET` relire la valeur, confirmer qu'elle correspond.
4. Remettre l'issue de test dans son état d'origine (ou la supprimer si créée
   pour l'occasion).
Si cette vérification échoue (HTTP 400), le format à corriger dans
`hoursToJiraDuration` avant publication — ne PAS publier sans ce test passé
au moins une fois contre l'instance réelle.

- [ ] **Step 3.6 : Commit**

```bash
git add src/jira-write.ts tests/jira-write.test.ts
git commit -m "feat(jira-write): setAssignee/setEstimate — primitives sur issue existante (desassignation via null)"
```

---

### Task 4 — `createTask`/`createSubtask` acceptent assignee + estimation à la création

Signatures étendues de façon **additive** (paramètre `opts` optionnel en fin
de liste) : tous les appels existants (positionnels, 7 arguments pour
`createTask`) continuent de fonctionner sans modification.

**Fichiers :**
- Modifier : `src/jira-write.ts`
- Test : `tests/jira-write.test.ts`

- [ ] **Step 4.1 : Écrire le test qui échoue**

Ajouter dans `tests/jira-write.test.ts`, à l'intérieur du `describe('createTask', ...)`
existant (après le test `'ne pose JAMAIS timetracking (time-tracking off)'`,
ligne 136-142) — **et corriger le nom de ce test existant** puisque
l'affirmation « time-tracking off » est fausse (Constat A) :

D'abord, remplacer (ligne 136-142) :

```ts
  it('ne pose JAMAIS timetracking (time-tracking off)', async () => {
    const client = makeFakeClient([
      { method: 'POST', urlPart: 'rest/api/3/issue', status: 201, body: { key: 'LIVS-202' } },
    ]);
    await createTask(client, 'LIVS', 'X', 'LIVS-100', null, null, []);
    expect(client.calls[0].body.fields.timetracking).toBeUndefined();
  });
```

par :

```ts
  it('ne pose PAS timetracking quand aucune estimation n\'est fournie (opts omis)', async () => {
    const client = makeFakeClient([
      { method: 'POST', urlPart: 'rest/api/3/issue', status: 201, body: { key: 'LIVS-202' } },
    ]);
    await createTask(client, 'LIVS', 'X', 'LIVS-100', null, null, []);
    expect(client.calls[0].body.fields.timetracking).toBeUndefined();
    expect(client.calls[0].body.fields.assignee).toBeUndefined();
  });

  it('pose timetracking (unités entières) et assignee.accountId quand opts fournis', async () => {
    const client = makeFakeClient([
      { method: 'POST', urlPart: 'rest/api/3/issue', status: 201, body: { key: 'LIVS-203' } },
    ]);
    await createTask(client, 'LIVS', 'X', 'LIVS-100', null, null, [], {
      accountId: '712020:abc', estimateHours: 2.5,
    });
    const f = client.calls[0].body.fields;
    expect(f.timetracking).toEqual({ originalEstimate: '2h 30m' });
    expect(f.assignee).toEqual({ accountId: '712020:abc' });
  });

  it('opts.accountId === null pose fields.assignee = null (désassignation explicite à la création)', async () => {
    const client = makeFakeClient([
      { method: 'POST', urlPart: 'rest/api/3/issue', status: 201, body: { key: 'LIVS-204' } },
    ]);
    await createTask(client, 'LIVS', 'X', 'LIVS-100', null, null, [], { accountId: null });
    expect(client.calls[0].body.fields.assignee).toBeNull();
  });
```

Puis, dans le `describe('createSubtask', ...)` existant (après la ligne 361,
avant le test `'throws on HTTP 400'`), ajouter :

```ts
  it('accepte assignee et estimateHours dans le paramètre fields', async () => {
    const client = makeFakeClient([
      { method: 'POST', urlPart: '/issue', status: 201, body: { key: 'GES-43' } },
    ]);
    await createSubtask(client, 'GES', 'Revue de PR', 'GES-10', {
      accountId: '712020:abc', estimateHours: 1,
    });
    const f = client.calls[0].body.fields;
    expect(f.timetracking).toEqual({ originalEstimate: '1h' });
    expect(f.assignee).toEqual({ accountId: '712020:abc' });
  });
```

- [ ] **Step 4.2 : Lancer le test, le voir échouer**

```bash
npx vitest run tests/jira-write.test.ts -t "opts|assignee et estimateHours"
```
Attendu : FAIL — `opts` n'est pas un paramètre accepté par `createTask`/`createSubtask` (TS refusera aussi la compilation : `Expected 7 arguments, but got 8`).

- [ ] **Step 4.3 : Implémenter le minimum**

Dans `src/jira-write.ts`, remplacer la signature et le corps de `createTask`
(lignes 88-119) par :

```ts
/**
 * Crée une Tâche rattachée à un Epic (board team-managed → champ `parent`).
 * POST /rest/api/3/issue  (issuetype Task, parent=epicKey, duedate, start-date,
 * labels, et optionnellement assignee/estimation via `opts`).
 * Renvoie la clé de la tâche créée.
 */
export async function createTask(
  client: JiraWriteClient,
  project: string,
  summary: string,
  epicKey: string,
  start: string | null,
  due: string | null,
  labels: string[],
  opts: { accountId?: string | null; estimateHours?: number | null } = {},
): Promise<string> {
  const fields: Record<string, unknown> = {
    project: { key: project },
    issuetype: { name: 'Task' },
    summary,
    parent: { key: epicKey },
  };
  if (due) fields.duedate = due;
  if (start && client.startFieldId) fields[client.startFieldId] = start;
  if (labels.length > 0) fields.labels = labels;
  if (opts.accountId !== undefined) fields.assignee = opts.accountId ? { accountId: opts.accountId } : null;
  if (opts.estimateHours != null) fields.timetracking = { originalEstimate: hoursToJiraDuration(opts.estimateHours) };

  const res = await client.fetchFn(`${client.baseUrl}/rest/api/3/issue`, {
    method: 'POST',
    headers: buildHeaders(client),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok && res.status !== 201) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`createTask(${project}, "${summary}") HTTP ${res.status}: ${text}`);
  }
  const data: { key: string } = await res.json();
  return data.key;
}
```

Puis remplacer la signature et le corps de `createSubtask` (lignes 126-156) par :

```ts
/**
 * Crée une Sous-tâche rattachée à une Tâche parente.
 * POST /rest/api/3/issue  (issuetype Sous-tâche, parent=parentKey, et
 * optionnellement assignee/estimation via `fields.accountId`/`estimateHours`).
 * Renvoie la clé de la sous-tâche créée.
 */
export async function createSubtask(
  client: JiraWriteClient,
  project: string,
  summary: string,
  parentKey: string,
  fields: { start?: string | null; due?: string | null; labels?: string[]; accountId?: string | null; estimateHours?: number | null },
): Promise<string> {
  const f: Record<string, unknown> = {
    project: { key: project },
    issuetype: { name: 'Sous-tâche' },
    summary,
    parent: { key: parentKey },
  };
  if (fields.due) f.duedate = fields.due;
  if (fields.start && client.startFieldId) f[client.startFieldId] = fields.start;
  if (fields.labels?.length) f.labels = fields.labels;
  if (fields.accountId !== undefined) f.assignee = fields.accountId ? { accountId: fields.accountId } : null;
  if (fields.estimateHours != null) f.timetracking = { originalEstimate: hoursToJiraDuration(fields.estimateHours) };

  const res = await client.fetchFn(`${client.baseUrl}/rest/api/3/issue`, {
    method: 'POST',
    headers: buildHeaders(client),
    body: JSON.stringify({ fields: f }),
  });
  if (!res.ok && res.status !== 201) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(
      `createSubtask(${project}, "${summary}", parent=${parentKey}) HTTP ${res.status}: ${text}`,
    );
  }
  const data: { key: string } = await res.json();
  return data.key;
}
```

Enfin, dans le commentaire de `createTask` original il y avait la ligne
`// NOTE : pas de timetracking à la création (time-tracking désactivé →
HTTP 400).` — elle a été retirée par le remplacement ci-dessus (bloc JSDoc
mis à jour). Vérifier qu'aucune autre occurrence de « time-tracking
désactivé » ne subsiste dans `src/jira-write.ts` :

```bash
grep -rn "time-tracking désactivé\|time-tracking off" src/
```
Attendu : aucune occurrence.

- [ ] **Step 4.4 : Lancer le test, le voir passer**

```bash
npx vitest run tests/jira-write.test.ts
```
Attendu : PASS (tout le fichier — vérifie aussi que les tests existants pour `createTask`/`createSubtask` non modifiés passent toujours avec la nouvelle signature à paramètre optionnel).

- [ ] **Step 4.5 : Commit**

```bash
git add src/jira-write.ts tests/jira-write.test.ts
git commit -m "feat(jira-write): createTask/createSubtask acceptent assignee+estimation a la creation (opts additif)"
```

---

### Task 5 — Types du change-file : `assignee`/`estimateHours`/`subtasks` sur `update`

**Fichiers :**
- Modifier : `src/taches-apply.ts`
- Test : `tests/taches-apply.test.ts`

- [ ] **Step 5.1 : Écrire le test qui échoue**

Ajouter dans `tests/taches-apply.test.ts`, dans le `describe('checkChanges', ...)`
existant (après le test `'détecte un résumé non conforme...'`, ligne 56-63) :

```ts
  it('accepte assignee/estimateHours sur create et update, et subtasks sur update (typage)', () => {
    const cs: ChangeSet = {
      create: [{
        idV2: 'NEW-7', nom: 'X', projet: 'GES', epic: 'GES-66', statutInitial: 'À faire',
        assignee: 'Arthur-Olivier Fortin', estimateHours: 3,
      }],
      update: [{
        ref: 'GES-90', assignee: null, estimateHours: 2.5,
        subtasks: [{ idV2: 'SUB-1', nom: 'Revue', assignee: null, estimateHours: 1 }],
      }],
    };
    // Ce test échoue à la COMPILATION tant que les types ne portent pas ces champs
    // (tsc --noEmit) ; à l'exécution, on vérifie que le comptage les voit.
    const c = checkChanges(cs, idx);
    expect(c.errors).toEqual([]);
    expect(c.subtaskCount).toBe(1);
  });
```

- [ ] **Step 5.2 : Lancer le test, le voir échouer**

```bash
npx vitest run tests/taches-apply.test.ts -t "assignee/estimateHours"
npx tsc --noEmit
```
Attendu : `npx tsc --noEmit` FAIL — `Object literal may only specify known properties, and 'assignee' does not exist in type 'CreateChange'` (et pareil pour `UpdateChange.subtasks`). Le test vitest peut aussi échouer sur `c.subtaskCount` (actuellement 0, car `checkChanges` ne compte pas encore les subtasks d'`update`).

- [ ] **Step 5.3 : Implémenter le minimum**

Dans `src/taches-apply.ts`, remplacer les interfaces `SubtaskChange`,
`CreateChange`, `UpdateChange` (lignes 25-55) par :

```ts
export interface SubtaskChange {
  idV2: string;
  nom: string;
  debut?: string | null;
  fin?: string | null;
  labels?: string[];
  assignee?: string | null;
  estimateHours?: number | null;
}

export interface CreateChange {
  idV2: string;
  nom: string;
  projet: string;
  epic: string;
  statutInitial: string;
  debut?: string | null;
  fin?: string | null;
  labels?: string[];
  dependsOn?: ChangeDep[];
  subtasks?: SubtaskChange[];
  assignee?: string | null;
  estimateHours?: number | null;
}

export interface UpdateChange {
  ref: string;
  statut?: string;
  debut?: string;
  fin?: string;
  summary?: string;
  epic?: string;
  addLabels?: string[];
  dependsOn?: ChangeDep[];
  assignee?: string | null;
  estimateHours?: number | null;
  subtasks?: SubtaskChange[];
}
```

Puis, dans `checkChanges` (lignes 97-148), faire compter les sous-tâches
d'`update` (actuellement seules celles de `create` sont comptées, ligne
112-115). Remplacer la boucle `for (const u of cs.update ?? [])` (lignes
124-136) par :

```ts
  for (const u of cs.update ?? []) {
    const key = idx.keys.has(u.ref) ? u.ref : null;
    if (!key) warnings.push(`UPDATE ${u.ref} : issue introuvable (clé JIRA inconnue).`);
    if (u.epic && !idx.epics.has(u.epic)) warnings.push(`UPDATE ${u.ref} : epic cible ${u.epic} introuvable.`);
    lint(`UPDATE ${u.ref}`, u.summary);
    for (const s of u.subtasks ?? []) {
      subtaskCount++;
      lint(`UPDATE ${u.ref} / sous-tâche ${s.idV2}`, s.nom);
    }
    for (const d of u.dependsOn ?? []) {
      linkCount++;
      const ok = d.existingKey
        ? idx.keys.has(d.ref)
        : (willCreate.has(d.ref) || idx.keys.has(d.ref));
      if (!ok) warnings.push(`UPDATE ${u.ref} : prérequis ${d.ref} non résolu — lien ignoré.`);
    }
  }
```

- [ ] **Step 5.4 : Lancer le test, le voir passer**

```bash
npx tsc --noEmit
npx vitest run tests/taches-apply.test.ts
```
Attendu : PASS (compilation + tous les tests, y compris le nouveau et les 9 existants).

- [ ] **Step 5.5 : Commit**

```bash
git add src/taches-apply.ts tests/taches-apply.test.ts
git commit -m "feat(taches-apply): types assignee/estimateHours (create+update+subtask) et subtasks sur update"
```

---

### Task 6 — `checkChanges`/`dryRun` comptent et affichent assignations, estimations, sous-tâches d'update

**Fichiers :**
- Modifier : `src/taches-apply.ts`
- Test : `tests/taches-apply.test.ts`

- [ ] **Step 6.1 : Écrire le test qui échoue**

Ajouter dans `tests/taches-apply.test.ts`, à la fin du `describe('checkChanges', ...)` :

```ts
  it('compte assigneeCount/estimateCount sur create, update et sous-tâches', () => {
    const cs: ChangeSet = {
      create: [{
        idV2: 'NEW-8', nom: 'X', projet: 'GES', epic: 'GES-66', statutInitial: 'À faire',
        assignee: 'Arthur-Olivier Fortin', estimateHours: 3,
        subtasks: [{ idV2: 'NEW-8-1', nom: 'Sub', assignee: null }],
      }],
      update: [
        { ref: 'GES-90', assignee: null },
        { ref: 'GES-80', estimateHours: 2.5 },
      ],
    };
    const c = checkChanges(cs, idx);
    // assignee : NEW-8 (défini) + NEW-8-1 (défini, null) + GES-90 (défini, null) = 3
    expect(c.assigneeCount).toBe(3);
    // estimateHours : NEW-8 (défini) + GES-80 (défini) = 2
    expect(c.estimateCount).toBe(2);
  });
```

Ajouter aussi, dans le `describe('dryRun', ...)` :

```ts
  it('affiche assignations, estimations et sous-tâches créées via update', () => {
    const cs: ChangeSet = {
      update: [{
        ref: 'GES-90', assignee: null, estimateHours: 2.5,
        subtasks: [{ idV2: 'SUB-2', nom: 'Revue de PR', assignee: null, estimateHours: 1 }],
      }],
    };
    const out = dryRun(cs, idx);
    expect(out).toContain('Assignations');
    expect(out).toContain('Estimations');
    expect(out).toContain('(désassigné)');
    expect(out).toContain('estimation→2.5h');
    expect(out).toContain('SUB-2');
    expect(out).toContain('Revue de PR');
  });
```

- [ ] **Step 6.2 : Lancer le test, le voir échouer**

```bash
npx vitest run tests/taches-apply.test.ts -t "assigneeCount|assignations"
```
Attendu : FAIL — `c.assigneeCount` est `undefined` (`toBe(3)` échoue sur `undefined`), `out` ne contient pas `'Assignations'`.

- [ ] **Step 6.3 : Implémenter le minimum**

Dans `src/taches-apply.ts`, étendre `ChangeCheck` (lignes 87-95) :

```ts
export interface ChangeCheck {
  warnings: string[];
  errors: string[];
  createCount: number;
  updateCount: number;
  linkCount: number;
  subtaskCount: number;
  deleteCount: number;
  assigneeCount: number;
  estimateCount: number;
}
```

Dans `checkChanges`, ajouter les compteurs et les incrémenter. Remplacer la
déclaration des compteurs locaux (ligne 106-107) :

```ts
  const willCreate = new Set((cs.create ?? []).map((c) => c.idV2));
  let linkCount = 0;
  let subtaskCount = 0;
  let assigneeCount = 0;
  let estimateCount = 0;
  const countAE = (item: { assignee?: string | null; estimateHours?: number | null }): void => {
    if (item.assignee !== undefined) assigneeCount++;
    if (item.estimateHours !== undefined) estimateCount++;
  };
```

Puis appeler `countAE(...)` aux bons endroits. Dans la boucle `create` (après
`lint(\`CREATE ${c.idV2}\`, c.nom);`) :

```ts
    lint(`CREATE ${c.idV2}`, c.nom);
    countAE(c);
    for (const s of c.subtasks ?? []) {
      subtaskCount++;
      lint(`CREATE ${c.idV2} / sous-tâche ${s.idV2}`, s.nom);
      countAE(s);
    }
```

Dans la boucle `update` (celle réécrite en Task 5), après `lint(...)` :

```ts
    lint(`UPDATE ${u.ref}`, u.summary);
    countAE(u);
    for (const s of u.subtasks ?? []) {
      subtaskCount++;
      lint(`UPDATE ${u.ref} / sous-tâche ${s.idV2}`, s.nom);
      countAE(s);
    }
```

Et dans le `return` final de `checkChanges` (lignes 141-147) :

```ts
  return {
    warnings, errors,
    createCount: (cs.create ?? []).length,
    updateCount: (cs.update ?? []).length,
    linkCount, subtaskCount,
    deleteCount: (cs.delete ?? []).length,
    assigneeCount, estimateCount,
  };
```

Enfin, dans `dryRun` (lignes 150-196), mettre à jour la ligne de résumé et
les sections CRÉATIONS/MISES À JOUR. Remplacer la ligne de résumé (ligne 155) :

```ts
  L.push(`  Créations : ${c.createCount}   ·   Sous-tâches : ${c.subtaskCount}   ·   Mises à jour : ${c.updateCount}   ·   Assignations : ${c.assigneeCount}   ·   Estimations : ${c.estimateCount}   ·   Liens : ${c.linkCount}   ·   Suppressions : ${c.deleteCount}`, '');
```

Remplacer le bloc CRÉATIONS (lignes 156-165) :

```ts
  if (cs.create?.length) {
    L.push('CRÉATIONS', '-'.repeat(40));
    for (const x of cs.create) {
      L.push(`  + [${x.projet}] ${x.idV2} → epic ${x.epic}  (${x.statutInitial})`);
      L.push(`      "${x.nom}"   ${x.debut ?? '—'} → ${x.fin ?? '—'}`);
      if (x.assignee !== undefined) L.push(`      assignee → ${x.assignee ?? '(désassigné)'}`);
      if (x.estimateHours !== undefined) L.push(`      estimation → ${x.estimateHours ?? '(effacée)'}h`);
      for (const d of x.dependsOn ?? []) L.push(`      dep ${d.type}: ${d.ref}`);
      for (const s of x.subtasks ?? []) {
        L.push(`      ↳ ${s.idV2}  "${s.nom}"   ${s.debut ?? '—'} → ${s.fin ?? '—'}`);
        if (s.assignee !== undefined) L.push(`          assignee → ${s.assignee ?? '(désassigné)'}`);
        if (s.estimateHours !== undefined) L.push(`          estimation → ${s.estimateHours ?? '(effacée)'}h`);
      }
    }
    L.push('');
  }
```

Remplacer le bloc MISES À JOUR (lignes 166-181) :

```ts
  if (cs.update?.length) {
    L.push('MISES À JOUR', '-'.repeat(40));
    for (const u of cs.update) {
      const parts = [
        u.statut ? `statut→"${u.statut}"` : '',
        u.debut ? `début→${u.debut}` : '',
        u.fin ? `fin→${u.fin}` : '',
        u.summary ? 'summary' : '',
        u.epic ? `epic→${u.epic}` : '',
        u.addLabels?.length ? `+labels[${u.addLabels.join(',')}]` : '',
        u.assignee !== undefined ? `assignee→${u.assignee ?? '(désassigné)'}` : '',
        u.estimateHours !== undefined ? `estimation→${u.estimateHours ?? '(effacée)'}h` : '',
      ].filter(Boolean);
      L.push(`  ~ ${u.ref}  ${parts.join(' · ') || '(liens seulement)'}`);
      for (const d of u.dependsOn ?? []) L.push(`      dep ${d.type}: ${d.ref}`);
      for (const s of u.subtasks ?? []) {
        L.push(`      ↳ NOUVELLE sous-tâche ${s.idV2}  "${s.nom}"   ${s.debut ?? '—'} → ${s.fin ?? '—'}`);
        if (s.assignee !== undefined) L.push(`          assignee → ${s.assignee ?? '(désassigné)'}`);
        if (s.estimateHours !== undefined) L.push(`          estimation → ${s.estimateHours ?? '(effacée)'}h`);
      }
    }
    L.push('');
  }
```

- [ ] **Step 6.4 : Lancer le test, le voir passer**

```bash
npx vitest run tests/taches-apply.test.ts
```
Attendu : PASS (tout le fichier).

- [ ] **Step 6.5 : Commit**

```bash
git add src/taches-apply.ts tests/taches-apply.test.ts
git commit -m "feat(taches-apply): checkChanges/dryRun comptent et affichent assignations, estimations, sous-taches d'update"
```

---

### Task 7 — `applyChanges` : chemin `create` avec assignee + estimation

**Fichiers :**
- Modifier : `src/taches-apply.ts`
- Test : `tests/taches-apply.test.ts`

- [ ] **Step 7.1 : Écrire le test qui échoue**

Ajouter dans `tests/taches-apply.test.ts`, dans le `describe('applyChanges (client simulé)', ...)` :

```ts
  it('résout le nom en accountId et pose assignee+estimation à la création', async () => {
    const calls: Array<{ url: string; body: any }> = [];
    let n = 400;
    const fetchFn = (async (url: string, opts: any) => {
      const u = String(url); const m = opts?.method ?? 'GET';
      if (u.includes('/user/search')) {
        return new Response(JSON.stringify([
          { accountId: '712020:abc', displayName: 'Arthur-Olivier Fortin', accountType: 'atlassian', active: true },
        ]), { status: 200 });
      }
      if (u.endsWith('/issue') && m === 'POST') {
        const body = JSON.parse(opts.body);
        calls.push({ url: u, body });
        return new Response(JSON.stringify({ key: `GES-${n++}` }), { status: 201 });
      }
      if (u.includes('?fields=status')) return new Response(JSON.stringify({ fields: { status: { name: 'À faire' } } }), { status: 200 });
      if (u.endsWith('/transitions') && m === 'GET') return new Response(JSON.stringify({ transitions: [] }), { status: 200 });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const client = { baseUrl: 'https://x', authHeader: 'Basic x', startFieldId: 'customfield_1', fetchFn };
    const cs: ChangeSet = {
      create: [{
        idV2: 'NEW-9', nom: 'X', projet: 'GES', epic: 'GES-66', statutInitial: 'À faire',
        assignee: 'Arthur-Olivier Fortin', estimateHours: 3,
      }],
    };
    const r = await applyChanges(client, cs, idx, ISSUES);
    expect(r.errors).toEqual([]);
    expect(r.created).toHaveLength(1);
    const f = calls[0].body.fields;
    expect(f.assignee).toEqual({ accountId: '712020:abc' });
    expect(f.timetracking).toEqual({ originalEstimate: '3h' });
  });

  it('erreur explicite (pas de silence) si le nom d\'assignee est introuvable — la création échoue', async () => {
    const fetchFn = (async (url: string) => {
      const u = String(url);
      if (u.includes('/user/search')) return new Response(JSON.stringify([]), { status: 200 });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const client = { baseUrl: 'https://x', authHeader: 'Basic x', startFieldId: 'customfield_1', fetchFn };
    const cs: ChangeSet = {
      create: [{ idV2: 'NEW-10', nom: 'X', projet: 'GES', epic: 'GES-66', statutInitial: 'À faire', assignee: 'Personne Inconnue' }],
    };
    const r = await applyChanges(client, cs, idx, ISSUES);
    expect(r.created).toHaveLength(0);
    expect(r.errors.some((e) => e.includes('NEW-10') && e.includes('introuvable'))).toBe(true);
  });
```

- [ ] **Step 7.2 : Lancer le test, le voir échouer**

```bash
npx vitest run tests/taches-apply.test.ts -t "assignee.*creation|nom d.assignee"
```
Attendu : FAIL — `f.assignee` est `undefined` (le chemin create n'appelle pas encore `resolveAccountId`/ne passe pas `opts` à `createTask`).

- [ ] **Step 7.3 : Implémenter le minimum**

Dans `src/taches-apply.ts`, ajouter l'import de `resolveAccountId` (et
`setAssignee`, `setEstimate` utilisés en Task 8) en tête de fichier —
remplacer le bloc d'import (lignes 7-15) :

```ts
import {
  createTask,
  createSubtask,
  transitionTo,
  linkDep,
  deleteIssue,
  resolveAccountId,
  setAssignee,
  setEstimate,
  type JiraWriteClient,
  type DepType,
} from './jira-write.js';
```

Puis, dans `applyChanges` (lignes 241-354), ajouter un cache d'assignés
local à l'appel (après la ligne `const byKey = new Map(...)`, ligne 250) :

```ts
  const assigneeCache = new Map<string, string>();
```

Remplacer le bloc de création (lignes 253-260) par :

```ts
  for (const x of cs.create ?? []) {
    try {
      const accountId = x.assignee === undefined
        ? undefined
        : x.assignee === null ? null : await resolveAccountId(client, x.assignee, assigneeCache);
      const key = await createTask(
        client, x.projet, x.nom, x.epic,
        x.debut ?? null, x.fin ?? null,
        x.labels ?? [],
        { accountId, estimateHours: x.estimateHours },
      );
      created.set(x.idV2, key);
      result.created.push({ idV2: x.idV2, key });
      log(`  [OK] créé ${x.idV2} → ${key}`);
```

(le reste du bloc — `try { await transitionTo(...) }` et la boucle des
sous-tâches — ne change pas ici, il est traité en Task 9). Puis, dans la
boucle des sous-tâches de `create` (lignes 265-278), résoudre aussi
`s.assignee` — remplacer par :

```ts
      for (const s of x.subtasks ?? []) {
        try {
          const subAccountId = s.assignee === undefined
            ? undefined
            : s.assignee === null ? null : await resolveAccountId(client, s.assignee, assigneeCache);
          const subKey = await createSubtask(client, x.projet, s.nom, key, {
            start: s.debut ?? null,
            due: s.fin ?? null,
            labels: s.labels ?? [],
            accountId: subAccountId,
            estimateHours: s.estimateHours,
          });
          result.subtasks.push({ idV2: s.idV2, key: subKey });
          log(`    [OK] sous-tâche ${s.idV2} → ${subKey} (parent ${key})`);
        } catch (e) {
          result.errors.push(`subtask ${s.idV2}: ${(e as Error).message}`);
          log(`    [ERREUR] subtask ${s.idV2}: ${(e as Error).message}`);
        }
      }
```

- [ ] **Step 7.4 : Lancer le test, le voir passer**

```bash
npx vitest run tests/taches-apply.test.ts
```
Attendu : PASS (tout le fichier — vérifie aussi que les tests de création
existants, sans `assignee`, passent toujours puisque `accountId` reste
`undefined` dans ce cas et `createTask` ne pose alors pas `fields.assignee`).

- [ ] **Step 7.5 : Commit**

```bash
git add src/taches-apply.ts tests/taches-apply.test.ts
git commit -m "feat(taches-apply): applyChanges resout assignee et pose estimation sur le chemin create (+ sous-taches)"
```

---

### Task 8 — `applyChanges` : chemin `update` avec assignee + estimation

**Fichiers :**
- Modifier : `src/taches-apply.ts`
- Test : `tests/taches-apply.test.ts`

- [ ] **Step 8.1 : Écrire le test qui échoue**

Ajouter dans `tests/taches-apply.test.ts` :

```ts
describe('applyChanges — assignee/estimation sur update', () => {
  it('désassigne (assignee: null) via setAssignee, sans appel à /user/search', async () => {
    const searchCalls: string[] = [];
    const putBodies: any[] = [];
    const fetchFn = (async (url: string, opts: any) => {
      const u = String(url); const m = opts?.method ?? 'GET';
      if (u.includes('/user/search')) { searchCalls.push(u); return new Response('[]', { status: 200 }); }
      if (u.match(/\/issue\/[^/]+$/) && m === 'PUT') { putBodies.push(JSON.parse(opts.body)); return new Response(null, { status: 204 }); }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const client = { baseUrl: 'https://x', authHeader: 'Basic x', startFieldId: 'customfield_1', fetchFn };
    const r = await applyChanges(client, { update: [{ ref: 'GES-90', assignee: null }] }, idx, ISSUES);
    expect(r.errors).toEqual([]);
    expect(searchCalls).toHaveLength(0);
    expect(putBodies.some((b) => b.fields.assignee === null)).toBe(true);
  });

  it('résout le nom et assigne via setAssignee (PUT séparé, après updateFields)', async () => {
    const putBodies: any[] = [];
    const fetchFn = (async (url: string, opts: any) => {
      const u = String(url); const m = opts?.method ?? 'GET';
      if (u.includes('/user/search')) {
        return new Response(JSON.stringify([
          { accountId: '712020:abc', displayName: 'Arthur-Olivier Fortin', accountType: 'atlassian', active: true },
        ]), { status: 200 });
      }
      if (u.match(/\/issue\/[^/]+$/) && m === 'PUT') { putBodies.push(JSON.parse(opts.body)); return new Response(null, { status: 204 }); }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const client = { baseUrl: 'https://x', authHeader: 'Basic x', startFieldId: 'customfield_1', fetchFn };
    const r = await applyChanges(client, { update: [{ ref: 'GES-90', assignee: 'Arthur-Olivier Fortin' }] }, idx, ISSUES);
    expect(r.errors).toEqual([]);
    expect(putBodies.some((b) => b.fields.assignee?.accountId === '712020:abc')).toBe(true);
  });

  it('pose l\'estimation via setEstimate (format entier composé)', async () => {
    const putBodies: any[] = [];
    const fetchFn = (async (url: string, opts: any) => {
      const u = String(url); const m = opts?.method ?? 'GET';
      if (u.match(/\/issue\/[^/]+$/) && m === 'PUT') { putBodies.push(JSON.parse(opts.body)); return new Response(null, { status: 204 }); }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const client = { baseUrl: 'https://x', authHeader: 'Basic x', startFieldId: 'customfield_1', fetchFn };
    const r = await applyChanges(client, { update: [{ ref: 'GES-90', estimateHours: 10.5 }] }, idx, ISSUES);
    expect(r.errors).toEqual([]);
    expect(putBodies.some((b) => b.fields.timetracking?.originalEstimate === '10h 30m')).toBe(true);
  });

  it('n\'écrit ni assignee ni timetracking si les champs sont absents (undefined)', async () => {
    const putBodies: any[] = [];
    const fetchFn = (async (url: string, opts: any) => {
      const u = String(url); const m = opts?.method ?? 'GET';
      if (u.match(/\/issue\/[^/]+$/) && m === 'PUT') { putBodies.push(JSON.parse(opts.body)); return new Response(null, { status: 204 }); }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const client = { baseUrl: 'https://x', authHeader: 'Basic x', startFieldId: 'customfield_1', fetchFn };
    const r = await applyChanges(client, { update: [{ ref: 'GES-90', statut: undefined, summary: 'Renommée' }] }, idx, ISSUES);
    expect(r.errors).toEqual([]);
    expect(putBodies.every((b) => !('assignee' in b.fields) && !('timetracking' in b.fields))).toBe(true);
  });

  it('erreur d\'assignation isolée n\'empêche pas le reste de l\'update (pas de crash global)', async () => {
    const fetchFn = (async (url: string, opts: any) => {
      const u = String(url); const m = opts?.method ?? 'GET';
      if (u.includes('/user/search')) return new Response('[]', { status: 200 });
      if (u.match(/\/issue\/[^/]+$/) && m === 'PUT') return new Response(null, { status: 204 });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const client = { baseUrl: 'https://x', authHeader: 'Basic x', startFieldId: 'customfield_1', fetchFn };
    const r = await applyChanges(client, { update: [{ ref: 'GES-90', summary: 'Renommée', assignee: 'Fantôme' }] }, idx, ISSUES);
    expect(r.updated).toContain('GES-90');
    expect(r.errors.some((e) => e.includes('GES-90') && e.includes('introuvable'))).toBe(true);
  });
});
```

- [ ] **Step 8.2 : Lancer le test, le voir échouer**

```bash
npx vitest run tests/taches-apply.test.ts -t "applyChanges — assignee/estimation sur update"
```
Attendu : FAIL — `putBodies` ne contient aucun corps avec `fields.assignee`
ou `fields.timetracking` (le chemin update n'appelle pas encore
`setAssignee`/`setEstimate`).

- [ ] **Step 8.3 : Implémenter le minimum**

Dans `src/taches-apply.ts`, dans la boucle de mise à jour (lignes 286-306),
ajouter les appels à `setAssignee`/`setEstimate` après le bloc `statut`
existant. Remplacer tout le bloc `for (const u of cs.update ?? [])` par :

```ts
  for (const u of cs.update ?? []) {
    const key = idx.keys.has(u.ref) ? u.ref : null;
    if (!key) { result.errors.push(`update ${u.ref}: introuvable`); continue; }
    try {
      let labels: string[] | undefined;
      if (u.addLabels?.length) {
        const cur = byKey.get(key)?.labels ?? [];
        labels = [...new Set([...cur, ...u.addLabels])];
      }
      await updateFields(client, key, { summary: u.summary, due: u.fin, start: u.debut, parentKey: u.epic, labels });
      if (u.statut) {
        try { await transitionTo(client, key, u.statut); }
        catch (e) { result.errors.push(`transition ${u.ref}: ${(e as Error).message}`); }
      }
      if (u.assignee !== undefined) {
        try {
          const accountId = u.assignee === null ? null : await resolveAccountId(client, u.assignee, assigneeCache);
          await setAssignee(client, key, accountId);
          log(`  [OK] assignee ${u.ref} → ${u.assignee ?? '(désassigné)'}`);
        } catch (e) {
          result.errors.push(`assignee ${u.ref}: ${(e as Error).message}`);
          log(`  [ERREUR] assignee ${u.ref}: ${(e as Error).message}`);
        }
      }
      if (u.estimateHours !== undefined) {
        try {
          await setEstimate(client, key, u.estimateHours);
          log(`  [OK] estimation ${u.ref} → ${u.estimateHours ?? '(effacée)'}h`);
        } catch (e) {
          result.errors.push(`estimate ${u.ref}: ${(e as Error).message}`);
          log(`  [ERREUR] estimate ${u.ref}: ${(e as Error).message}`);
        }
      }
      result.updated.push(key);
      log(`  [OK] maj ${u.ref} (${key})`);
    } catch (e) {
      result.errors.push(`update ${u.ref}: ${(e as Error).message}`);
      log(`  [ERREUR] update ${u.ref}: ${(e as Error).message}`);
    }
  }
```

- [ ] **Step 8.4 : Lancer le test, le voir passer**

```bash
npx vitest run tests/taches-apply.test.ts
```
Attendu : PASS (tout le fichier).

- [ ] **Step 8.5 : Commit**

```bash
git add src/taches-apply.ts tests/taches-apply.test.ts
git commit -m "feat(taches-apply): applyChanges pose assignee (desassignation via null) et estimation sur le chemin update"
```

---

### Task 9 — `applyChanges` : sous-tâches créées via `update` (parent EXISTANT)

C'est le cas d'usage central du fichier en attente (`DEV-194`, `DEV-196`,
`DEV-195` : chacun ajoute des sous-tâches sous une Tâche déjà existante dans
JIRA, via `update.subtasks`, pas `create.subtasks`).

**Fichiers :**
- Modifier : `src/taches-apply.ts`
- Test : `tests/taches-apply.test.ts`

- [ ] **Step 9.1 : Écrire le test qui échoue**

Ajouter dans `tests/taches-apply.test.ts`, dans le `describe('sous-tâches', ...)` existant :

```ts
  it('applyChanges crée des sous-tâches via update SOUS UN PARENT EXISTANT (pas de created.get)', async () => {
    const createdSubtasks: Array<{ parent?: string; summary?: string }> = [];
    let n = 500;
    const fetchFn = (async (url: string, opts: any) => {
      const u = String(url); const m = opts?.method ?? 'GET';
      if (u.endsWith('/issue') && m === 'POST') {
        const body = JSON.parse(opts.body);
        createdSubtasks.push({ parent: body.fields?.parent?.key, summary: body.fields?.summary });
        return new Response(JSON.stringify({ key: `GES-${n++}` }), { status: 201 });
      }
      if (u.match(/\/issue\/[^/]+$/) && m === 'PUT') return new Response(null, { status: 204 });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const client = { baseUrl: 'https://x', authHeader: 'Basic x', startFieldId: 'customfield_1', fetchFn };
    const cs: ChangeSet = {
      update: [{
        ref: 'GES-90', summary: 'PRx — décomposée en sous-tâches',
        subtasks: [
          { idV2: 'PRX-CONC', nom: 'Conception', estimateHours: 2 },
          { idV2: 'PRX-IMPL', nom: 'Implémentation', estimateHours: 5 },
        ],
      }],
    };
    const r = await applyChanges(client, cs, idx, ISSUES);
    expect(r.errors).toEqual([]);
    expect(r.subtasks).toHaveLength(2);
    expect(r.subtasks.map((s) => s.idV2)).toEqual(['PRX-CONC', 'PRX-IMPL']);
    expect(createdSubtasks.every((s) => s.parent === 'GES-90')).toBe(true);
    expect(createdSubtasks.map((s) => s.summary)).toEqual(['Conception', 'Implémentation']);
  });

  it('n\'essaie pas de créer les sous-tâches d\'update si le ref parent est introuvable', async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string, opts: any) => {
      const u = String(url); const m = opts?.method ?? 'GET';
      if (u.endsWith('/issue') && m === 'POST') { calls.push('create'); return new Response(JSON.stringify({ key: 'X-1' }), { status: 201 }); }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const client = { baseUrl: 'https://x', authHeader: 'Basic x', startFieldId: 'customfield_1', fetchFn };
    const cs: ChangeSet = { update: [{ ref: 'GES-INCONNU', subtasks: [{ idV2: 'S-1', nom: 'X' }] }] };
    const r = await applyChanges(client, cs, idx, ISSUES);
    expect(r.errors.some((e) => e.includes('GES-INCONNU'))).toBe(true);
    expect(calls).toHaveLength(0);
  });
```

- [ ] **Step 9.2 : Lancer le test, le voir échouer**

```bash
npx vitest run tests/taches-apply.test.ts -t "SOUS UN PARENT EXISTANT|ref parent est introuvable"
```
Attendu : FAIL — `r.subtasks` a une longueur de 0 (le chemin update n'appelle
pas encore `createSubtask` pour `u.subtasks`).

- [ ] **Step 9.3 : Implémenter le minimum**

Dans `src/taches-apply.ts`, dans la boucle `update` (celle étendue en Task
8), ajouter la création des sous-tâches juste après le bloc `estimateHours`
et avant `result.updated.push(key)`. Le bloc complet de la boucle devient :

```ts
  for (const u of cs.update ?? []) {
    const key = idx.keys.has(u.ref) ? u.ref : null;
    if (!key) { result.errors.push(`update ${u.ref}: introuvable`); continue; }
    try {
      let labels: string[] | undefined;
      if (u.addLabels?.length) {
        const cur = byKey.get(key)?.labels ?? [];
        labels = [...new Set([...cur, ...u.addLabels])];
      }
      await updateFields(client, key, { summary: u.summary, due: u.fin, start: u.debut, parentKey: u.epic, labels });
      if (u.statut) {
        try { await transitionTo(client, key, u.statut); }
        catch (e) { result.errors.push(`transition ${u.ref}: ${(e as Error).message}`); }
      }
      if (u.assignee !== undefined) {
        try {
          const accountId = u.assignee === null ? null : await resolveAccountId(client, u.assignee, assigneeCache);
          await setAssignee(client, key, accountId);
          log(`  [OK] assignee ${u.ref} → ${u.assignee ?? '(désassigné)'}`);
        } catch (e) {
          result.errors.push(`assignee ${u.ref}: ${(e as Error).message}`);
          log(`  [ERREUR] assignee ${u.ref}: ${(e as Error).message}`);
        }
      }
      if (u.estimateHours !== undefined) {
        try {
          await setEstimate(client, key, u.estimateHours);
          log(`  [OK] estimation ${u.ref} → ${u.estimateHours ?? '(effacée)'}h`);
        } catch (e) {
          result.errors.push(`estimate ${u.ref}: ${(e as Error).message}`);
          log(`  [ERREUR] estimate ${u.ref}: ${(e as Error).message}`);
        }
      }
      const parentProject = byKey.get(key)?.project ?? key.split('-')[0];
      for (const s of u.subtasks ?? []) {
        try {
          const subAccountId = s.assignee === undefined
            ? undefined
            : s.assignee === null ? null : await resolveAccountId(client, s.assignee, assigneeCache);
          const subKey = await createSubtask(client, parentProject, s.nom, key, {
            start: s.debut ?? null,
            due: s.fin ?? null,
            labels: s.labels ?? [],
            accountId: subAccountId,
            estimateHours: s.estimateHours,
          });
          result.subtasks.push({ idV2: s.idV2, key: subKey });
          log(`    [OK] sous-tâche ${s.idV2} → ${subKey} (parent existant ${key})`);
        } catch (e) {
          result.errors.push(`subtask ${s.idV2}: ${(e as Error).message}`);
          log(`    [ERREUR] subtask ${s.idV2}: ${(e as Error).message}`);
        }
      }
      result.updated.push(key);
      log(`  [OK] maj ${u.ref} (${key})`);
    } catch (e) {
      result.errors.push(`update ${u.ref}: ${(e as Error).message}`);
      log(`  [ERREUR] update ${u.ref}: ${(e as Error).message}`);
    }
  }
```

Note : `parentProject` est dérivé de `byKey.get(key)?.project` (le snapshot
`issues` connaît déjà le projet de l'issue existante), avec un repli sur le
préfixe de la clé JIRA (`key.split('-')[0]`) si l'issue n'est pas dans
`byKey` (cas de test avec fixtures minimales) — cohérent avec le fait que le
projet d'une sous-tâche doit être le même que celui de son parent.

- [ ] **Step 9.4 : Lancer le test, le voir passer**

```bash
npx vitest run tests/taches-apply.test.ts
```
Attendu : PASS (tout le fichier — 100% des tests de `tests/taches-apply.test.ts`, anciens et nouveaux).

- [ ] **Step 9.5 : Commit**

```bash
git add src/taches-apply.ts tests/taches-apply.test.ts
git commit -m "feat(taches-apply): applyChanges cree les sous-taches d'update sous un parent JIRA existant"
```

---

### Task 10 — Barrel `index.ts` : exposer les nouvelles primitives

**Fichiers :**
- Modifier : `src/index.ts`
- Test : `tests/index.test.ts`

- [ ] **Step 10.1 : Écrire le test qui échoue**

Ajouter dans `tests/index.test.ts`, dans le `describe('barrel index.ts — sans mécanisme nid', ...)` :

```ts
  it('exporte les nouvelles primitives assignee/estimation', () => {
    expect(typeof core.hoursToJiraDuration).toBe('function');
    expect(typeof core.resolveAccountId).toBe('function');
    expect(typeof core.setAssignee).toBe('function');
    expect(typeof core.setEstimate).toBe('function');
  });
```

- [ ] **Step 10.2 : Lancer le test, le voir échouer**

```bash
npx vitest run tests/index.test.ts
```
Attendu : FAIL — `core.hoursToJiraDuration` est `undefined`.

- [ ] **Step 10.3 : Implémenter le minimum**

Dans `src/index.ts`, remplacer le bloc d'export de `jira-write.js` (lignes 12-27) par :

```ts
export {
  fileTimestamp,
  isRealJiraKey,
  hoursToJiraDuration,
  resolveAccountId,
  createEpic,
  createTask,
  createSubtask,
  getCurrentStatus,
  transitionTo,
  setAssignee,
  setEstimate,
  linkDep,
  restructureOriginal,
  deleteIssue,
  deleteIssueLink,
  carryStatusThenDelete,
  createRisk,
} from './jira-write.js';
export type { JiraWriteClient, DepType } from './jira-write.js';
```

- [ ] **Step 10.4 : Lancer le test, le voir passer**

```bash
npx vitest run tests/index.test.ts
```
Attendu : PASS.

- [ ] **Step 10.5 : Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat(index): exposer hoursToJiraDuration/resolveAccountId/setAssignee/setEstimate au barrel"
```

---

### Task 11 — Version 1.2.0 (préparée, PAS publiée)

Additif et rétrocompatible → bump MINOR selon SemVer (`1.1.0` → `1.2.0`),
conforme au protocole documenté dans `README.md` §« Protocole de bump de
version ». **La publication reste une étape validée par l'humain** — cette
Task prépare le commit et le tag localement, elle ne pousse ni ne déclenche
la CI.

**Fichiers :**
- Modifier : `package.json`
- Modifier : `README.md`

- [ ] **Step 11.1 : Bump `package.json`**

Dans `package.json`, remplacer `"version": "1.1.0"` par `"version": "1.2.0"`.

- [ ] **Step 11.2 : Mettre à jour `README.md`**

Remplacer la ligne `**Version courante : 1.1.0**` (ligne 3) par
`**Version courante : 1.2.0**`. Ajouter à la fin du README, après la section
« Protocole de bump de version », une nouvelle section :

```markdown
## Historique des versions

- **1.2.0** (additif) : assignation (`assignee`, avec désassignation
  explicite via `null`), estimation (`estimateHours`, time-tracking actif
  sur l'instance depuis 2026-07-07 — format de durée entier composé, ex.
  `"2h 30m"`, jamais de décimale), et sous-tâches sur `update` (création de
  sous-tâches sous une tâche parente EXISTANTE). Nouvelles primitives :
  `resolveAccountId`, `setAssignee`, `setEstimate`, `hoursToJiraDuration`.
  Aucune API existante retirée ni signature existante cassée.
- **1.1.0** : retrait du mécanisme `nid` (identité = clé JIRA seule).
```

- [ ] **Step 11.3 : Vérifier que la suite complète passe avant de committer le bump**

```bash
npm test
npx tsc --noEmit
npm run build
```
Attendu : les trois commandes réussissent (0 échec, `dist/` généré sans erreur).

- [ ] **Step 11.4 : Commit du bump (PAS de tag, PAS de push)**

```bash
git add package.json README.md
git commit -m "chore(release): bump 1.2.0 — assignee, estimation, sous-taches sur update"
```

**Ne PAS exécuter** `git tag v1.2.0` ni `git push` — la CI
(`.github/workflows/publish.yml`) se déclenche sur un tag `v*` et publie
réellement sur GitHub Packages. Le tag + push sont une décision humaine
explicite, hors du périmètre de ce plan.

---

### Task finale — Portes de vérification

- [ ] **Step F.1 :** `npm test` (toute la suite Vitest — `jira-write.test.ts`, `taches-apply.test.ts`, `index.test.ts`, et tous les fichiers non touchés par ce plan)
- [ ] **Step F.2 :** `npx tsc --noEmit` (typecheck strict — `package.json` script `typecheck`)
- [ ] **Step F.3 :** `npm run build` (émission `dist/`, requis avant toute publication)
- [ ] **Step F.4 :** `grep -rn "time-tracking désactivé\|time-tracking off" src/ docs/` → confirmer 0 occurrence dans `src/` (le commentaire obsolète de `jira-write.ts` a été corrigé en Task 4). Les occurrences dans `docs/plans/2026-06-29-*.md` (plans historiques déjà mergés) sont acceptables — ce sont des archives, pas la doc active.
- [ ] **Step F.5 :** Rapport à l'humain : signaler explicitement que `NATHAN-gestion/docs/CONVENTIONS-JIRA.md` §4 (« Time-tracking désactivé ») est périmé et doit être corrigé séparément dans le dépôt `NATHAN-gestion` — **hors périmètre de ce plan** (ce plan ne touche que `NATHAN-jira-package`).
- [ ] **Step F.6 :** Ne PAS pousser, ne PAS tagger, ne PAS publier. Laisser l'humain déclencher `git tag v1.2.0 && git push origin main --tags` après revue.
