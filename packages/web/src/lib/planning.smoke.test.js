/**
 * Smoke test — planning.js (scope des queries listPlanningViews)
 *
 * Ces tests sont statiques : ils parsent la source pour garantir que les
 * wrappers Supabase restent dans le bon scope (projet strict vs global strict).
 *
 * Contexte du 2026-04-19 : une régression introduite avant PG-4 faisait
 * listPlanningViews(projectId) remonter AUSSI les vues globales (project_id
 * NULL) via `.or('project_id.eq.<id>,project_id.is.null')`. Résultat : dans
 * un projet, on voyait en doublon toutes les vues globales déjà créées sur
 * /planning (Mois + Mois2, Jour + Jour, Kanban + Kanban, etc.).
 *
 * Le fix : listPlanningViews filtre maintenant STRICTEMENT sur project_id.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(__dirname, 'planning.js'), 'utf8')

describe('planning.js — scope des listes de vues (régression 2026-04-19)', () => {
  it('listPlanningViews filtre STRICTEMENT sur project_id (pas d\'OR avec project_id IS NULL)', () => {
    // Extrait le corps de listPlanningViews
    const m = SRC.match(
      /export\s+async\s+function\s+listPlanningViews\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/,
    )
    expect(m, 'listPlanningViews introuvable dans planning.js').toBeTruthy()
    const body = m[1]
    // Le bon filtre
    expect(body).toMatch(/\.eq\(\s*['"]project_id['"]\s*,\s*projectId\s*\)/)
    // L'ancien filtre cassé NE doit plus être là
    expect(body).not.toMatch(/project_id\.eq\..*project_id\.is\.null/)
    expect(body).not.toMatch(/\.or\s*\(\s*`?project_id\.eq/)
  })

  it('listGlobalPlanningViews filtre STRICTEMENT sur project_id IS NULL', () => {
    const m = SRC.match(
      /export\s+async\s+function\s+listGlobalPlanningViews\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/,
    )
    expect(m, 'listGlobalPlanningViews introuvable dans planning.js').toBeTruthy()
    const body = m[1]
    expect(body).toMatch(/\.is\(\s*['"]project_id['"]\s*,\s*null\s*\)/)
  })

  it('listPlanningViews retombe sur BUILTIN_PLANNING_VIEWS si list vide (et pas de mélange)', () => {
    const m = SRC.match(
      /export\s+async\s+function\s+listPlanningViews\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/,
    )
    const body = m[1]
    // Fallback builtin quand list.length === 0
    expect(body).toMatch(/list\.length\s*===\s*0/)
    expect(body).toMatch(/BUILTIN_PLANNING_VIEWS/)
    // Plus de spread mixte [...BUILTIN, ...list] qui amenait les doublons
    expect(body).not.toMatch(/\[\s*\.\.\.BUILTIN_PLANNING_VIEWS\s*,\s*\.\.\.list\s*\]/)
  })
})
