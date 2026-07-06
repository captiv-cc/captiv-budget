// ════════════════════════════════════════════════════════════════════════════
// PlanCommentMarkers — marqueurs numérotés des commentaires ancrés
// ════════════════════════════════════════════════════════════════════════════
//
// Rendu comme ENFANT de <Tldraw> (contexte editor requis) : suit la caméra
// (pan/zoom) en convertissant les ancrages page → viewport. Marqueurs jaunes
// numérotés (cf. mockup cadrage), résolus masqués.
//
// Utilisé par l'éditeur desk ET la page client publique.
// ════════════════════════════════════════════════════════════════════════════

import { useEditor, useValue } from 'tldraw'

export default function PlanCommentMarkers({ comments, selectedId, onSelect }) {
  const editor = useEditor()
  const camera = useValue('camera', () => editor.getCamera(), [editor])

  const roots = (comments || []).filter(
    (c) => !c.parent_id && c.anchor_x != null && !c.resolved,
  )
  if (!roots.length) return null

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 400 }}>
      {roots.map((c, i) => {
        const x = (Number(c.anchor_x) + camera.x) * camera.z
        const y = (Number(c.anchor_y) + camera.y) * camera.z
        const active = c.id === selectedId
        // Interne (équipe, invisible des liens de partage) = bleu ; sinon jaune.
        const interne = Boolean(c.internal)
        return (
          <button
            key={c.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onSelect?.(c.id)
            }}
            className="absolute pointer-events-auto flex items-center justify-center font-bold rounded-full rounded-bl-none transition-transform"
            style={{
              left: x,
              top: y,
              width: 26,
              height: 26,
              transform: `translate(-4px, -26px) scale(${active ? 1.2 : 1})`,
              background: interne ? '#4d9fff' : '#facc15',
              color: interne ? '#ffffff' : '#1c1917',
              fontSize: 12,
              border: '2px solid #ffffff',
              boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
            }}
            title={`${interne ? '[interne] ' : ''}${c.author_client_name || c.author?.full_name || 'Commentaire'} : ${c.body.slice(0, 80)}`}
          >
            {i + 1}
          </button>
        )
      })}
    </div>
  )
}
