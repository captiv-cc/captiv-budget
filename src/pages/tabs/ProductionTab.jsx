import { Clapperboard, FileText, Link2, StickyNote, CheckSquare } from 'lucide-react'

const FEATURES_BRIEF = [
  'Champ brief créatif libre (texte riche)',
  'Notes de repérage et contraintes techniques',
  'Informations logistiques (transport, hébergement, restauration)',
  'Contacts clés du projet (directeur artistique, client référent...)',
]

const FEATURES_DRIVE = [
  'Lien vers le dossier Google Drive du projet',
  'Affichage des derniers fichiers modifiés',
  'Accès rapide aux documents (script, storyboard, rushs, exports...)',
]

const FEATURES_CLOTURE = [
  'Champ "Bilan de production" : points forts, imprévus, recommandations',
  'Passage automatique du projet en statut "Archivé"',
  'Données conservées pour alimenter les futurs devis similaires',
]

export default function ProductionTab() {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'var(--purple-bg)' }}
        >
          <Clapperboard className="w-5 h-5" style={{ color: 'var(--purple)' }} />
        </div>
        <div>
          <h1 className="text-lg font-bold" style={{ color: 'var(--txt)' }}>
            Production
          </h1>
          <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
            Brief, notes opérationnelles & clôture de projet
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
        <FeatureBlock
          icon={StickyNote}
          color="purple"
          title="Brief & notes de production"
          description="Centralisez toutes les informations opérationnelles du projet en un seul endroit."
          features={FEATURES_BRIEF}
        />

        <FeatureBlock
          icon={Link2}
          color="blue"
          title="Google Drive"
          description="Accédez directement aux documents du projet sans quitter l'app."
          features={FEATURES_DRIVE}
        />

        <FeatureBlock
          icon={FileText}
          color="green"
          title="Clôture de projet"
          description="Bilan de production et archivage structuré en fin de projet."
          features={FEATURES_CLOTURE}
        />
      </div>
    </div>
  )
}

function FeatureBlock({ icon: Icon, color, title, description, features }) {
  const colors = {
    blue: { bg: 'var(--blue-bg)', fg: 'var(--blue)' },
    purple: { bg: 'rgba(156,95,253,.12)', fg: 'var(--purple)' },
    green: { bg: 'rgba(0,200,117,.12)', fg: 'var(--green)' },
  }
  const c = colors[color] || colors.blue

  return (
    <div
      className="rounded-xl p-5"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: c.bg }}
        >
          <Icon className="w-4 h-4" style={{ color: c.fg }} />
        </div>
        <h3 className="font-semibold text-sm" style={{ color: 'var(--txt)' }}>
          {title}
        </h3>
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--txt-3)' }}>
        {description}
      </p>
      <ul className="space-y-2">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-xs" style={{ color: 'var(--txt-2)' }}>
            <CheckSquare
              className="w-3.5 h-3.5 shrink-0 mt-0.5"
              style={{ color: c.fg, opacity: 0.7 }}
            />
            {f}
          </li>
        ))}
      </ul>
    </div>
  )
}
