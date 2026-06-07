// ════════════════════════════════════════════════════════════════════════════
// useLiveMode — Mode régie live pour le déroulé festival
// ════════════════════════════════════════════════════════════════════════════
//
// Quand le déroulé est en cours (jour J pendant le festival), la régie peut
// activer le "mode live" qui :
//   - Détecte automatiquement le créneau en cours d'après l'heure (tick 30s)
//   - Auto-transitions des statuts :
//       'planifie' → 'en_cours' à l'heure_debut
//       'en_cours' → 'fait' à l'heure_fin
//   - La régie peut override manuellement via "Suivant" :
//       - marque le courant 'fait' avant son heure_fin
//       - marque le suivant 'en_cours' immédiatement
//
// Le mode live est désactivé par défaut. Il s'active via toggle dans la
// toolbar et est persisté en localStorage par projet pour reprise après
// reload (vital si la régie ferme par accident le navigateur).
//
// API :
//   useLiveMode({
//     projectId,           // pour la persistance localStorage
//     creneaux,            // tous les créneaux du déroulé courant
//     deroule,             // {date_jour} pour vérifier "today"
//     onUpdateStatut,      // (creneauId, statut) => Promise<void>
//   })
//   → {
//     enabled,             // bool : mode live actif ?
//     setEnabled,          // toggle
//     currentCreneaux[],   // créneaux en_cours OU détectés comme tels
//     nextCreneau,         // prochain à venir (premier après now non-fait)
//     nowMin,              // heure courante en minutes (réactualisé)
//     skipToNext,          // ()=>void : marque courant fait + suivant en_cours
//     markCurrentDone,     // ()=>void : marque courant fait sans avancer
//   }
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const TICK_MS = 30_000 // 30s : compromis entre réactivité et batterie

function storageKey(projectId) {
  return `deroule-live-${projectId}`
}

function getNowMin() {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

function isTodayDeroule(deroule) {
  if (!deroule?.date_jour) return false
  const today = new Date().toISOString().slice(0, 10)
  return deroule.date_jour === today
}

export function useLiveMode({
  projectId,
  creneaux = [],
  deroule,
  onUpdateStatut,
}) {
  // ─── Toggle persistant en localStorage ────────────────────────────────
  const [enabled, _setEnabled] = useState(() => {
    if (typeof localStorage === 'undefined' || !projectId) return false
    return localStorage.getItem(storageKey(projectId)) === '1'
  })
  const setEnabled = useCallback(
    (v) => {
      const next = typeof v === 'function' ? v(enabled) : v
      _setEnabled(next)
      if (typeof localStorage !== 'undefined' && projectId) {
        if (next) localStorage.setItem(storageKey(projectId), '1')
        else localStorage.removeItem(storageKey(projectId))
      }
    },
    [enabled, projectId],
  )

  // ─── Tick toutes les 30s pour rafraîchir nowMin ───────────────────────
  const [nowMin, setNowMin] = useState(() => getNowMin())
  useEffect(() => {
    if (!enabled) return undefined
    setNowMin(getNowMin())
    const t = setInterval(() => setNowMin(getNowMin()), TICK_MS)
    return () => clearInterval(t)
  }, [enabled])

  // ─── Sélection des créneaux du jour ───────────────────────────────────
  const isToday = isTodayDeroule(deroule)

  // ─── Détection des créneaux en cours d'après l'heure ──────────────────
  // Un créneau est "actuellement en cours d'horaire" si :
  //   heure_debut <= nowMin < heure_fin
  // ET son statut n'est pas 'annule' (pas d'auto-trigger sur annulés).
  // On retourne TOUS les créneaux qui matchent (en festival on a souvent
  // plusieurs scènes en parallèle).
  const currentCreneaux = useMemo(() => {
    if (!isToday) return []
    return (creneaux || []).filter((c) => {
      if (c.statut === 'annule') return false
      const d = c.heure_debut_min ?? 0
      const f = c.heure_fin_min ?? 0
      return d <= nowMin && nowMin < f
    })
  }, [creneaux, nowMin, isToday])

  // ─── Prochain créneau à venir (le plus tôt après nowMin) ──────────────
  const nextCreneau = useMemo(() => {
    if (!isToday) return null
    const upcoming = (creneaux || [])
      .filter((c) => {
        if (c.statut === 'fait' || c.statut === 'annule') return false
        return (c.heure_debut_min ?? 0) > nowMin
      })
      .sort((a, b) => (a.heure_debut_min ?? 0) - (b.heure_debut_min ?? 0))
    return upcoming[0] || null
  }, [creneaux, nowMin, isToday])

  // ─── Auto-transition des statuts ──────────────────────────────────────
  // On utilise un ref pour ne pas re-déclencher après une transition (la
  // BDD met à jour le statut, le createur change, mais le hook réagit) →
  // on suit les ids dont on a déjà déclenché la transition au cours de
  // cette session pour éviter les doublons.
  const triggeredRef = useRef({ enCours: new Set(), fait: new Set() })

  useEffect(() => {
    if (!enabled || !isToday || !onUpdateStatut) return
    // 1. Marquer 'en_cours' tous les créneaux dont l'heure_debut est passée
    //    et qui sont encore 'planifie'.
    for (const c of currentCreneaux) {
      if (c.statut === 'planifie' && !triggeredRef.current.enCours.has(c.id)) {
        triggeredRef.current.enCours.add(c.id)
        Promise.resolve(onUpdateStatut(c.id, 'en_cours')).catch((e) => {
          console.warn('[useLiveMode] auto en_cours failed', e)
          triggeredRef.current.enCours.delete(c.id)
        })
      }
    }
    // 2. Marquer 'fait' tous les créneaux dont l'heure_fin est passée et
    //    qui étaient 'en_cours'. (On n'écrase pas un 'fait' déjà posé.)
    const justEnded = (creneaux || []).filter((c) => {
      if (c.statut !== 'en_cours') return false
      const f = c.heure_fin_min ?? 0
      return nowMin >= f
    })
    for (const c of justEnded) {
      if (triggeredRef.current.fait.has(c.id)) continue
      triggeredRef.current.fait.add(c.id)
      Promise.resolve(onUpdateStatut(c.id, 'fait')).catch((e) => {
        console.warn('[useLiveMode] auto fait failed', e)
        triggeredRef.current.fait.delete(c.id)
      })
    }
  }, [enabled, isToday, currentCreneaux, creneaux, nowMin, onUpdateStatut])

  // Reset les triggers quand on désactive le mode live (sinon, si on
  // réactive plus tard, on penserait avoir déjà transitionné des créneaux
  // qui ont entre-temps été remis en 'planifie' manuellement).
  useEffect(() => {
    if (!enabled) {
      triggeredRef.current = { enCours: new Set(), fait: new Set() }
    }
  }, [enabled])

  // ─── Override manuel : "Suivant" / "Marquer fait" ─────────────────────
  const skipToNext = useCallback(async () => {
    if (!onUpdateStatut) return
    // Marque tous les en_cours comme fait
    for (const c of currentCreneaux) {
      if (c.statut === 'en_cours' || c.statut === 'planifie') {
        triggeredRef.current.fait.add(c.id)
        try {
          await onUpdateStatut(c.id, 'fait')
        } catch (e) {
          console.warn('[useLiveMode] skipToNext fait failed', e)
        }
      }
    }
    // Marque le suivant comme en_cours
    if (nextCreneau) {
      triggeredRef.current.enCours.add(nextCreneau.id)
      try {
        await onUpdateStatut(nextCreneau.id, 'en_cours')
      } catch (e) {
        console.warn('[useLiveMode] skipToNext en_cours failed', e)
      }
    }
  }, [currentCreneaux, nextCreneau, onUpdateStatut])

  const markCurrentDone = useCallback(async () => {
    if (!onUpdateStatut) return
    for (const c of currentCreneaux) {
      if (c.statut === 'en_cours' || c.statut === 'planifie') {
        triggeredRef.current.fait.add(c.id)
        try {
          await onUpdateStatut(c.id, 'fait')
        } catch (e) {
          console.warn('[useLiveMode] markCurrentDone failed', e)
        }
      }
    }
  }, [currentCreneaux, onUpdateStatut])

  return {
    enabled,
    setEnabled,
    nowMin,
    currentCreneaux,
    nextCreneau,
    skipToNext,
    markCurrentDone,
    isToday,
  }
}
