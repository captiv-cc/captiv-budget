import { Calendar, Clock, Film, FileText, CheckSquare } from 'lucide-react'

const FEATURES_RETROPLANNING = [
  'Phases macro configurables : Brief, Pré-prod, Tournage, Montage, Étalonnage, Mixage, Livraison',
  'Vue Gantt interactive avec glisser-déposer des phases',
  'Tâches par phase avec responsable et deadline',
  'Statuts : À faire / En cours / Terminé / Bloqué',
]

const FEATURES_TOURNAGE = [
  'Jours de tournage avec lieu, équipe convoquée et plan de travail',
  'Lien vers les phases du retroplanning',
]

const FEATURES_CALLSHEET = [
  'Génération automatique depuis les membres du projet + jours de tournage',
  'Heure de convocation individuelle par poste',
  "Lieu de rendez-vous, contacts d'urgence, notes logistiques",
  'Export PDF formaté aux standards audiovisuels',
  "Envoi par email directement depuis l'app",
]

export default function PlanningTab() {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'var(--blue-bg)' }}
        >
          <Calendar className="w-5 h-5" style={{ color: 'var(--blue)' }} />
        </div>
        <div>
          <h1 className="text-lg font-bold" style={{ color: 'var(--txt)' }}>
            Planning
          </h1>
          <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
            Retroplanning, jours de tournage & call sheets
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
          icon={Clock}
          color="blue"
          title="Retroplanning"
          description="Vision macro de toutes les phases du projet sur une timeline."
          features={FEATURES_RETROPLANNING}
        />

        <FeatureBlock
          icon={Film}
          color="purple"
          title="Jours de tournage"
          description="Organisation détaillée de chaque journée de tournage."
          features={FEATURES_TOURNAGE}
          comingSoon
        />

        <FeatureBlock
          icon={FileText}
          color="green"
          title="Call Sheet"
          description="Feuille de service générée automatiquement depuis l'équipe et le planning."
          features={FEATURES_CALLSHEET}
          comingSoon
        />
      </div>
    </div>
  )
}

function FeatureBlock({ icon: Icon, color, title, description, features, comingSoon }) {
  const colors = {
    blue: { bg: 'var(--blue-bg)', fg: 'var(--blue)' },
    purple: { bg: 'rgba(156,95,253,.12)', fg: 'var(--purple)' },
    green: { bg: 'rgba(0,200,117,.12)', fg: 'var(--green)' },
    amber: { bg: 'rgba(255,159,10,.12)', fg: 'var(--amber)' },
  }
  const c = colors[color] || colors.blue

  return (
    <div
      className="rounded-xl p-5"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
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
        {comingSoon && (
          <span
            className="text-[10px] px-2 py-0.5 rounded-full"
            style={{ background: 'var(--bg-elev)', color: 'var(--txt-3)' }}
          >
            Phase 2
          </span>
        )}
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
