# @a-world-felt/nathan-jira-core

**Version courante : 1.0.0**

Couche JIRA partagée des projets NATHAN : client REST, conventions (`nid-`, `role-`),
types et mapping. Consommé en git dependency par NATHAN-gestion et NATHAN-web.
Repo : `A-World-Felt/NATHAN-jira-package` (privé). Package npm : `@a-world-felt/nathan-jira-core`.

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

Dans `package.json` du consommateur, la clé de dépendance doit être le nom scopé :

```json
"dependencies": {
  "@a-world-felt/nathan-jira-core": "github:A-World-Felt/NATHAN-jira-package#<commit-sha>"
}
```

npm clone le repo, lit `package.json` et résout le module sous `@a-world-felt/nathan-jira-core`.
Aucun token npm requis — l'authentification passe par git (SSH ou HTTPS avec token GitHub).

## Protocole de bump de version

1. Modifier `version` dans `package.json` (ex. `1.0.0` → `1.1.0`).
2. Mettre à jour **Version courante** dans ce README.
3. Commiter : `git commit -m "chore: bump v1.1.0"`.
4. Tagger : `git tag v1.1.0`.
5. Pousser : `git push origin main --tags`.
6. La CI (`.github/workflows/publish.yml`) détecte le tag `v*`, build, publie sur GitHub Packages.
7. Mettre à jour le SHA dans les consommateurs (`NATHAN-gestion`, `NATHAN-web`).
