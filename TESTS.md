# Tests automatisés — CAPTIV

Filet de sécurité du moteur métier. Doit toujours être au vert avant un
`git push` qui touche à `src/lib/` ou à un calcul de devis.

## Installation (une seule fois)

```bash
npm install
```

Ajoute `vitest` dans `devDependencies`. Aucun plugin ni configuration
nécessaire : Vitest détecte automatiquement les fichiers `*.test.js`.

## Lancer la suite

```bash
# Une exécution unique (mode CI)
npm run test

# Mode watch pendant le développement
npm run test:watch

# Interface graphique (optionnel, nécessite @vitest/ui)
npm run test:ui
```

## Ce qui est couvert

Fichier de tests : `src/lib/cotisations.test.js` — **58 cas répartis en 18
suites**, qui verrouillent tout le moteur de calcul :

| Suite                               | Couvre                                        |
| ----------------------------------- | --------------------------------------------- |
| Constantes et configuration         | `TAUX_DEFAUT`, `CATS`, `REGIMES_SALARIES`, `CATS_HUMAINS` |
| calcLine — ligne inactive           | `use_line = false` retourne bien des zéros    |
| calcLine — régime Frais             | Quantité × tarif, remise, `nb` multiplicateur |
| calcLine — régime Technique         | `cout_ht` explicite, null, `""`, 0, remises   |
| calcLine — Intermittents (salariés) | Coût = brut, charges 67 %, charges facturées  |
| calcLine — Ext. Intermittent        | Marge sur coût chargé, charges NON facturées  |
| calcLine — Interne / Externe        | 0 % charges, marge via `cout_ht`              |
| calcLine — taux custom              | Taux personnalisé, régime inconnu             |
| calcSynthese — cas vides            | Liste vide, lignes inactives                  |
| calcSynthese — agrégation           | Somme HT, TVA (0/10/20 %), acompte, solde     |
| calcSynthese — charges intermittents| Facturation des charges dans sous-total       |
| calcSynthese — dans_marge / hors    | Mg+Fg uniquement sur les blocs dans_marge     |
| calcSynthese — marge globale        | Appliquée sur CA dans_marge seulement         |
| calcSynthese — assurance            | Appliquée sur CA total                        |
| calcSynthese — remise globale       | % / montant / priorité du montant             |
| calcSynthese — scénario réaliste    | Captation Live complète, cohérence marge      |
| Formatteurs                         | `fmtEur`, `fmtPct`, `fmtNum`, valeurs nulles  |
| Invariants globaux                  | HT+TVA=TTC, acompte+solde=TTC                 |

## Conventions

- Chaque `it()` teste **un seul** comportement. Si un test en vérifie trois,
  il est découpé.
- Les montants non triviaux sont **calculés à la main dans un commentaire**
  juste avant `expect(...)` pour faciliter la relecture humaine.
- Utiliser `toBeCloseTo(x, 9)` pour les comparaisons de flottants (TVA,
  charges 67 %, etc.). `toBe(x)` uniquement quand la valeur est un entier
  représentable exactement.
- Helper `line(overrides)` en haut du fichier pour éviter la répétition
  des champs par défaut — ne jamais construire un objet ligne à la main
  dans un test.

## Avant d'ajouter un nouveau test

1. Se demander quel comportement on verrouille, et le résumer dans le
   titre du `it(...)`.
2. Calculer la valeur attendue **à la main** d'abord. Si on n'arrive pas à
   la calculer, c'est que le test n'est pas assez ciblé.
3. Ne jamais tester plusieurs régimes dans le même `it()` — faire un
   `it()` par régime.

## Intégration CI (à venir — chantier 4)

Ces tests seront lancés automatiquement dans la GitHub Action de CI (à
implémenter dans le chantier 4) pour bloquer tout merge qui casserait le
moteur de calcul.

```yaml
# .github/workflows/ci.yml (extrait prévu)
- name: Run tests
  run: npm run test
```

## Quand une régression est détectée

1. **Ne jamais ajuster le test pour le faire passer** sans comprendre
   pourquoi le comportement a changé.
2. Vérifier que le comportement attendu dans le test est bien celui
   qu'on veut (un test peut parfaitement être faux).
3. Si le test est correct et le code a divergé, corriger le code.
4. Si le comportement a volontairement changé (évolution métier),
   mettre à jour le test ET écrire un nouveau test pour le nouveau
   comportement, en commit séparé.
