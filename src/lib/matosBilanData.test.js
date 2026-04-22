/**
 * Tests unitaires — matosBilanData.js (MAT-12)
 *
 * Couvre l'agrégation pure du bilan :
 *   - stats (total / checked / removed / additifs / byFlag)
 *   - exclusion removed du compteur total
 *   - bucket "Sans loueur"
 *   - items multi-loueur listés dans chaque bucket
 *   - comments triés chrono par item
 *   - filenames + slug + versionLabel
 *
 * Ne mock ni jsPDF, ni Supabase — on travaille sur un bundle JSON pur.
 */
import { describe, it, expect } from 'vitest'
import {
  aggregateBilanData,
  versionLabel,
  slug,
  bilanPdfFilename,
  bilanZipFilename,
  NO_LOUEUR_BUCKET_ID,
} from './matosBilanData'

// ─── Fixtures ──────────────────────────────────────────────────────────────

/** Builder compact pour des sessions de test. */
function makeSession({ items = [], item_loueurs = [], comments = [], loueurs, version = null, project = null, blocks } = {}) {
  return {
    project: project ?? { id: 'p1', title: 'Matrice Golden', ref_projet: 'MTX-2026-03' },
    version: version ?? { id: 'v1', project_id: 'p1', numero: 1, label: 'Essais', is_active: true, closed_at: null, closed_by_name: null, bilan_archive_path: null },
    blocks: blocks ?? [
      { id: 'bA', titre: 'Caméra', couleur: '#000', affichage: 'list', sort_order: 1 },
      { id: 'bB', titre: 'Machinerie', couleur: '#000', affichage: 'list', sort_order: 2 },
    ],
    items,
    loueurs: loueurs ?? [
      { id: 'LA', nom: 'Lux Camera', couleur: '#ff0000' },
      { id: 'LB', nom: 'Panavision', couleur: '#00ff00' },
    ],
    item_loueurs,
    comments,
    attachments: [],
  }
}

function makeItem(id, blockId, patch = {}) {
  return {
    id,
    block_id: blockId,
    designation: `Item ${id}`,
    quantite: 1,
    flag: null,
    pre_check_at: null,
    pre_check_by_name: null,
    added_during_check: false,
    added_by_name: null,
    added_at: null,
    removed_at: null,
    removed_by_name: null,
    removed_reason: null,
    sort_order: 0,
    created_at: '2026-04-22T10:00:00Z',
    ...patch,
  }
}

// ─── aggregateBilanData — shape ────────────────────────────────────────────

describe('aggregateBilanData', () => {
  it('retourne une structure vide cohérente pour null/session absente', () => {
    const result = aggregateBilanData(null)
    expect(result.project).toBe(null)
    expect(result.version).toBe(null)
    expect(result.global.blocks).toEqual([])
    expect(result.global.stats.total).toBe(0)
    expect(result.byLoueur).toEqual([])
  })

  it('expose project + version tels quels', () => {
    const session = makeSession()
    const result = aggregateBilanData(session)
    expect(result.project).toEqual(session.project)
    expect(result.version).toEqual(session.version)
  })

  it('inclut tous les blocks dans le global (même sans items)', () => {
    const session = makeSession()
    const result = aggregateBilanData(session)
    expect(result.global.blocks).toHaveLength(2)
    expect(result.global.blocks[0].block.id).toBe('bA')
    expect(result.global.blocks[1].block.id).toBe('bB')
    expect(result.global.blocks[0].items).toEqual([])
  })

  it('propage closed_at / closed_by_name depuis la version', () => {
    const session = makeSession({
      version: {
        id: 'v1', project_id: 'p1', numero: 2, label: null, is_active: true,
        closed_at: '2026-04-22T18:00:00Z',
        closed_by_name: 'Camille',
        bilan_archive_path: 'v1/bilan/bilan.zip',
      },
    })
    const result = aggregateBilanData(session)
    expect(result.global.closedAt).toBe('2026-04-22T18:00:00Z')
    expect(result.global.closedByName).toBe('Camille')
  })
})

// ─── Stats (global) ────────────────────────────────────────────────────────

describe('aggregateBilanData — global.stats', () => {
  it('compte correctement total/checked/ratio en excluant les removed', () => {
    const session = makeSession({
      items: [
        makeItem('i1', 'bA', { pre_check_at: '2026-04-22T11:00:00Z' }),
        makeItem('i2', 'bA', { pre_check_at: '2026-04-22T11:05:00Z' }),
        makeItem('i3', 'bA'),
        makeItem('i4', 'bB', { removed_at: '2026-04-22T12:00:00Z' }),
      ],
    })
    const { stats } = aggregateBilanData(session).global
    expect(stats.total).toBe(3)    // i4 exclu car removed
    expect(stats.checked).toBe(2)
    expect(stats.ratio).toBeCloseTo(2 / 3, 5)
    expect(stats.removed).toBe(1)
  })

  it('compte les additifs (actifs OU retirés)', () => {
    const session = makeSession({
      items: [
        makeItem('i1', 'bA', { added_during_check: true }),
        makeItem('i2', 'bA', { added_during_check: true, removed_at: '2026-04-22T13:00:00Z' }),
        makeItem('i3', 'bA'),
      ],
    })
    const { stats } = aggregateBilanData(session).global
    expect(stats.additifs).toBe(2)
    expect(stats.removed).toBe(1)
    expect(stats.total).toBe(2) // i3 + i1 ; i2 removed
  })

  it('agrège byFlag sur les items actifs uniquement', () => {
    const session = makeSession({
      items: [
        makeItem('i1', 'bA', { flag: 'ok' }),
        makeItem('i2', 'bA', { flag: 'attention' }),
        makeItem('i3', 'bA', { flag: 'probleme' }),
        makeItem('i4', 'bA', { flag: null }),
        makeItem('i5', 'bA', { flag: 'ok', removed_at: '2026-04-22T14:00:00Z' }),
      ],
    })
    const { stats } = aggregateBilanData(session).global
    expect(stats.byFlag).toEqual({ ok: 1, attention: 1, probleme: 1, none: 1 })
  })

  it('ratio = 0 quand il n\'y a aucun item actif', () => {
    const session = makeSession({
      items: [makeItem('i1', 'bA', { removed_at: '2026-04-22T14:00:00Z' })],
    })
    const { stats } = aggregateBilanData(session).global
    expect(stats.total).toBe(0)
    expect(stats.checked).toBe(0)
    expect(stats.ratio).toBe(0)
  })
})

// ─── Enrichissement items (loueurs + comments) ────────────────────────────

describe('aggregateBilanData — enrichissement items', () => {
  it('attache les loueurs résolus à chaque item', () => {
    const session = makeSession({
      items: [makeItem('i1', 'bA'), makeItem('i2', 'bA')],
      item_loueurs: [
        { id: 'il1', item_id: 'i1', loueur_id: 'LA' },
        { id: 'il2', item_id: 'i1', loueur_id: 'LB' },
        { id: 'il3', item_id: 'i2', loueur_id: 'LA' },
      ],
    })
    const result = aggregateBilanData(session)
    const items = result.global.blocks[0].items
    expect(items[0].id).toBe('i1')
    expect(items[0].loueurs.map((l) => l.id).sort()).toEqual(['LA', 'LB'])
    expect(items[1].loueurs.map((l) => l.id)).toEqual(['LA'])
  })

  it('attache les commentaires triés chrono ASC à chaque item', () => {
    const session = makeSession({
      items: [makeItem('i1', 'bA')],
      comments: [
        { id: 'c2', item_id: 'i1', body: 'deuxième', author_name: 'A', created_at: '2026-04-22T10:10:00Z' },
        { id: 'c1', item_id: 'i1', body: 'premier', author_name: 'B', created_at: '2026-04-22T10:05:00Z' },
      ],
    })
    const result = aggregateBilanData(session)
    const item = result.global.blocks[0].items[0]
    expect(item.comments.map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  it('items sans loueur → loueurs=[]', () => {
    const session = makeSession({ items: [makeItem('i1', 'bA')] })
    const result = aggregateBilanData(session)
    expect(result.global.blocks[0].items[0].loueurs).toEqual([])
  })
})

// ─── Tri + groupage par bloc ───────────────────────────────────────────────

describe('aggregateBilanData — tri par bloc', () => {
  it('trie les items par sort_order puis created_at', () => {
    const session = makeSession({
      items: [
        makeItem('i3', 'bA', { sort_order: 3, created_at: '2026-04-22T10:00:00Z' }),
        makeItem('i1', 'bA', { sort_order: 1, created_at: '2026-04-22T09:00:00Z' }),
        makeItem('i2a', 'bA', { sort_order: 2, created_at: '2026-04-22T09:30:00Z' }),
        makeItem('i2b', 'bA', { sort_order: 2, created_at: '2026-04-22T09:45:00Z' }),
      ],
    })
    const ids = aggregateBilanData(session).global.blocks[0].items.map((it) => it.id)
    expect(ids).toEqual(['i1', 'i2a', 'i2b', 'i3'])
  })
})

// ─── byLoueur — buckets ────────────────────────────────────────────────────

describe('aggregateBilanData — byLoueur', () => {
  it('crée un bucket par loueur avec items taggués uniquement', () => {
    const session = makeSession({
      items: [
        makeItem('i1', 'bA'),
        makeItem('i2', 'bA'),
      ],
      item_loueurs: [
        { id: 'il1', item_id: 'i1', loueur_id: 'LA' },
        { id: 'il2', item_id: 'i2', loueur_id: 'LB' },
      ],
    })
    const result = aggregateBilanData(session)
    expect(result.byLoueur).toHaveLength(2)
    expect(result.byLoueur[0].loueur.id).toBe('LA')
    expect(result.byLoueur[0].blocks[0].items.map((i) => i.id)).toEqual(['i1'])
    expect(result.byLoueur[1].loueur.id).toBe('LB')
    expect(result.byLoueur[1].blocks[0].items.map((i) => i.id)).toEqual(['i2'])
  })

  it('un item multi-loueur apparaît dans chaque bucket', () => {
    const session = makeSession({
      items: [makeItem('i1', 'bA')],
      item_loueurs: [
        { id: 'il1', item_id: 'i1', loueur_id: 'LA' },
        { id: 'il2', item_id: 'i1', loueur_id: 'LB' },
      ],
    })
    const result = aggregateBilanData(session)
    expect(result.byLoueur).toHaveLength(2)
    expect(result.byLoueur[0].blocks[0].items.map((i) => i.id)).toEqual(['i1'])
    expect(result.byLoueur[1].blocks[0].items.map((i) => i.id)).toEqual(['i1'])
  })

  it('un loueur sans aucun item assigné n\'apparaît pas dans byLoueur', () => {
    const session = makeSession({
      items: [makeItem('i1', 'bA')],
      item_loueurs: [{ id: 'il1', item_id: 'i1', loueur_id: 'LA' }],
      // LB existe dans `loueurs` mais n'a aucun item taggué → exclu du bilan.
    })
    const result = aggregateBilanData(session)
    expect(result.byLoueur.map((s) => s.loueur.id)).toEqual(['LA'])
  })

  it('crée un bucket "Sans loueur" (loueur=null) si items non-taggués', () => {
    const session = makeSession({
      items: [
        makeItem('i1', 'bA'),  // taggué LA
        makeItem('i2', 'bA'),  // sans tag
      ],
      item_loueurs: [{ id: 'il1', item_id: 'i1', loueur_id: 'LA' }],
    })
    const result = aggregateBilanData(session)
    expect(result.byLoueur).toHaveLength(2)
    const noLoueur = result.byLoueur.find((s) => s.loueur === null)
    expect(noLoueur).toBeTruthy()
    expect(noLoueur.blocks.flatMap((b) => b.items).map((i) => i.id)).toEqual(['i2'])
  })

  it('ne crée PAS de bucket "Sans loueur" si tous les items sont taggués', () => {
    const session = makeSession({
      items: [makeItem('i1', 'bA')],
      item_loueurs: [{ id: 'il1', item_id: 'i1', loueur_id: 'LA' }],
    })
    const result = aggregateBilanData(session)
    expect(result.byLoueur.find((s) => s.loueur === null)).toBeUndefined()
  })

  it('les stats par loueur reflètent uniquement les items de ce loueur', () => {
    const session = makeSession({
      items: [
        makeItem('i1', 'bA', { pre_check_at: '2026-04-22T10:00:00Z' }),
        makeItem('i2', 'bA'),
        makeItem('i3', 'bB', { flag: 'probleme' }),
      ],
      item_loueurs: [
        { id: 'il1', item_id: 'i1', loueur_id: 'LA' },
        { id: 'il2', item_id: 'i2', loueur_id: 'LA' },
        { id: 'il3', item_id: 'i3', loueur_id: 'LB' },
      ],
    })
    const result = aggregateBilanData(session)
    const la = result.byLoueur.find((s) => s.loueur?.id === 'LA')
    const lb = result.byLoueur.find((s) => s.loueur?.id === 'LB')
    expect(la.stats.total).toBe(2)
    expect(la.stats.checked).toBe(1)
    expect(lb.stats.total).toBe(1)
    expect(lb.stats.byFlag.probleme).toBe(1)
  })
})

// ─── Utilitaires exportés ──────────────────────────────────────────────────

describe('versionLabel', () => {
  it('retourne "" si null/undefined', () => {
    expect(versionLabel(null)).toBe('')
    expect(versionLabel(undefined)).toBe('')
  })
  it('renvoie "V1" quand pas de label', () => {
    expect(versionLabel({ numero: 1 })).toBe('V1')
  })
  it('renvoie "V2 — Essais" avec label', () => {
    expect(versionLabel({ numero: 2, label: 'Essais' })).toBe('V2 — Essais')
  })
  it('supporte version_number legacy', () => {
    expect(versionLabel({ version_number: 3 })).toBe('V3')
  })
  it('fallback "V?" si aucun numéro', () => {
    expect(versionLabel({ label: 'Orphelin' })).toBe('V? — Orphelin')
  })
})

describe('slug', () => {
  it('retire accents et lowercase', () => {
    expect(slug('Caméra Éclair')).toBe('camera-eclair')
  })
  it('retire caractères spéciaux', () => {
    expect(slug('Hey / there + 42!')).toBe('hey-there-42')
  })
  it('retourne string vide pour vide/null', () => {
    expect(slug('')).toBe('')
    expect(slug(null)).toBe('')
    expect(slug(undefined)).toBe('')
  })
  it('ne laisse pas de tiret en tête/queue', () => {
    expect(slug('-abc-')).toBe('abc')
    expect(slug('!!!abc!!!')).toBe('abc')
  })
})

describe('bilanPdfFilename', () => {
  const project = { ref_projet: 'MTX-2026-03', title: 'Matrice Golden' }
  const version = { numero: 1 }

  it('format global : <ref>_v<n>_bilan.pdf', () => {
    expect(bilanPdfFilename({ project, version })).toBe('MTX-2026-03_v1_bilan.pdf')
  })
  it('format par loueur : ajoute _loueur-<slug>', () => {
    expect(
      bilanPdfFilename({ project, version, loueur: { nom: 'Lux Camera' } })
    ).toBe('MTX-2026-03_v1_bilan_loueur-lux-camera.pdf')
  })
  it('fallback slug(title) si pas de ref_projet', () => {
    expect(
      bilanPdfFilename({ project: { title: 'Le Grand Film' }, version })
    ).toBe('le-grand-film_v1_bilan.pdf')
  })
})

describe('bilanZipFilename', () => {
  it('format <ref>_v<n>_bilan.zip', () => {
    expect(
      bilanZipFilename({ project: { ref_projet: 'MTX-2026-03' }, version: { numero: 1 } })
    ).toBe('MTX-2026-03_v1_bilan.zip')
  })
})

// ─── Sentinelle NO_LOUEUR_BUCKET_ID ───────────────────────────────────────

describe('NO_LOUEUR_BUCKET_ID', () => {
  it('est une constante stable exportée (sert de marqueur côté UI)', () => {
    expect(typeof NO_LOUEUR_BUCKET_ID).toBe('string')
    expect(NO_LOUEUR_BUCKET_ID.length).toBeGreaterThan(0)
  })
})
