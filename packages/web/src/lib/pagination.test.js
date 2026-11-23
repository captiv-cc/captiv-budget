import { describe, it, expect } from 'vitest'
import { lireToutesLesPages } from './pagination'

/**
 * Fausse requête PostgREST : rend les lignes `{ n }` de 0 à total - 1,
 * en respectant les bornes INCLUSIVES de `range`, comme le vrai client.
 */
function table(total, { erreur = null } = {}) {
  const appels = []
  const construire = () => ({
    range: async (de, a) => {
      appels.push([de, a])
      if (erreur) return { data: null, error: erreur }
      const fin = Math.min(total - 1, a)
      const data = []
      for (let i = de; i <= fin; i += 1) data.push({ n: i })
      return { data, error: null }
    },
  })
  return { construire, appels }
}

describe('lireToutesLesPages', () => {
  it('rend une table plus courte qu’une page en une requête', async () => {
    const t = table(42)
    const rows = await lireToutesLesPages(t.construire, 1000)
    expect(rows).toHaveLength(42)
    expect(t.appels).toEqual([[0, 999]])
  })

  it('ne perd aucune ligne au-delà de la limite PostgREST', async () => {
    // Le cas réel : la grille de la 2642 dépasse les 1 000 lignes servies
    // par défaut, et la liste des postes s'arrêtait au milieu de l'alphabet.
    const t = table(1624)
    const rows = await lireToutesLesPages(t.construire, 1000)
    expect(rows).toHaveLength(1624)
    expect(rows[1623]).toEqual({ n: 1623 })
    expect(new Set(rows.map((r) => r.n)).size).toBe(1624)
  })

  it('s’arrête quand la dernière page tombe juste', async () => {
    // Page pleine puis page vide : sans la requête de trop, on ne peut pas
    // savoir qu'il n'y a plus rien.
    const t = table(2000)
    const rows = await lireToutesLesPages(t.construire, 1000)
    expect(rows).toHaveLength(2000)
    expect(t.appels).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })

  it('rend une liste vide sur une table vide', async () => {
    const rows = await lireToutesLesPages(table(0).construire, 1000)
    expect(rows).toEqual([])
  })

  it('remonte l’erreur plutôt que de rendre une liste tronquée', async () => {
    const t = table(10, { erreur: new Error('permission denied') })
    await expect(lireToutesLesPages(t.construire, 1000)).rejects.toThrow('permission denied')
  })
})
