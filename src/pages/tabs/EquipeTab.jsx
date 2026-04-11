/**
 * Onglet CREW v6
 * - canSeeFinance    : vente HT, coût estimé, salaire brut (intermittents)
 * - canSeeCrewBudget : budget convenu (coordinateur inclus)
 * - Dropdown portal avec détection haut/bas (no clipping)
 * - Salaire brut intermittent visible avec label "→ MovinMotion"
 * - Lien direct vers la ligne de devis correspondante
 */
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link, useOutletContext } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { calcLine, fmtEur, CATS_HUMAINS, REGIMES_SALARIES } from '../../lib/cotisations'
import { BLOCS_CANONIQUES, getBlocInfo } from '../../lib/blocs'
import {
  Users, Trash2, Phone, Mail, Search, X,
  Banknote, Link2, Save, Download, Check,
  AlertCircle, ChevronDown, Edit2, ExternalLink,
} from 'lucide-react'

// ─── Statuts — clés = valeurs exactes en DB (pas de contrainte violation) ────
const STEPS = [
  { key: 'non_applicable', label: 'À attribuer', color: 'var(--txt-3)',  bg: 'var(--bg-elev)'       },
  { key: 'a_integrer',     label: 'Recherche',   color: 'var(--blue)',   bg: 'rgba(0,122,255,.12)'  },
  { key: 'integre',        label: 'Contacté',    color: 'var(--purple)', bg: 'rgba(156,95,253,.12)' },
  { key: 'contrat_signe',  label: 'Validé',      color: 'var(--green)',  bg: 'rgba(0,200,117,.12)'  },
  { key: 'paie_terminee',  label: 'Réglé',       color: 'var(--amber)',  bg: 'rgba(255,174,0,.12)'  },
]

// Clés compatibles DB (paie_en_cours → même step que contrat_signe)
function getStep(key) {
  if (key === 'paie_en_cours') key = 'contrat_signe'
  return STEPS.find(s => s.key === key) || STEPS[0]
}

function fullName(m) { return `${m.prenom || ''} ${m.nom || ''}`.trim() || '—' }
function initials(m) { return ((m.prenom?.[0] || '') + (m.nom?.[0] || '')).toUpperCase() || '?' }

function regimeStyle(regime) {
  if (!regime) return { bg: 'var(--bg-elev)', color: 'var(--txt-3)', border: '1px solid var(--brd-sub)' }
  const r = regime.toLowerCase()
  if (r.includes('intermittent')) return { bg: 'rgba(156,95,253,.14)', color: 'var(--purple)', border: '1px solid rgba(156,95,253,.3)' }
  if (r === 'interne')            return { bg: 'rgba(0,122,255,.12)',  color: 'var(--blue)',   border: '1px solid rgba(0,122,255,.28)' }
  if (r.includes('salarié'))      return { bg: 'rgba(255,174,0,.12)',  color: 'var(--amber)',  border: '1px solid rgba(255,174,0,.28)' }
  if (r.includes('micro') || r.includes('auto-entrepreneur'))
                                  return { bg: 'rgba(255,59,48,.09)',  color: 'var(--red)',    border: '1px solid rgba(255,59,48,.22)' }
  // Externe (défaut)
  return { bg: 'rgba(0,200,117,.1)', color: 'var(--green)', border: '1px solid rgba(0,200,117,.28)' }
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function EquipeTab() {
  const { project, devisList }             = useOutletContext()
  const { canSeeFinance, canSeeCrewBudget, org } = useAuth()
  const projectId = project?.id

  const refDevis = devisList.find(d => d.status === 'accepte') || devisList[devisList.length - 1]

  const [crewLines,   setCrewLines]   = useState([])
  const [membres,     setMembres]     = useState([])
  const [catMap,      setCatMap]      = useState({}) // category_id → blocInfo
  const [loading,     setLoading]     = useState(true)
  const [toast,       setToast]       = useState(null)
  const [activeTab,   setActiveTab]   = useState('attribution') // 'attribution' | 'equipe'

  useEffect(() => { if (projectId) load() }, [projectId, refDevis?.id])

  async function load() {
    setLoading(true)
    try {
      const [linesRes, catsRes, memsRes] = await Promise.all([
        refDevis?.id
          ? supabase.from('devis_lines').select('*').eq('devis_id', refDevis.id).order('sort_order')
          : Promise.resolve({ data: [] }),
        refDevis?.id
          ? supabase.from('devis_categories').select('id, name').eq('devis_id', refDevis.id)
          : Promise.resolve({ data: [] }),
        supabase
          .from('projet_membres')
          .select('*, contact:contacts(nom, prenom, email, telephone, specialite, tarif_jour_ref, user_id)')
          .eq('project_id', projectId)
          .order('created_at'),
      ])
      const crew = (linesRes.data || []).filter(l =>
        l.is_crew === true || CATS_HUMAINS.includes(l.regime)
      )
      setCrewLines(crew)
      setMembres(memsRes.data || [])
      // Construire la map category_id → infos du bloc canonique
      const map = {}
      for (const cat of (catsRes.data || [])) {
        map[cat.id] = getBlocInfo(cat.name)
      }
      setCatMap(map)
    } finally {
      setLoading(false)
    }
  }

  function showToast(text, ok = true) {
    setToast({ text, ok })
    setTimeout(() => setToast(null), 2500)
  }

  function getMembre(line) {
    return membres.find(m => m.devis_line_id === line.id)
        || membres.find(m => !m.devis_line_id && m.specialite?.toLowerCase() === (line.produit || '').toLowerCase())
  }

  const orphans = membres.filter(m =>
    !m.devis_line_id &&
    !crewLines.some(l => m.specialite?.toLowerCase() === (l.produit || '').toLowerCase())
  )

  // ── CRUD ──────────────────────────────────────────────────────────────────
  async function addMembre(line, contactOrData) {
    const payload = {
      project_id:         projectId,
      devis_line_id:      line.id,
      movinmotion_statut: 'a_integrer', // = "Recherche" dans l'affichage
      specialite:         line.produit || '',
      regime:             line.regime  || 'Externe',
    }
    if (contactOrData?.id && contactOrData?.org_id !== undefined) {
      Object.assign(payload, {
        contact_id: contactOrData.id,
        nom:        contactOrData.nom,
        prenom:     contactOrData.prenom,
        email:      contactOrData.email,
        telephone:  contactOrData.telephone,
        tarif_jour: contactOrData.tarif_jour_ref,
        regime:     contactOrData.regime || line.regime || 'Externe',
      })
    } else {
      Object.assign(payload, {
        nom:    contactOrData.nom,
        prenom: contactOrData.prenom,
        regime: contactOrData.regime || line.regime || 'Externe',
      })
    }
    const { data, error } = await supabase
      .from('projet_membres')
      .insert(payload)
      .select('*, contact:contacts(nom, prenom, email, telephone, specialite, tarif_jour_ref, user_id)')
      .single()
    if (!error && data) { setMembres(p => [...p, data]); showToast(`${fullName(data)} attribué·e`) }
  }

  async function updateMembre(id, fields) {
    setMembres(p => p.map(m => m.id === id ? { ...m, ...fields } : m))
    await supabase.from('projet_membres').update(fields).eq('id', id)
    showToast('Enregistré')
  }

  async function removeMembre(id) {
    if (!confirm('Désattribuer cette personne du poste ?')) return
    await supabase.from('projet_membres').delete().eq('id', id)
    setMembres(p => p.filter(m => m.id !== id))
    showToast('Retiré', false)
  }

  async function saveToBDD(membre) {
    if (!org?.id) return
    const { data: ct, error } = await supabase.from('contacts').insert({
      org_id: org.id, nom: membre.nom, prenom: membre.prenom,
      email: membre.email || null, telephone: membre.telephone || null,
      regime: membre.regime || 'Externe', specialite: membre.specialite || null,
      tarif_jour_ref: membre.tarif_jour || null, actif: true,
    }).select().single()
    if (error) { alert('Erreur : ' + error.message); return }
    await updateMembre(membre.id, { contact_id: ct.id })
    showToast(`${fullName(membre)} sauvegardé dans la BDD Crew`)
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const totalVente   = crewLines.reduce((s, l) => s + (calcLine(l).prixVenteHT || 0), 0)
  const totalCout    = crewLines.reduce((s, l) => s + (calcLine(l).coutCharge   || 0), 0)
  const nbAttribues  = crewLines.filter(l => getMembre(l)).length
  const nbValides    = membres.filter(m => ['contrat_signe','paie_en_cours','paie_terminee'].includes(m.movinmotion_statut)).length

  // ── Export CSV ────────────────────────────────────────────────────────────
  function exportCSV() {
    const rows = crewLines.map(line => {
      const m    = getMembre(line)
      const calc = calcLine(line)
      const step = m ? getStep(m.movinmotion_statut) : STEPS[0]
      const isIntermittent = REGIMES_SALARIES.includes(line.regime)
      const bloc = catMap[line.category_id]?.label || ''
      return [
        bloc, line.produit || '', line.regime || '',
        canSeeFinance ? fmtEur(calc.prixVenteHT) : '',
        canSeeFinance && isIntermittent ? fmtEur(calc.coutReelHT) : '',
        canSeeFinance ? fmtEur(calc.coutCharge) : '',
        canSeeCrewBudget && m?.budget_convenu != null ? fmtEur(m.budget_convenu) : '',
        m ? fullName(m) : '', m?.email || '', m?.telephone || '', step.label,
      ]
    })
    const headers = ['Bloc','Poste','Régime','Vente HT','Salaire brut','Coût chargé','Budget convenu','Nom','Email','Téléphone','Statut']
    const csv = [headers, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
    a.download = `crew-${project?.name || 'projet'}.csv`
    a.click()
  }

  if (loading) return (
    <div className="flex items-center justify-center p-16">
      <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: 'var(--blue)', borderTopColor: 'transparent' }} />
    </div>
  )

  if (!refDevis) return (
    <div className="flex items-center justify-center p-16">
      <div className="text-center">
        <AlertCircle className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--txt-3)', opacity: 0.4 }} />
        <p className="font-semibold text-sm" style={{ color: 'var(--txt-3)' }}>Aucun devis disponible</p>
        <p className="text-xs mt-1" style={{ color: 'var(--txt-3)', opacity: 0.7 }}>
          Créez un devis avec des lignes crew pour composer l'équipe
        </p>
      </div>
    </div>
  )

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">

      {/* ── Header KPIs + export ─────────────────────────────────────────── */}
      <div className="flex items-start gap-4">
        <div className="flex-1 grid grid-cols-2 gap-3">
          <KpiCard label="Postes" color={nbAttribues === crewLines.length ? 'green' : 'blue'}
            value={`${nbAttribues} / ${crewLines.length}`} sub="attribués" />
          <KpiCard label="Confirmés" color="purple"
            value={`${nbValides} / ${membres.length}`} sub="validés ou réglés" />
        </div>
        <button onClick={exportCSV} title="Exporter en CSV"
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg shrink-0 mt-0.5 transition-all"
          style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)', color: 'var(--txt-3)' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--txt)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--txt-3)'}>
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>

      {/* ── Onglets Attribution / Équipe ─────────────────────────────────── */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd-sub)' }}>
        {[
          { k: 'attribution', l: 'Attribution', hint: 'Gérer les postes un par un' },
          { k: 'equipe',      l: 'Équipe',      hint: 'Vue par personne' },
        ].map(({ k, l, hint }) => (
          <button key={k} onClick={() => setActiveTab(k)} title={hint}
            className="flex-1 py-2 text-sm font-medium rounded-lg transition-all"
            style={activeTab === k
              ? { background: 'var(--bg-surf)', color: 'var(--txt)',
                  boxShadow: '0 1px 4px rgba(0,0,0,.18)', border: '1px solid var(--brd-sub)' }
              : { color: 'var(--txt-3)', border: '1px solid transparent' }}>
            {l}
          </button>
        ))}
      </div>

      {/* ── Contenu selon onglet ─────────────────────────────────────────── */}
      {activeTab === 'attribution' ? (
        <>
          {crewLines.length === 0 ? (
            <div className="rounded-xl p-12 text-center"
              style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}>
              <Users className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--txt-3)', opacity: 0.4 }} />
              <p className="font-semibold text-sm" style={{ color: 'var(--txt-3)' }}>Aucun poste crew dans le devis</p>
              <p className="text-xs mt-1" style={{ color: 'var(--txt-3)', opacity: 0.7 }}>
                Ajoutez des lignes avec régime Intermittent, Interne, Externe ou Salarié
              </p>
            </div>
          ) : (() => {
            // Grouper les lignes crew par bloc canonique
            const groups = {}
            crewLines.forEach(line => {
              const info = catMap[line.category_id] || { key: '__autre__', label: 'Autre', color: '#888', canonicalIdx: 999 }
              const k = info.key
              if (!groups[k]) groups[k] = { info, lines: [] }
              groups[k].lines.push(line)
            })
            // Trier les groupes par ordre canonique
            const sortedGroups = Object.values(groups).sort((a, b) => a.info.canonicalIdx - b.info.canonicalIdx)
            return (
              <div className="space-y-6">
                {sortedGroups.map(({ info: bloc, lines }) => (
                  <div key={bloc.key}>
                    {/* En-tête de bloc */}
                    <div className="flex items-center gap-2 mb-3 px-1">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: bloc.color }} />
                      <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: bloc.color }}>
                        {bloc.label}
                      </span>
                      <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
                        — {lines.length} poste{lines.length > 1 ? 's' : ''}
                      </span>
                    </div>
                    {/* Cartes du bloc */}
                    <div className="space-y-3">
                      {lines.map(line => (
                        <PosteCard
                          key={line.id}
                          line={line}
                          bloc={bloc}
                          membre={getMembre(line)}
                          projectId={projectId}
                          devisId={refDevis.id}
                          onAdd={(c) => addMembre(line, c)}
                          onUpdate={updateMembre}
                          onRemove={removeMembre}
                          onSaveToBDD={saveToBDD}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}

          {/* Membres orphelins */}
          {orphans.length > 0 && (
            <div className="rounded-xl p-4" style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--txt-3)' }}>
                Membres sans poste lié au devis
              </p>
              <div className="space-y-2">
                {orphans.map(m => (
                  <div key={m.id} className="flex items-center gap-3 px-3 py-2 rounded-lg"
                    style={{ background: 'var(--bg-elev)' }}>
                    <Avatar m={m} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--txt)' }}>{fullName(m)}</p>
                      {m.specialite && <p className="text-xs" style={{ color: 'var(--txt-3)' }}>{m.specialite}</p>}
                    </div>
                    <button onClick={() => removeMembre(m.id)} className="p-1.5 rounded"
                      style={{ color: 'var(--txt-3)' }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--txt-3)'}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        /* ── Vue Équipe ────────────────────────────────────────────────── */
        <EquipeView
          membres={membres}
          crewLines={crewLines}
          catMap={catMap}
          canSeeFinance={canSeeFinance}
          canSeeCrewBudget={canSeeCrewBudget}
          projectId={projectId}
          devisId={refDevis?.id}
          onUpdate={updateMembre}
          onRemove={removeMembre}
        />
      )}

      {/* ── Toast ────────────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2"
          style={{
            background: toast.ok ? 'var(--green)' : 'var(--bg-surf)',
            color:      toast.ok ? 'white' : 'var(--txt)',
            border: '1px solid var(--brd)',
          }}>
          {toast.ok ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
          {toast.text}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// CARTE POSTE
// ══════════════════════════════════════════════════════════════════════════════
function PosteCard({ line, bloc, membre, projectId, devisId, onAdd, onUpdate, onRemove, onSaveToBDD }) {
  const statut = membre ? membre.movinmotion_statut : 'non_applicable'
  const step   = getStep(statut)

  const borderColor = statut === 'contrat_signe' || statut === 'paie_terminee' || statut === 'paie_en_cours'
    ? 'rgba(0,200,117,.35)'
    : statut === 'integre' ? 'rgba(156,95,253,.25)' : 'var(--brd)'

  const blocColor = bloc?.color || '#888'

  return (
    <div className="rounded-xl overflow-hidden transition-all"
      style={{ border: `1px solid ${borderColor}`, background: 'var(--bg-surf)', borderLeft: `3px solid ${blocColor}` }}>

      {/* ── En-tête ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3"
        style={{ borderBottom: '1px solid var(--brd-sub)' }}>

        {/* Statut */}
        {membre
          ? <StatusBadge statut={statut} membreId={membre.id} onUpdate={onUpdate} />
          : <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0"
              style={{ background: step.bg, color: step.color }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: step.color }} />
              {step.label}
            </span>
        }

        {/* Nom du poste + description */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--txt)' }}>
            {line.produit || '(sans nom)'}
          </p>
          {line.description && (
            <p className="text-[11px] truncate leading-tight mt-0.5" style={{ color: 'var(--txt-3)' }}>
              {line.description}
            </p>
          )}
        </div>

        {/* Régime */}
        {line.regime && (() => {
          const rs = regimeStyle(line.regime)
          return (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0"
              style={{ background: rs.bg, color: rs.color, border: rs.border }}>
              {line.regime}
            </span>
          )
        })()}

        {/* Lien vers la ligne de devis */}
        <Link
          to={`/projets/${projectId}/devis/${devisId}?line=${line.id}`}
          title="Voir dans le devis"
          className="p-1.5 rounded-lg transition-colors shrink-0"
          style={{ color: 'var(--txt-3)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hov)'; e.currentTarget.style.color = 'var(--blue)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--txt-3)' }}
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* ── Attribution ─────────────────────────────────────────────────── */}
      <div className="px-4 py-3">
        {membre ? (
          <PersonRow membre={membre} onRemove={onRemove} onSaveToBDD={onSaveToBDD} />
        ) : (
          <PersonSearch onAdd={onAdd} roleHint={line.produit} regime={line.regime} />
        )}
      </div>
    </div>
  )
}

// ─── Ligne personne attribuée ─────────────────────────────────────────────────
function PersonRow({ membre: m, onRemove, onSaveToBDD }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full"
        style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd-sub)' }}>
        <Avatar m={m} size="sm" />
        <span className="text-sm font-medium" style={{ color: 'var(--txt)' }}>{fullName(m)}</span>
        {m.contact_id && (
          <Link2 className="w-2.5 h-2.5 shrink-0" title="Lié à la BDD Crew"
            style={{ color: 'var(--blue)', opacity: 0.6 }} />
        )}
        <button onClick={() => onRemove(m.id)} className="ml-0.5 transition-colors"
          style={{ color: 'var(--txt-3)' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--txt-3)'}
          title="Désattribuer">
          <X className="w-3 h-3" />
        </button>
      </div>

      {m.email && (
        <a href={`mailto:${m.email}`} className="flex items-center gap-1 text-xs transition-colors"
          style={{ color: 'var(--txt-3)' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--blue)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--txt-3)'}>
          <Mail className="w-3 h-3" />{m.email}
        </a>
      )}
      {m.telephone && (
        <a href={`tel:${m.telephone}`} className="flex items-center gap-1 text-xs"
          style={{ color: 'var(--txt-3)' }}>
          <Phone className="w-3 h-3" />{m.telephone}
        </a>
      )}
      {m.tarif_jour != null && (
        <span className="text-xs ml-auto" style={{ color: 'var(--txt-3)' }}>
          {fmtEur(m.tarif_jour)}/j
        </span>
      )}
      {!m.contact_id && (
        <button onClick={() => onSaveToBDD(m)}
          className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg ml-auto transition-all"
          style={{ background: 'var(--blue-bg)', color: 'var(--blue)', border: '1px solid rgba(0,122,255,.2)' }}>
          <Save className="w-3 h-3" /> Sauvegarder dans la BDD
        </button>
      )}
    </div>
  )
}

// ─── Recherche personne — portal avec détection haut/bas ─────────────────────
function PersonSearch({ onAdd, roleHint, regime }) {
  const { org } = useAuth()
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState([])
  const [open,    setOpen]    = useState(false)
  const [pos,     setPos]     = useState({})
  const [mode,    setMode]    = useState('bdd')
  const [libre,   setLibre]   = useState({ prenom: '', nom: '', regime: regime || 'Externe' })
  const triggerRef = useRef(null)

  useEffect(() => {
    if (!query) { setResults([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('contacts').select('*')
        .eq('org_id', org.id).eq('actif', true)
        .or(`nom.ilike.%${query}%,prenom.ilike.%${query}%,specialite.ilike.%${query}%`)
        .limit(8)
      setResults(data || [])
    }, 200)
    return () => clearTimeout(t)
  }, [query])

  // Fermer sur clic extérieur
  useEffect(() => {
    if (!open) return
    function h(e) {
      const portal = document.getElementById('crew-search-portal')
      if (portal?.contains(e.target) || triggerRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  function openDropdown() {
    if (!triggerRef.current) return
    const r          = triggerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom - 8
    const spaceAbove = r.top - 8
    const maxAllowed = 400
    const minH       = 180

    const goUp = spaceBelow < minH && spaceAbove > spaceBelow

    if (goUp) {
      // Ancre par le bas : le bas du dropdown colle sous le trigger
      // → aucun décalage quelle que soit la hauteur réelle
      setPos({
        bottom: window.innerHeight - r.top + 4,
        top:    null,
        left:   r.left,
        width:  Math.max(r.width, 320),
        maxH:   Math.max(minH, Math.min(spaceAbove, maxAllowed)),
      })
    } else {
      setPos({
        top:    r.bottom + 4,
        bottom: null,
        left:   r.left,
        width:  Math.max(r.width, 320),
        maxH:   Math.max(minH, Math.min(spaceBelow, maxAllowed)),
      })
    }
    setOpen(true)
  }

  async function pick(contact) {
    await onAdd(contact)
    setQuery(''); setResults([]); setOpen(false)
  }

  async function submitLibre(e) {
    e.preventDefault()
    if (!libre.prenom && !libre.nom) return
    await onAdd(libre)
    setLibre({ prenom: '', nom: '', regime: regime || 'Externe' })
    setOpen(false)
  }

  const dropdown = open ? createPortal(
    <div id="crew-search-portal" className="rounded-xl shadow-2xl"
      style={{
        position: 'fixed', zIndex: 9999,
        ...(pos.top    != null ? { top:    pos.top    } : {}),
        ...(pos.bottom != null ? { bottom: pos.bottom } : {}),
        left: pos.left, width: pos.width,
        maxHeight: pos.maxH, overflow: 'hidden',
        background: 'var(--bg-surf)', border: '1px solid var(--brd)',
        boxShadow: '0 16px 48px rgba(0,0,0,.55)',
        display: 'flex', flexDirection: 'column',
      }}>

      {/* Tabs */}
      <div className="flex" style={{ borderBottom: '1px solid var(--brd-sub)' }}>
        {[['bdd','Depuis la BDD Crew'],['libre','Saisie libre']].map(([k,l]) => (
          <button key={k} onClick={() => setMode(k)}
            className="flex-1 text-xs py-2.5 font-medium"
            style={mode===k
              ? { color:'var(--blue)', borderBottom:'2px solid var(--blue)' }
              : { color:'var(--txt-3)', borderBottom:'2px solid transparent' }}>
            {l}
          </button>
        ))}
        <button onClick={() => setOpen(false)} className="px-3" style={{ color:'var(--txt-3)' }}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {mode === 'bdd' ? (
        <>
          {/* Search input dans le dropdown */}
          <div className="p-2" style={{ borderBottom: '1px solid var(--brd-sub)' }}>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--txt-3)' }} />
              <input autoFocus className="input pl-8 text-sm h-9 w-full"
                value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Nom, prénom, spécialité…" />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto">
            {!query && (
              <p className="text-xs text-center py-6" style={{ color: 'var(--txt-3)' }}>
                Tapez pour rechercher dans le Crew
              </p>
            )}
            {query && results.length === 0 && (
              <p className="text-xs text-center py-6" style={{ color: 'var(--txt-3)' }}>
                Aucun résultat — essayez "Saisie libre"
              </p>
            )}
            {results.map(c => (
              <button key={c.id} onClick={() => pick(c)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
                style={{ borderTop: '1px solid var(--brd-sub)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hov)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                  style={{ background: 'linear-gradient(135deg, var(--blue), var(--purple))' }}>
                  {((c.prenom?.[0]||'')+(c.nom?.[0]||'')).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium" style={{ color: 'var(--txt)' }}>{c.prenom} {c.nom}</p>
                  <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
                    {[c.specialite, c.regime, c.tarif_jour_ref != null ? fmtEur(c.tarif_jour_ref)+'/j' : null]
                      .filter(Boolean).join(' · ')}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <form onSubmit={submitLibre} className="p-4 space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] mb-1 block" style={{ color: 'var(--txt-3)' }}>Prénom</label>
              <input className="input text-sm h-9 w-full" value={libre.prenom} autoFocus
                onChange={e => setLibre(f => ({...f, prenom: e.target.value}))} placeholder="Jean" />
            </div>
            <div>
              <label className="text-[10px] mb-1 block" style={{ color: 'var(--txt-3)' }}>Nom</label>
              <input className="input text-sm h-9 w-full" value={libre.nom}
                onChange={e => setLibre(f => ({...f, nom: e.target.value}))} placeholder="Dupont" />
            </div>
          </div>
          <div>
            <label className="text-[10px] mb-1 block" style={{ color: 'var(--txt-3)' }}>Régime</label>
            <select className="input text-sm h-9 w-full" value={libre.regime}
              onChange={e => setLibre(f => ({...f, regime: e.target.value}))}>
              <option value="Externe">Externe</option>
              <option value="Intermittent Technicien">Intermittent Technicien</option>
              <option value="Intermittent Artiste">Intermittent Artiste</option>
              <option value="Interne">Interne</option>
              <option value="Salarié">Salarié</option>
              <option value="Micro-entrepreneur">Micro-entrepreneur</option>
            </select>
          </div>
          <button type="submit" className="w-full py-2.5 rounded-lg text-sm font-medium"
            style={{ background: 'var(--blue)', color: 'white' }}>
            Attribuer ce poste
          </button>
        </form>
      )}
    </div>,
    document.body
  ) : null

  return (
    <>
      <div ref={triggerRef}
        onClick={openDropdown}
        className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all"
        style={{
          border: `1px dashed ${open ? 'var(--blue)' : 'var(--brd)'}`,
          background: open ? 'var(--blue-bg)' : 'transparent',
        }}>
        <Search className="w-3.5 h-3.5 shrink-0" style={{ color: open ? 'var(--blue)' : 'var(--txt-3)' }} />
        <span className="text-sm" style={{ color: open ? 'var(--blue)' : 'var(--txt-3)' }}>
          Attribuer une personne…
        </span>
      </div>
      {dropdown}
    </>
  )
}

// ─── Badge statut cliquable ───────────────────────────────────────────────────
function StatusBadge({ statut, membreId, onUpdate }) {
  const [open, setOpen] = useState(false)
  const [pos,  setPos]  = useState({})
  const btnRef  = useRef(null)
  const stepIdx = STEPS.findIndex(s => s.key === statut)
  const step    = STEPS[stepIdx] || STEPS[0]

  function handleClick(e) {
    e.preventDefault()
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left })
    }
    setOpen(true)
  }

  function handleContextMenu(e) {
    e.preventDefault()
    const next = STEPS[(stepIdx + 1) % STEPS.length]
    onUpdate(membreId, { movinmotion_statut: next.key })
  }

  useEffect(() => {
    if (!open) return
    function h(e) {
      const portal = document.getElementById('crew-status-portal')
      if (portal?.contains(e.target) || btnRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <>
      <button ref={btnRef} onClick={handleClick} onContextMenu={handleContextMenu}
        title="Clic : choisir l'étape · Clic droit : étape suivante"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 transition-all hover:opacity-80"
        style={{ background: step.bg, color: step.color, whiteSpace: 'nowrap' }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: step.color }} />
        {step.label}
        <ChevronDown className="w-2.5 h-2.5 opacity-50" />
      </button>

      {open && createPortal(
        <div id="crew-status-portal" className="rounded-xl shadow-2xl overflow-hidden"
          style={{
            position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, width: '180px',
            background: 'var(--bg-surf)', border: '1px solid var(--brd)',
            boxShadow: '0 12px 40px rgba(0,0,0,.5)',
          }}>
          {STEPS.map((s, i) => (
            <button key={s.key}
              onClick={() => { onUpdate(membreId, { movinmotion_statut: s.key }); setOpen(false) }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-xs"
              style={{ borderTop: i > 0 ? '1px solid var(--brd-sub)' : undefined }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hov)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
              <span style={{ color: s.key === statut ? s.color : 'var(--txt-2)', fontWeight: s.key === statut ? 700 : 400 }}>
                {s.label}
              </span>
              {s.key === statut && <Check className="w-3 h-3 ml-auto" style={{ color: s.color }} />}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// VUE ÉQUIPE — récap par personne
// ══════════════════════════════════════════════════════════════════════════════

/** Regroupe les membres par personne (contact_id ou membre.id si saisie libre) */
function groupByPerson(membres, crewLines) {
  const map = {}
  membres.forEach(m => {
    const key = m.contact_id ? `c_${m.contact_id}` : `l_${m.id}`
    if (!map[key]) {
      map[key] = {
        key, contact_id: m.contact_id,
        nom: m.nom, prenom: m.prenom, email: m.email, telephone: m.telephone,
        user_id: m.contact?.user_id || null,   // ch4C.1 : compte app lié
        postes: [],
      }
    }
    const line = crewLines.find(l => l.id === m.devis_line_id) || null
    map[key].postes.push({ membre: m, line })
  })
  // Tri : d'abord par nom
  return Object.values(map).sort((a, b) =>
    `${a.nom}${a.prenom}`.localeCompare(`${b.nom}${b.prenom}`)
  )
}

function EquipeView({ membres, crewLines, catMap = {}, canSeeFinance, canSeeCrewBudget,
                      projectId, devisId, onUpdate, onRemove }) {
  const persons = groupByPerson(membres, crewLines)

  // KPIs financiers globaux
  const totalVente  = crewLines.reduce((s, l) => s + (calcLine(l).prixVenteHT || 0), 0)
  const totalCout   = crewLines.reduce((s, l) => s + (calcLine(l).coutCharge   || 0), 0)
  const totalConvenu = membres.reduce((s, m) => {
    const line = crewLines.find(l => l.id === m.devis_line_id)
    if (m.budget_convenu != null) return s + m.budget_convenu
    if (!line) return s
    const c = calcLine(line)
    return s + (REGIMES_SALARIES.includes(line.regime) || line.regime === 'Ext. Intermittent' ? c.coutReelHT : c.coutCharge)
  }, 0)
  const hasCustomBudgetGlobal = membres.some(m => m.budget_convenu != null)

  if (membres.length === 0) return (
    <div className="rounded-xl p-12 text-center"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}>
      <Users className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--txt-3)', opacity: 0.4 }} />
      <p className="font-semibold text-sm" style={{ color: 'var(--txt-3)' }}>Aucun membre attribué</p>
      <p className="text-xs mt-1" style={{ color: 'var(--txt-3)', opacity: 0.7 }}>
        Attribuez des personnes via l'onglet Attribution
      </p>
    </div>
  )

  return (
    <div className="space-y-4">

      {/* ── KPIs financiers globaux ──────────────────────────────────────── */}
      {(canSeeFinance || canSeeCrewBudget) && (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${canSeeFinance ? (canSeeCrewBudget ? 3 : 2) : 1}, 1fr)` }}>
          {canSeeFinance && (
            <KpiCard label="Vente crew HT" color="blue" value={fmtEur(totalVente)} sub="total devis" />
          )}
          {canSeeFinance && (
            <KpiCard label="Coût estimé" color="amber" value={fmtEur(totalCout)} sub="brut + charges" />
          )}
          {canSeeCrewBudget && (
            <KpiCard
              label="Budget convenu"
              color={hasCustomBudgetGlobal ? 'blue' : 'green'}
              value={fmtEur(totalConvenu)}
              sub={hasCustomBudgetGlobal ? 'montants saisis' : 'par défaut (devis)'}
            />
          )}
        </div>
      )}

      {/* ── Cartes par personne ──────────────────────────────────────────── */}
      <div className="space-y-3">
        {persons.map(p => (
          <PersonCard
            key={p.key} person={p}
            catMap={catMap}
            canSeeFinance={canSeeFinance}
            canSeeCrewBudget={canSeeCrewBudget}
            projectId={projectId}
            devisId={devisId}
            onUpdate={onUpdate}
            onRemove={onRemove}
          />
        ))}
      </div>
    </div>
  )
}

function PersonCard({ person, catMap = {}, canSeeFinance, canSeeCrewBudget,
                      projectId, devisId, onUpdate, onRemove }) {

  // Calculs agrégés
  const totalVente  = person.postes.reduce((s, { line }) => s + (line ? calcLine(line).prixVenteHT : 0), 0)
  const totalCout   = person.postes.reduce((s, { line }) => s + (line ? calcLine(line).coutCharge  : 0), 0)
  const totalBudget = person.postes.reduce((s, { membre: m, line }) => {
    if (m.budget_convenu != null) return s + m.budget_convenu
    if (!line) return s
    const c = calcLine(line)
    return s + (REGIMES_SALARIES.includes(line.regime) || line.regime === 'Ext. Intermittent' ? c.coutReelHT : c.coutCharge)
  }, 0)
  const hasCustomBudget = person.postes.some(({ membre: m }) => m.budget_convenu != null)

  // Statut global = le "moins avancé" parmi les postes
  const stepIdxMin = Math.min(...person.postes.map(({ membre: m }) =>
    STEPS.findIndex(s => s.key === m.movinmotion_statut) || 0
  ))
  const globalStep  = STEPS[Math.max(0, stepIdxMin)]
  const borderColor = globalStep.key === 'contrat_signe' || globalStep.key === 'paie_terminee'
    ? 'rgba(0,200,117,.35)' : globalStep.key === 'integre' ? 'rgba(156,95,253,.25)' : 'var(--brd)'

  return (
    <div className="rounded-xl overflow-hidden transition-all"
      style={{ border: `1px solid ${borderColor}`, background: 'var(--bg-surf)' }}>

      {/* ── En-tête personne ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3"
        style={{ borderBottom: '1px solid var(--brd-sub)' }}>
        <Avatar m={person} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>{fullName(person)}</p>
            {person.user_id && (
              <span
                title="Compte app actif — cette personne peut se connecter"
                className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold inline-flex items-center gap-0.5"
                style={{ background: 'rgba(16,185,129,.12)', color: '#10b981' }}
              >
                <span className="w-1 h-1 rounded-full" style={{ background: '#10b981' }} />
                Compte actif
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            {person.email && (
              <a href={`mailto:${person.email}`} className="text-[11px] flex items-center gap-1 transition-colors"
                style={{ color: 'var(--txt-3)' }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--blue)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--txt-3)'}>
                <Mail className="w-3 h-3" />{person.email}
              </a>
            )}
            {person.telephone && (
              <a href={`tel:${person.telephone}`} className="text-[11px] flex items-center gap-1"
                style={{ color: 'var(--txt-3)' }}>
                <Phone className="w-3 h-3" />{person.telephone}
              </a>
            )}
          </div>
        </div>
        <span className="text-[11px] font-semibold px-2 py-1 rounded-full"
          style={{ background: 'var(--bg-elev)', color: 'var(--txt-3)', border: '1px solid var(--brd-sub)' }}>
          {person.postes.length} poste{person.postes.length > 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Totaux financiers (toujours visibles) ────────────────────────── */}
      {(canSeeFinance || canSeeCrewBudget) && (
        <div className="flex text-xs"
          style={{ borderBottom: '1px solid var(--brd-sub)', background: 'var(--bg-elev)' }}>
          {canSeeFinance && (
            <div className="flex-1 px-4 py-2.5" style={{ borderRight: '1px solid var(--brd-sub)' }}>
              <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--txt-3)' }}>Total vente HT</p>
              <p className="font-semibold" style={{ color: 'var(--txt)' }}>{fmtEur(totalVente)}</p>
            </div>
          )}
          {canSeeFinance && (
            <div className="flex-1 px-4 py-2.5" style={{ borderRight: '1px solid var(--brd-sub)' }}>
              <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--txt-3)' }}>Total coût estimé</p>
              <p className="font-semibold" style={{ color: 'var(--amber)' }}>{fmtEur(totalCout)}</p>
            </div>
          )}
          {canSeeCrewBudget && (
            <div className="flex-1 px-4 py-2.5">
              <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--txt-3)' }}>Total convenu</p>
              <p className="font-semibold" style={{ color: hasCustomBudget ? 'var(--blue)' : 'var(--txt-3)' }}>
                {fmtEur(totalBudget)}
              </p>
              {!hasCustomBudget && (
                <p className="text-[10px]" style={{ color: 'var(--txt-3)' }}>par défaut devis</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Liste des postes ─────────────────────────────────────────────── */}
      <div className="divide-y" style={{ '--tw-divide-color': 'var(--brd-sub)' }}>
        {person.postes.map(({ membre: m, line }) => {
          const rs             = line ? regimeStyle(line.regime) : null
          const calc           = line ? calcLine(line) : null
          const isIntermittent = line ? (REGIMES_SALARIES.includes(line.regime) || line.regime === 'Ext. Intermittent') : false
          const budgetRef      = calc ? (isIntermittent ? calc.coutReelHT : calc.coutCharge) : 0
          const bloc = line ? catMap[line.category_id] : null
          return (
            <PosteFinanceRow
              key={m.id}
              m={m} line={line} bloc={bloc} calc={calc} rs={rs}
              isIntermittent={isIntermittent} budgetRef={budgetRef}
              canSeeFinance={canSeeFinance} canSeeCrewBudget={canSeeCrewBudget}
              projectId={projectId} devisId={devisId}
              onUpdate={onUpdate} onRemove={onRemove}
            />
          )
        })}
      </div>
    </div>
  )
}

// ─── Ligne poste dans PersonCard : statut + info + finance + budget convenu éditable ──
function PosteFinanceRow({ m, line, bloc, calc, rs, isIntermittent, budgetRef,
                           canSeeFinance, canSeeCrewBudget,
                           projectId, devisId, onUpdate, onRemove }) {
  const [editBudget, setEditBudget] = useState(false)
  const [budgetVal,  setBudgetVal]  = useState(
    m.budget_convenu != null ? String(m.budget_convenu) : String(budgetRef || '')
  )
  useEffect(() => {
    setBudgetVal(m.budget_convenu != null ? String(m.budget_convenu) : String(budgetRef || ''))
  }, [m.id, m.budget_convenu])

  async function saveBudget() {
    await onUpdate(m.id, { budget_convenu: budgetVal !== '' ? Number(budgetVal) : null })
    setEditBudget(false)
  }

  const budgetAlert = m.budget_convenu != null && calc
    ? m.budget_convenu > calc.prixVenteHT ? '⚠ dépasse la vente HT'
    : m.budget_convenu < budgetRef        ? '⚠ sous le coût estimé'
    : null
    : null

  return (
    <div className="px-4 py-3 space-y-2">
      {/* Ligne 1 : statut + poste + régime + lien + suppr */}
      <div className="flex items-center gap-3">
        <StatusBadge statut={m.movinmotion_statut} membreId={m.id} onUpdate={onUpdate} />
        <div className="flex-1 min-w-0">
          {bloc && (
            <p className="text-[10px] font-semibold uppercase tracking-wide leading-none mb-0.5 truncate"
              style={{ color: bloc.color }}>
              {bloc.label}
            </p>
          )}
          <p className="text-sm font-medium truncate" style={{ color: 'var(--txt)' }}>
            {line?.produit || m.specialite || '—'}
          </p>
          {line?.description && (
            <p className="text-[11px] truncate" style={{ color: 'var(--txt-3)' }}>{line.description}</p>
          )}
        </div>
        {rs && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 hidden sm:inline"
            style={{ background: rs.bg, color: rs.color, border: rs.border }}>
            {line.regime}
          </span>
        )}
        {line && (
          <Link to={`/projets/${projectId}/devis/${devisId}?line=${line.id}`}
            title="Voir dans le devis"
            className="p-1.5 rounded-lg transition-colors shrink-0"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hov)'; e.currentTarget.style.color = 'var(--blue)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--txt-3)' }}>
            <ExternalLink className="w-3 h-3" />
          </Link>
        )}
        <button onClick={() => onRemove(m.id)} className="p-1.5 rounded transition-colors shrink-0"
          style={{ color: 'var(--txt-3)' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--txt-3)'}
          title="Désattribuer ce poste">
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Ligne 2 : données financières */}
      {calc && (canSeeFinance || canSeeCrewBudget) && (
        <div className="flex items-start gap-4 pl-1 flex-wrap">

          {/* Vente HT + détail prestation */}
          {canSeeFinance && (
            <div className="text-xs">
              <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>Vente HT</p>
              <p className="font-semibold" style={{ color: 'var(--txt)' }}>{fmtEur(calc.prixVenteHT)}</p>
              {line?.quantite != null && line?.tarif_ht != null && (
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--txt-3)', opacity: 0.7 }}>
                  {line.quantite} {line.unite || 'j'} × {fmtEur(line.tarif_ht)}
                </p>
              )}
            </div>
          )}

          {/* Coût estimé / Salaire brut */}
          {canSeeFinance && (
            <div className="text-xs">
              {isIntermittent ? (
                <>
                  <p className="text-[10px] uppercase tracking-wide flex items-center gap-1" style={{ color: 'var(--txt-3)' }}>
                    Brut
                    <span className="normal-case text-[9px] px-1 py-0.5 rounded font-semibold"
                      style={{ background: 'rgba(156,95,253,.12)', color: 'var(--purple)' }}>MovinMotion</span>
                  </p>
                  <p className="font-semibold" style={{ color: 'var(--purple)' }}>{fmtEur(calc.coutReelHT)}</p>
                  <p className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
                    + {fmtEur(calc.chargesPat)} → <span style={{ color: 'var(--amber)' }}>{fmtEur(calc.coutCharge)}</span>
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>Coût estimé</p>
                  <p className="font-semibold" style={{ color: 'var(--amber)' }}>{fmtEur(calc.coutCharge)}</p>
                </>
              )}
            </div>
          )}

          {/* Budget convenu — éditable */}
          {canSeeCrewBudget && (
            <div className="text-xs">
              <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--txt-3)' }}>
                {isIntermittent ? 'Brut convenu' : 'Budget convenu'}
              </p>
              {editBudget ? (
                <div className="flex items-center gap-1">
                  <input type="number" autoFocus className="input text-xs h-6 w-24"
                    value={budgetVal} onChange={e => setBudgetVal(e.target.value)}
                    onBlur={saveBudget}
                    onKeyDown={e => { if (e.key === 'Enter') saveBudget(); if (e.key === 'Escape') setEditBudget(false) }}
                    placeholder="0" />
                  <span style={{ color: 'var(--txt-3)' }}>€</span>
                </div>
              ) : (
                <button onClick={() => setEditBudget(true)} className="group flex items-center gap-1 text-left">
                  <span className="font-semibold"
                    style={{ color: m.budget_convenu != null ? 'var(--blue)' : 'var(--txt-3)' }}>
                    {fmtEur(m.budget_convenu ?? budgetRef)}
                  </span>
                  {m.budget_convenu == null && (
                    <span className="text-[9px] px-1 py-0.5 rounded"
                      style={{ background: 'var(--bg-elev)', color: 'var(--txt-3)', border: '1px solid var(--brd-sub)' }}>
                      devis
                    </span>
                  )}
                  <Edit2 className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity"
                    style={{ color: 'var(--txt-3)' }} />
                </button>
              )}
              {budgetAlert && (
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--red)' }}>{budgetAlert}</p>
              )}
            </div>
          )}

          {/* Checkbox MovinMotion — intermittents uniquement */}
          {isIntermittent && (
            <div className="flex items-center gap-1 ml-auto self-center">
            <label className="flex items-center gap-2 cursor-pointer select-none text-xs">
              <div className="relative flex items-center">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={!!m.movinmotion_contrat_ok}
                  onChange={e => onUpdate(m.id, { movinmotion_contrat_ok: e.target.checked })}
                />
                <div className="w-4 h-4 rounded flex items-center justify-center transition-all"
                  style={{
                    background: m.movinmotion_contrat_ok ? 'var(--purple)' : 'transparent',
                    border: `1.5px solid ${m.movinmotion_contrat_ok ? 'var(--purple)' : 'rgba(156,95,253,.4)'}`,
                  }}>
                  {m.movinmotion_contrat_ok && (
                    <Check className="w-2.5 h-2.5" style={{ color: 'white' }} />
                  )}
                </div>
              </div>
              <span className="text-[10px] font-medium"
                style={{ color: m.movinmotion_contrat_ok ? 'var(--purple)' : 'rgba(156,95,253,.6)' }}>
                MovinMotion
              </span>
            </label>
            <a
              href="https://app.movinmotion.com/company/7000000000000167/projects#/list"
              target="_blank" rel="noreferrer"
              title="Ouvrir MovinMotion"
              className="p-1 rounded transition-all"
              style={{ color: 'rgba(156,95,253,.5)' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--purple)'; e.currentTarget.style.background = 'rgba(156,95,253,.1)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(156,95,253,.5)'; e.currentTarget.style.background = 'transparent' }}>
              <ExternalLink className="w-3 h-3" />
            </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function Avatar({ m, size = 'md' }) {
  const sz = size === 'sm' ? 'w-6 h-6 text-[9px]' : 'w-8 h-8 text-xs'
  return (
    <div className={`${sz} rounded-full flex items-center justify-center font-bold text-white shrink-0`}
      style={{ background: 'linear-gradient(135deg, var(--blue), var(--purple))' }}>
      {initials(m)}
    </div>
  )
}

function KpiCard({ label, value, sub, color = 'blue' }) {
  const fg = { blue:'var(--blue)', green:'var(--green)', purple:'var(--purple)', amber:'var(--amber)' }[color] || 'var(--blue)'
  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}>
      <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--txt-3)' }}>{label}</p>
      <p className="text-base font-bold leading-tight" style={{ color: fg }}>{value}</p>
      {sub && <p className="text-[10px] mt-0.5" style={{ color: 'var(--txt-3)' }}>{sub}</p>}
    </div>
  )
}
