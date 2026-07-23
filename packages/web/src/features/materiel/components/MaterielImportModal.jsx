// ════════════════════════════════════════════════════════════════════════════
// MaterielImportModal — import CSV / Excel dans la liste ouverte
// ════════════════════════════════════════════════════════════════════════════
//
// MAT-OUTILS ④. Flux en 2 étapes dans la même modale :
//   1. choix du fichier (.csv/.xlsx/.xls) → parsé via SheetJS (matosExcel)
//   2. mapping des colonnes (Désignation requise ; Label / Quantité /
//      Remarques optionnels, devinés par nom d'en-tête) + bloc cible
//      (bloc existant ou nouveau bloc créé en fin de version).
// L'insertion elle-même est faite par MaterielTab via onImport(payload).
// ════════════════════════════════════════════════════════════════════════════

import { useRef, useState } from 'react'
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { notify } from '../../../lib/notify'
import { parseImportFile, guessColumn } from '../matosExcel'

const NONE = ''
const NEW_BLOCK = '__new__'

export default function MaterielImportModal({ blocks = [], onImport, onClose }) {
  const fileRef = useRef(null)
  const [fileName, setFileName] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [headers, setHeaders] = useState([])
  const [rows, setRows] = useState([])
  const [mapping, setMapping] = useState({ designation: '', label: '', quantite: '', remarques: '' })
  const [targetBlockId, setTargetBlockId] = useState(blocks[0]?.id || NEW_BLOCK)
  const [newBlockTitre, setNewBlockTitre] = useState('')
  const [importing, setImporting] = useState(false)

  async function handleFile(file) {
    if (!file) return
    setParsing(true)
    try {
      const parsed = await parseImportFile(file)
      if (!parsed.headers.length || !parsed.rows.length) {
        notify.error('Fichier vide ou illisible (aucune ligne trouvée).')
        return
      }
      setFileName(file.name)
      setHeaders(parsed.headers)
      setRows(parsed.rows)
      setMapping({
        designation: guessColumn(parsed.headers, ['designation', 'nom', 'materiel', 'article', 'item']),
        label: guessColumn(parsed.headers, ['label', 'categorie', 'type']),
        quantite: guessColumn(parsed.headers, ['qte', 'quantite', 'qty', 'nb']),
        remarques: guessColumn(parsed.headers, ['remarque', 'note', 'comment']),
      })
    } catch (err) {
      notify.error('Lecture du fichier impossible : ' + (err?.message || err))
    } finally {
      setParsing(false)
    }
  }

  // Aperçu du nombre d'items réellement importables (désignation non vide).
  const desIdx = mapping.designation === '' ? -1 : Number(mapping.designation)
  const validRows =
    desIdx >= 0 ? rows.filter((r) => String(r[desIdx] ?? '').trim()) : []

  async function submit(e) {
    e.preventDefault()
    if (desIdx < 0 || !validRows.length || importing) return
    const cell = (r, key) => {
      const idx = mapping[key] === '' ? -1 : Number(mapping[key])
      return idx >= 0 ? String(r[idx] ?? '').trim() : ''
    }
    const items = validRows.map((r) => ({
      designation: cell(r, 'designation'),
      label: cell(r, 'label') || null,
      quantite: cell(r, 'quantite') ? Number(cell(r, 'quantite').replace(',', '.')) : 1,
      remarques: cell(r, 'remarques') || null,
    }))
    setImporting(true)
    try {
      await onImport({
        blockId: targetBlockId === NEW_BLOCK ? null : targetBlockId,
        newBlockTitre: targetBlockId === NEW_BLOCK ? newBlockTitre : null,
        items,
      })
      onClose()
    } catch (err) {
      notify.error('Import impossible : ' + (err?.message || err))
    } finally {
      setImporting(false)
    }
  }

  const selectStyle = {
    background: 'var(--bg)',
    border: '1px solid var(--brd)',
    color: 'var(--txt)',
  }

  const MAP_FIELDS = [
    ['designation', 'Désignation *'],
    ['label', 'Label'],
    ['quantite', 'Quantité'],
    ['remarques', 'Remarques'],
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose} />
      <form
        onSubmit={submit}
        className="relative w-full max-w-md rounded-xl p-5"
        style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}
      >
        <h2 className="text-base font-bold mb-1" style={{ color: 'var(--txt)' }}>
          Importer des items
        </h2>
        <p className="text-[11px] mb-4" style={{ color: 'var(--txt-3)' }}>
          Fichier CSV ou Excel — la 1re ligne doit contenir les en-têtes de colonnes.
        </p>

        {/* Étape 1 : fichier */}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={parsing}
          className="w-full flex items-center justify-center gap-2 text-xs font-semibold px-3 py-2.5 rounded-lg mb-4"
          style={{
            background: 'var(--bg)',
            border: '1px dashed var(--brd)',
            color: fileName ? 'var(--txt)' : 'var(--txt-2)',
          }}
        >
          {parsing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : fileName ? (
            <FileSpreadsheet className="w-4 h-4" style={{ color: 'var(--green, #22c55e)' }} />
          ) : (
            <Upload className="w-4 h-4" />
          )}
          {fileName || 'Choisir un fichier (.csv, .xlsx)…'}
        </button>

        {/* Étape 2 : mapping + cible */}
        {headers.length > 0 && (
          <>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {MAP_FIELDS.map(([key, label]) => (
                <label key={key} className="block">
                  <span className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--txt-3)' }}>
                    {label}
                  </span>
                  <select
                    value={mapping[key]}
                    onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value }))}
                    className="w-full text-xs px-2 py-1.5 rounded-md outline-none"
                    style={selectStyle}
                  >
                    <option value={NONE}>— Ignorer —</option>
                    {headers.map((h, i) => (
                      <option key={i} value={String(i)}>
                        {h || `Colonne ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            <label className="block mb-2">
              <span className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--txt-3)' }}>
                Importer dans
              </span>
              <select
                value={targetBlockId}
                onChange={(e) => setTargetBlockId(e.target.value)}
                className="w-full text-xs px-2 py-1.5 rounded-md outline-none"
                style={selectStyle}
              >
                {blocks.map((b) => (
                  <option key={b.id} value={b.id}>
                    Bloc « {b.titre} »
                  </option>
                ))}
                <option value={NEW_BLOCK}>+ Nouveau bloc…</option>
              </select>
            </label>
            {targetBlockId === NEW_BLOCK && (
              <input
                type="text"
                value={newBlockTitre}
                onChange={(e) => setNewBlockTitre(e.target.value)}
                placeholder="Nom du nouveau bloc (ex. Import)"
                className="w-full text-xs px-2 py-1.5 rounded-md outline-none mb-2"
                style={selectStyle}
              />
            )}

            <p className="text-[11px] mt-2 mb-4" style={{ color: desIdx < 0 ? 'var(--orange, #f97316)' : 'var(--txt-3)' }}>
              {desIdx < 0
                ? 'Choisir la colonne Désignation pour continuer.'
                : `${validRows.length} item${validRows.length > 1 ? 's' : ''} prêt${validRows.length > 1 ? 's' : ''} à importer (sur ${rows.length} ligne${rows.length > 1 ? 's' : ''}).`}
            </p>
          </>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold px-3 py-2 rounded-lg"
            style={{ color: 'var(--txt-2)' }}
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={desIdx < 0 || !validRows.length || importing}
            className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-lg disabled:opacity-40"
            style={{ background: 'var(--blue)', color: '#fff' }}
          >
            {importing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Importer
          </button>
        </div>
      </form>
    </div>
  )
}
