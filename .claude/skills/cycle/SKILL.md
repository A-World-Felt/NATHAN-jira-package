---
name: cycle
description: Boucle de dev réutilisable — pilote une feature par un PLAN, lance research → build TDD → revue judge 2 étapes (conformité + sandbox) → PR → merge si approuvé. Repo-agnostique (TypeScript/Node). Pas d'issue GitHub ; livraison par PR.
user-invocable: true
---

# Cycle de développement (réutilisable)

Tu es l'orchestrateur de développement du **dépôt courant** (TypeScript/Node, tests vitest).
Tu ne builds PAS et ne reviews PAS toi-même : tu lances un sous-agent à chaque phase.

**Source de vérité = un PLAN** (style `superpowers:writing-plans` : tasks TDD, chemins exacts,
code complet). Pas d'issue GitHub. La livraison passe par une **PR** (jamais de push direct
sur la branche d'intégration).

**Entrée de `/cycle`** (l'une des deux) :
- un **chemin de plan** déjà écrit (ex. `docs/plans/2026-06-29-x-plan.md` ou un plan externe) — on saute le researcher ;
- une **description de feature** (pas encore de plan) — le researcher en produit un.

## Step 0 — Contexte du dépôt

```bash
git rev-parse --abbrev-ref HEAD
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || git remote get-url origin)
echo "Dépôt cible : $REPO"
BASE=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || echo main)
echo "Branche d'intégration : $BASE"
git checkout "$BASE"
git pull origin "$BASE" 2>/dev/null || true
```

(`$BASE` = branche d'intégration du dépôt, `main` par défaut. Toute modif passe par une PR vers `$BASE`.)

## Step 1 — Déterminer le travail

- **Plan fourni** (chemin) → vérifie qu'il existe (`test -f <plan>`). Va au Step 3 en mode
  « plan existant » (le researcher valide, ne réécrit pas).
- **Description fournie** (pas de plan) → va au Step 2.
- **Rien fourni** → liste les plans non livrés : `ls docs/plans/ 2>/dev/null`. S'il y en a un en
  cours, propose-le. Sinon dis « Donne-moi un plan ou une description de feature. » STOP.

## Step 2 — (si pas de plan) Research — dispatch researcher

```
Agent(
  subagent_type="researcher",
  prompt="Produis un plan d'implémentation TDD pour : <DESCRIPTION>.
Contexte : dépôt courant (TypeScript/Node). Lis le code existant avant de planifier.
Suis tes instructions d'agent exactement. Écris le plan dans docs/plans/ et le verdict dans data/cycle/plan_verdict.json."
)
```

## Step 3 — (si plan existant) Validation — dispatch researcher

```
Agent(
  subagent_type="researcher",
  prompt="Un PLAN existe déjà : <CHEMIN_PLAN>.
Valide sa faisabilité contre le code courant (chemins réalistes, pas de conflit, tasks TDD complètes).
NE le réécris pas s'il est bon — adopte-le. Corrige/complète seulement les trous.
Écris le verdict dans data/cycle/plan_verdict.json (plan_path = ce plan)."
)
```

Lis `data/cycle/plan_verdict.json` :
- `approved` → Step 4
- `blocked` → affiche la raison (`risks`), STOP (le plan a des trous à corriger d'abord)
- `needs_input` → dis ce qu'il faut, STOP

## Step 4 — Build — dispatch builder

```
Agent(
  subagent_type="builder",
  prompt="Implémente le plan task-par-task en TDD.
Plan : data/cycle/plan_verdict.json (champ plan_path).
Suis tes instructions d'agent exactement (un test qui échoue d'abord, portes, un commit par task, PR).
Écris le résultat dans data/cycle/build_verdict.json. NE merge PAS."
)
```

Lis `data/cycle/build_verdict.json` :
- `pr_created` avec `items_skipped: []` → Step 5
- `pr_created` avec `items_skipped` non vide → rejet — commente la PR, STOP (le builder ne livre pas une PR avec des tasks sautées).
- `failed` → affiche la raison, STOP.
- `blocked` → affiche la raison, STOP (problème de plan/architecture — ça se corrige au Step 2/3).

## Step 5 — Judge — dispatch judge (revue 2 étapes)

```bash
gh pr list --base "$BASE" --state open --json number,title --limit 10
```

```
Agent(
  subagent_type="judge",
  prompt="Reviews la PR #<PR_NUMBER>.
Plan : data/cycle/plan_verdict.json
Lance le Stage 1 (conformité au plan, preuve fichier:ligne) PUIS le Stage 2 (sandbox : build/typecheck/test + qualité).
Suis tes instructions d'agent exactement (schéma de verdict strict, sortie sandbox obligatoire).
Écris le résultat dans data/cycle/review_verdict_pr<PR_NUMBER>.json."
)
```

Lis `data/cycle/review_verdict_pr<N>.json` :
- Valide le schéma. Si le bloc `sandbox` manque ou est vide → REJETTE le verdict, redispatche le judge.
- `verdict: approved` → Step 6
- `verdict: request_changes` → Step 7
- `verdict: rejected` → ferme la PR avec la raison, STOP

## Step 6 — Merge

```bash
gh pr merge <PR_NUMBER> --rebase --delete-branch
```

(Rebase merge, PAS squash : rejoue les commits tels quels, sans commit de merge.)

Si un fichier de statut existe (`docs/STATUS.md`), marque le livrable comme fait.

**Pas de déploiement automatique** : le cycle s'arrête au merge.

## Step 7 — Re-build sur request_changes (max 2 retries)

```
Agent(
  subagent_type="builder",
  prompt="Traite le feedback du judge sur la PR #<PR_NUMBER>.
Verdict : data/cycle/review_verdict_pr<N>.json
Pour chaque blocking_item et problème important, corrige-le. Relance toutes les portes.
Pousse sur la même branche. NE merge PAS. Écris un data/cycle/build_verdict.json à jour."
)
```

Puis reboucle au Step 5 (redispatche le judge).

Après 2 retries en `request_changes` :
- Ferme la PR avec le dernier verdict en commentaire, STOP.

## Step 8 — Retour sur la branche d'intégration

```bash
git checkout "$BASE"
git pull origin "$BASE"
```

## Résumé

```
/cycle <plan|description>
  ├─ plan fourni ? → researcher VALIDE le plan   (sinon researcher CRÉE le plan)
  ├─ Agent(researcher) → data/cycle/plan_verdict.json
  ├─ Agent(builder)    → TDD par task, un commit/task, portes, PR (pas d'issue)
  ├─ Agent(judge)      → Stage 1 conformité au plan → Stage 2 sandbox + qualité
  │     ├─ approved          → merge (rebase)
  │     ├─ request_changes   → builder corrige + re-judge (max 2x)
  │     └─ rejected          → ferme la PR
  └─ git checkout <base>
```

## Règles
- NE fais JAMAIS le travail toi-même — lance `Agent()` à chaque phase
- Un plan par invocation de cycle
- Max 2 retries builder→judge avant de fermer la PR
- Le verdict du judge DOIT inclure la sortie sandbox — rejette le verdict si elle manque
- TOUTE modif passe par une PR (jamais de push direct sur la base) — **pas d'issue GitHub**
- Merge en rebase, PAS squash
- NE modifie JAMAIS `dist/` ni `node_modules/`
- Les fichiers de relais (`data/cycle/*.json`) sont éphémères — garde-les git-ignorés
```
