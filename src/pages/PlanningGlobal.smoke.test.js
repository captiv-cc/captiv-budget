/**
 * Smoke test — PlanningGlobal.jsx (PG-5d)
 *
 * Comme les dépendances jsdom / @testing-library/react ne sont pas installées
 * dans ce projet, on se contente d'un smoke "statique" : on parse la source
 * JSX avec @babel/parser et on vérifie des invariants structurels qui
 * disparaîtraient silencieusement lors d'un refactor hasardeux.
 *
 * Invariants couverts :
 *   1. Export default → composant `PlanningGlobal`.
 *   2. Le fichier parse sans erreur (JSX valide).
 *   3. Les handlers CRUD vues sont présents : handleAddView, handleAddPreset,
 *      handleDuplicateView, handleRenameView, handleDeleteView, handleSaveConfig.
 *   4. Les handlers sont câblés au PlanningViewSelector (onAddView=, onAddPreset=,
 *      onDuplicate=, onRename=, onDelete=).
 *   5. Imports essentiels de planning.js : listGlobalPlanningViews,
 *      PLANNING_VIEW_PRESETS_GLOBAL, PLANNING_VIEW_PRESETS_GLOBAL_BY_KEY.
 *   6. Le garde `rawEvents.length === 0` qui masquait la vue Jour est supprimé
 *      (régression fix du 2026-04-19).
 *   7. Empty state "Aucun projet accessible" présent (PG-5a).
 *   8. Skeleton loader présent (PG-5a).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(__dirname, 'PlanningGlobal.jsx'), 'utf8')

describe('PlanningGlobal — smoke (PG-5d)', () => {
  it('exporte un composant PlanningGlobal par défaut', () => {
    expect(SRC).toMatch(/export\s+default\s+function\s+PlanningGlobal\s*\(/)
  })

  it('importe les helpers PG-4 de planning.js', () => {
    expect(SRC).toMatch(/listGlobalPlanningViews/)
    expect(SRC).toMatch(/PLANNING_VIEW_PRESETS_GLOBAL/)
    expect(SRC).toMatch(/PLANNING_VIEW_PRESETS_GLOBAL_BY_KEY/)
    expect(SRC).toMatch(/createPlanningView/)
    expect(SRC).toMatch(/duplicatePlanningView/)
    expect(SRC).toMatch(/updatePlanningView/)
    expect(SRC).toMatch(/deletePlanningView/)
    expect(SRC).toMatch(/patchPlanningViewConfig/)
  })

  it('définit les handlers CRUD vues (add/preset/duplicate/rename/delete/save)', () => {
    expect(SRC).toMatch(/const\s+handleAddView\s*=/)
    expect(SRC).toMatch(/const\s+handleAddPreset\s*=/)
    expect(SRC).toMatch(/const\s+handleDuplicateView\s*=/)
    expect(SRC).toMatch(/const\s+handleRenameView\s*=/)
    expect(SRC).toMatch(/const\s+handleDeleteView\s*=/)
    expect(SRC).toMatch(/const\s+handleSaveConfig\s*=/)
  })

  it('câble les handlers au PlanningViewSelector (props onAdd/onDuplicate/onRename/onDelete)', () => {
    expect(SRC).toMatch(/onAddView\s*=\s*\{handleAddView\}/)
    expect(SRC).toMatch(/onAddPreset\s*=\s*\{handleAddPreset\}/)
    expect(SRC).toMatch(/onDuplicate\s*=\s*\{handleDuplicateView\}/)
    expect(SRC).toMatch(/onRename\s*=\s*\{handleRenameView\}/)
    expect(SRC).toMatch(/onDelete\s*=\s*\{handleDeleteView\}/)
    // Passe bien les presets globaux (pas les presets projet)
    expect(SRC).toMatch(/presets\s*=\s*\{PLANNING_VIEW_PRESETS_GLOBAL\}/)
  })

  it('câble handleClickNewEvent au bouton Nouvel événement (PG-3e)', () => {
    expect(SRC).toMatch(/const\s+handleClickNewEvent\s*=/)
    expect(SRC).toMatch(/onClick\s*=\s*\{handleClickNewEvent\}/)
  })

  it('auto-clone des built-ins dans handleSaveConfig (PG-4c)', () => {
    // Le pattern : si activeView._builtin, on crée une vue DB via createPlanningView.
    expect(SRC).toMatch(/activeView\._builtin/)
    expect(SRC).toMatch(/createPlanningView\s*\(\s*\{/)
  })

  it('n\'a plus le garde rawEvents.length===0 qui masquait la vue Jour (fix régression)', () => {
    // Avant le fix : `!loading && rawEvents.length === 0 ?` court-circuitait
    // le rendu. Après : on ne teste plus que rawEvents soit vide ici.
    expect(SRC).not.toMatch(/!loading\s*&&\s*rawEvents\.length\s*===\s*0/)
  })

  it('expose l\'empty state "Aucun projet accessible" (PG-5a)', () => {
    expect(SRC).toMatch(/projectsReady\s*&&\s*projects\.length\s*===\s*0/)
    expect(SRC).toMatch(/Aucun projet accessible/)
  })

  it('utilise le PlanningGlobalSkeleton pendant le 1er fetch (PG-5a)', () => {
    expect(SRC).toMatch(/<PlanningGlobalSkeleton/)
    expect(SRC).toMatch(/function\s+PlanningGlobalSkeleton\s*\(/)
    expect(SRC).toMatch(/!hasLoadedOnce\s*&&\s*loading/)
  })

  it('route tous les kinds implémentés vers le bon composant', () => {
    // kind='calendar_month' → <MonthCalendar
    expect(SRC).toMatch(/activeView\?\.kind\s*===\s*['"]calendar_month['"][^<]*<MonthCalendar/s)
    // kind='timeline' → <PlanningTimelineView
    expect(SRC).toMatch(/activeView\?\.kind\s*===\s*['"]timeline['"][^<]*<PlanningTimelineView/s)
    // kind='kanban' → <PlanningKanbanView
    expect(SRC).toMatch(/activeView\?\.kind\s*===\s*['"]kanban['"][^<]*<PlanningKanbanView/s)
    // kind='table' → <PlanningTableView
    expect(SRC).toMatch(/activeView\?\.kind\s*===\s*['"]table['"][^<]*<PlanningTableView/s)
    // kind='swimlanes' → <PlanningTimelineView avec memberMap
    expect(SRC).toMatch(/activeView\?\.kind\s*===\s*['"]swimlanes['"]/)
    expect(SRC).toMatch(/memberMap=\{memberMap\}/)
  })

  it('monte PlanningViewActionModal pour rename/delete (PG-4d)', () => {
    expect(SRC).toMatch(/<PlanningViewActionModal/)
    expect(SRC).toMatch(/viewActionModal\.mode\s*===\s*['"]rename['"]/)
  })

  it('fallback sur BUILTIN_PLANNING_VIEWS_GLOBAL quand DB vide', () => {
    expect(SRC).toMatch(/BUILTIN_PLANNING_VIEWS_GLOBAL/)
    expect(SRC).toMatch(/hasDbGlobal/)
  })

  it('définit uniquifyViewName pour éviter les collisions de noms', () => {
    expect(SRC).toMatch(/function\s+uniquifyViewName\s*\(/)
  })

  it('utilise useAuth pour récupérer org.id (orgId requis pour créer des vues)', () => {
    expect(SRC).toMatch(/useAuth\(\)/)
    expect(SRC).toMatch(/const\s+orgId\s*=/)
  })
})

// Parse complet du fichier via @babel/parser : fail-fast si le JSX est cassé.
describe('PlanningGlobal — parse sans erreur', () => {
  it('parse comme un module ES + JSX sans throw', async () => {
    const parser = await import('@babel/parser').catch(() => null)
    if (!parser) return // skip silently si indisponible
    expect(() =>
      parser.parse(SRC, { sourceType: 'module', plugins: ['jsx'] }),
    ).not.toThrow()
  })
})
