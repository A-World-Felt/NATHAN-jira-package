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
