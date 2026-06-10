// ════════════════════════════════════════════════════════════════════════════
// ShareLivrablesList — Liste des livrables groupés par bloc (LIV-24C)
// ════════════════════════════════════════════════════════════════════════════
//
// Groupe par bloc (sort_order), affiche un header de bloc puis une liste
// de cards livrables. Chaque card peut déplier un accordéon de versions
// envoyées + lien Frame.
//
// Empty state : message neutre si aucun livrable n'a encore été créé.
// ════════════════════════════════════════════════════════════════════════════

import { useMemo } from 'react'
import { Inbox } from 'lucide-react'
import ShareLivrableCard from './ShareLivrableCard'

export default function ShareLivrablesList({ blocks = [], livrables = [], versions = [], config = {} }) {
  // Indexe versions par livrable_id (sort déjà côté serveur).
  const versionsByLivrable = useMemo(() => {
    const map = new Map()
    for (const v of versions) {
      if (!map.has(v.livrable_id)) map.set(v.livrable_id, [])
      map.get(v.livrable_id).push(v)
    }
    return map
  }, [versions])

  // Groupe livrables par block_id, en gardant l'ordre des blocs.
  const groups = useMemo(() => {
    const byBlock = new Map()
    for (const b of blocks) byBlock.set(b.id, { block: b, livrables: [] })
    for (const l of livrables) {
      const g = byBlock.get(l.block_id)
      if (g) g.livrables.push(l)
    }
    // Filtre les blocs vides côté affichage (pas de bruit).
    return Array.from(byBlock.values()).filter((g) => g.livrables.length > 0)
  }, [blocks, livrables])

  if (groups.length === 0) {
    return (
      <section
        className="rounded-2xl shadow-sm p-10 text-center"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        <Inbox className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--txt-3)', opacity: 0.6 }} />
        <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
          Aucun livrable n&apos;a encore été ajouté à ce projet.
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--txt-3)' }}>
          Cette page sera mise à jour automatiquement dès qu&apos;un livrable sera publié.
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-5">
      {groups.map(({ block, livrables: blockLivrables }) => (
        <BlockSection
          key={block.id}
          block={block}
          livrables={blockLivrables}
          versionsByLivrable={versionsByLivrable}
          config={config}
        />
      ))}
    </section>
  )
}

function BlockSection({ block, livrables, versionsByLivrable, config }) {
  const blockColor = block.couleur || 'var(--txt-3)'
  return (
    <div>
      <header className="flex items-center gap-2 mb-3 px-1">
        <span
          className="inline-block w-2.5 h-2.5 rounded-full"
          style={{ background: blockColor }}
        />
        <h2
          className="text-sm font-semibold uppercase tracking-wider"
          style={{ color: 'var(--txt)' }}
        >
          {block.nom}
        </h2>
        <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
          · {livrables.length} livrable{livrables.length > 1 ? 's' : ''}
        </span>
      </header>
      <div className="grid grid-cols-1 gap-3">
        {livrables.map((livrable) => (
          <ShareLivrableCard
            key={livrable.id}
            livrable={livrable}
            block={block}
            versions={versionsByLivrable.get(livrable.id) || []}
            config={config}
          />
        ))}
      </div>
    </div>
  )
}
