# @a-world-felt/nathan-jira-core

**Version courante : 1.1.0**

Couche JIRA partagée des projets NATHAN : client REST, conventions (`role-`),
types et mapping. Identité tâche ↔ issue JIRA = la clé JIRA (plus de label `nid-`).
Deux modes de consommation (voir plus bas) : **NATHAN-gestion** en git
dependency (par SHA, sans token), **NATHAN-web** par le registre GitHub Packages (par SemVer).
Repo : `A-World-Felt/NATHAN-jira-package` (privé). Package npm : `@a-world-felt/nathan-jira-core`.

## Surface publique

`JiraClient`, `loadConfig`, `sessionFromDate`, `statusInfo`, `computeOrder`,
`findOrphanDeps`, `hasCycle` + types (`Task`, `Config`, …).

## Dev

- `npm test` — Vitest
- `npm run build` — émet `dist/`
- `npm run typecheck`

## Consommation — mode A : git dependency privée (NATHAN-gestion)

```bash
npm i github:A-World-Felt/NATHAN-jira-package#<commit-sha>
```

Dans `package.json` du consommateur, la clé de dépendance doit être le nom scopé :

```json
"dependencies": {
  "@a-world-felt/nathan-jira-core": "github:A-World-Felt/NATHAN-jira-package#<commit-sha>"
}
```

npm clone le repo, lit `package.json` et résout le module sous `@a-world-felt/nathan-jira-core`.
**Aucun token npm requis** — l'authentification passe par git (SSH ou HTTPS avec token GitHub).
npm exécute le `prepare` (build `tsc`) à l'install ; c'est le mode adapté à un outil local.

## Consommation — mode B : registre GitHub Packages (NATHAN-web)

Pour un build léger sans clone ni `tsc` (idéal en CI / edge), consommer le tarball publié :

```json
"dependencies": {
  "@a-world-felt/nathan-jira-core": "^1.0.0"
}
```

Le registre exige une authentification, fournie **sans PAT** par le `GITHUB_TOKEN` intégré
quand l'install tourne dans GitHub Actions. `.npmrc` du consommateur :

```
@a-world-felt:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

(En GitHub Actions, `actions/setup-node` avec `registry-url` génère ce `.npmrc` ; ne jamais
commiter de token.)

## Protocole de bump de version

1. Modifier `version` dans `package.json` (ex. `1.0.0` → `1.1.0`).
2. Mettre à jour **Version courante** dans ce README.
3. Commiter : `git commit -m "chore: bump v1.1.0"`.
4. Tagger : `git tag v1.1.0`.
5. Pousser : `git push origin main --tags`.
6. La CI (`.github/workflows/publish.yml`) détecte le tag `v*`, build, publie sur GitHub Packages.
7. Repointer les consommateurs : `NATHAN-gestion` met à jour le **SHA** de sa git-dep (mode A) ;
   `NATHAN-web` bump sa **plage SemVer** (mode B, ex. `^1.0.0` → `^1.1.0` ; souvent résolu
   automatiquement par `^` au prochain install).
