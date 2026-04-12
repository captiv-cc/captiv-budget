import { CheckSquare, ArrowRight, RefreshCw, Package, CheckCircle2 } from 'lucide-react'

const STATUTS = [
  { key: 'en_production', label: 'En production', color: 'var(--txt-3)', dot: 'var(--txt-3)' },
  { key: 'v1_envoyee', label: 'V1 envoyée', color: 'var(--blue)', dot: 'var(--blue)' },
  { key: 'retours_v1', label: 'Retours V1', color: 'var(--amber)', dot: 'var(--amber)' },
  { key: 'v2_envoyee', label: 'V2 envoyée', color: 'var(--blue)', dot: 'var(--blue)' },
  { key: 'retours_v2', label: 'Retours V2', color: 'var(--amber)', dot: 'var(--amber)' },
  { key: 'valide', label: 'Validé ✓', color: 'var(--green)', dot: 'var(--green)' },
  { key: 'livre', label: 'Livré ✓✓', color: 'var(--green)', dot: 'var(--green)' },
]

const EXEMPLE_LIVRABLES = [
  { nom: 'Master 4K', format: 'ProRes 422 HQ', duree: '3min20' },
  { nom: 'Version diffusion web', format: 'H.264', duree: '3min20' },
  { nom: 'Version 30s Instagram', format: 'H.264 9:16', duree: '30s' },
  { nom: 'Version sous-titrée FR', format: 'H.264', duree: '3min20' },
  { nom: 'Musique seule (M&E)', format: 'WAV 48kHz', duree: '3min20' },
]

const FEATURES = [
  'Ajout de livrables avec format, durée, résolution et deadline',
  'Suivi du statut de révision de V1 → Validé → Livré',
  'Compteur de révisions incluses / réalisées',
  'Historique des versions avec lien de visionnage (Drive, Frame.io...)',
  'Notes de retours client par version',
  'Lien de téléchargement du master final',
]

export default function LivrablesTab() {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'var(--green-bg)' }}
        >
          <CheckSquare className="w-5 h-5" style={{ color: 'var(--green)' }} />
        </div>
        <div>
          <h1 className="text-lg font-bold" style={{ color: 'var(--txt)' }}>
            Livrables
          </h1>
          <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
            Suivi des livrables et révisions client
          </p>
        </div>
        <span
          className="ml-auto text-xs px-3 py-1 rounded-full font-medium"
          style={{ background: 'var(--amber-bg)', color: 'var(--amber)' }}
        >
          En développement
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Aperçu de ce qui sera construit */}
        <div
          className="rounded-xl p-5"
          style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Package className="w-4 h-4" style={{ color: 'var(--green)' }} />
            <h3 className="font-semibold text-sm" style={{ color: 'var(--txt)' }}>
              Fonctionnalités à venir
            </h3>
          </div>
          <ul className="space-y-2">
            {FEATURES.map((f, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-xs"
                style={{ color: 'var(--txt-2)' }}
              >
                <CheckCircle2
                  className="w-3.5 h-3.5 shrink-0 mt-0.5"
                  style={{ color: 'var(--green)', opacity: 0.7 }}
                />
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* Cycle de révision */}
        <div
          className="rounded-xl p-5"
          style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
        >
          <div className="flex items-center gap-2 mb-4">
            <RefreshCw className="w-4 h-4" style={{ color: 'var(--blue)' }} />
            <h3 className="font-semibold text-sm" style={{ color: 'var(--txt)' }}>
              Cycle de révision
            </h3>
          </div>
          <div className="space-y-1.5">
            {STATUTS.map((s, i) => (
              <div key={s.key} className="flex items-center gap-2.5">
                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.dot }} />
                <span className="text-xs" style={{ color: s.color }}>
                  {s.label}
                </span>
                {i < STATUTS.length - 1 && (
                  <ArrowRight className="w-3 h-3 ml-auto" style={{ color: 'var(--brd)' }} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Aperçu du tableau de livrables */}
        <div
          className="md:col-span-2 rounded-xl p-5"
          style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
        >
          <h3 className="font-semibold text-sm mb-4" style={{ color: 'var(--txt)' }}>
            Aperçu — tableau des livrables
          </h3>
          <div
            className="rounded-lg overflow-hidden"
            style={{ border: '1px solid var(--brd-sub)', opacity: 0.6 }}
          >
            {/* Header */}
            <div
              className="grid text-[10px] font-bold uppercase tracking-wider px-4 py-2"
              style={{
                gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
                background: 'var(--bg-elev)',
                color: 'var(--txt-3)',
              }}
            >
              <span>Livrable</span>
              <span>Format</span>
              <span>Durée</span>
              <span>Révisions</span>
              <span>Statut</span>
            </div>
            {EXEMPLE_LIVRABLES.map((l, i) => (
              <div
                key={i}
                className="grid items-center px-4 py-2.5 text-xs"
                style={{
                  gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
                  borderTop: '1px solid var(--brd-sub)',
                  color: 'var(--txt-2)',
                }}
              >
                <span className="font-medium" style={{ color: 'var(--txt)' }}>
                  {l.nom}
                </span>
                <span>{l.format}</span>
                <span>{l.duree}</span>
                <span>0 / 2</span>
                <span
                  className="text-[11px] px-2 py-0.5 rounded-full w-fit"
                  style={{ background: 'var(--bg-elev)', color: 'var(--txt-3)' }}
                >
                  En production
                </span>
              </div>
            ))}
          </div>
          <p className="text-[11px] mt-3 text-center" style={{ color: 'var(--txt-3)' }}>
            Exemple fictif — les données réelles s&apos;afficheront ici
          </p>
        </div>
      </div>
    </div>
  )
}
