// ════════════════════════════════════════════════════════════════════════════
// DevisEditorScreen — éditeur natif d'une version de devis (mode CLASSIQUE)
// ════════════════════════════════════════════════════════════════════════════
//
// Transposition RN de la vue mobile web (DevisMobileView) :
//   - blocs en cartes repliables (accent, total) ;
//   - lignes en cartes compactes ; tap → bottom sheet d'édition complète
//     (produit avec suggestions BDD, régime, nb/qté/unité, tarifs, remise) ;
//   - autosave 1,5 s des lignes modifiées (useDevisMobile) ;
//   - devis envoyé/accepté → LECTURE SEULE (le déverrouillage/renvoi reste au
//     desk, qui gère snapshot PDF et workflow client) ;
//   - barre de synthèse sticky (Total HT / TTC / Marge), calculs @captiv/shared.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useRef, useMemo } from 'react'
import {
  View,
  Text,
  TextInput,
  Animated,
  Alert,
  ScrollView,
  StyleSheet,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRoute } from '@react-navigation/native'

import { ScreenHeader, Badge, PressableScale, HEADER_BASE_HEIGHT } from '../components/shared'
import { BottomSheet, Toggle } from '../components/atoms'
import { useDevisMobile } from '../hooks/useDevisMobile'
import { calcLine, fmtEur, fmtPct, REGIMES_SALARIES, UNITES } from '@captiv/shared/lib/cotisations'
import { getBlocInfo as getBlocInfoByName } from '@captiv/shared/lib/blocs'
import { REGIME_META, regimeFromProduit } from '@captiv/shared/lib/devisConstants'
import { colors, spacing, radius, fontWeight } from '../theme'

const STATUS_META = {
  brouillon: { label: 'Brouillon', tone: 'neutral' },
  envoye: { label: 'Envoyé', tone: 'info' },
  accepte: { label: 'Accepté', tone: 'success' },
  refuse: { label: 'Refusé', tone: 'danger' },
}

export default function DevisEditorScreen() {
  const insets = useSafeAreaInsets()
  const route = useRoute()
  const devisId = route.params?.devisId
  const scrollY = useRef(new Animated.Value(0)).current

  const {
    devis, categories, taux, bdd, synth, loading, saving,
    updateDevisField, insertLine, updateLine, updateLineBatch, deleteLine, duplicateLine,
  } = useDevisMobile(devisId)

  const [collapsed, setCollapsed] = useState({})
  const [sheet, setSheet] = useState(null) // { catId, lineId, tempId } | null
  const [synthOpen, setSynthOpen] = useState(false)

  const locked = devis?.status === 'envoye' || devis?.status === 'accepte'
  const st = STATUS_META[devis?.status] || STATUS_META.brouillon

  // Ligne courante de la sheet, résolue LIVE par clés (autosave remplace les
  // objets ; on garde _tempId au remplacement, même astuce que le web).
  const current = useMemo(() => {
    if (!sheet) return null
    const cat = categories.find((c) => c.id === sheet.catId)
    if (!cat) return null
    const line = cat.lines.find((l) =>
      sheet.lineId ? l.id === sheet.lineId : l._tempId === sheet.tempId,
    )
    return line ? { line, cat } : null
  }, [sheet, categories])

  const sorted = useMemo(() => {
    const withInfo = categories.map((cat) => ({ cat, info: getBlocInfoByName(cat.name) }))
    withInfo.sort(
      (a, b) => a.info.canonicalIdx - b.info.canonicalIdx || a.cat.sort_order - b.cat.sort_order,
    )
    return withInfo
  }, [categories])

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <Animated.ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + HEADER_BASE_HEIGHT,
          paddingBottom: insets.bottom + 140,
        }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
      >
        <View style={styles.body}>
          {/* Statut + verrou */}
          <View style={styles.statusRow}>
            <Badge tone={st.tone} variant="soft" size="md">
              {st.label}
            </Badge>
            {saving && <Text style={styles.savingText}>Sauvegarde…</Text>}
          </View>
          {locked && (
            <View style={styles.lockBanner}>
              <Ionicons name="lock-closed-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.lockText}>
                Devis {devis?.status === 'accepte' ? 'accepté' : 'envoyé'} : lecture seule.
                Déverrouillage et renvoi depuis le desk.
              </Text>
            </View>
          )}

          {loading && <Text style={styles.empty}>Chargement…</Text>}

          {/* Blocs */}
          {sorted.map(({ cat, info }) => {
            const accent = info.color || colors.brand.blue
            const isCollapsed = Boolean(collapsed[cat.id])
            const total = cat.lines
              .filter((l) => l.use_line)
              .reduce((sum, l) => sum + calcLine(l, taux).prixVenteHT, 0)
            return (
              <View key={cat.id} style={[styles.bloc, { borderLeftColor: accent }]}>
                <PressableScale
                  haptic="light"
                  onPress={() => setCollapsed((p) => ({ ...p, [cat.id]: !p[cat.id] }))}
                >
                  <View style={styles.blocHeader}>
                    <Ionicons
                      name={isCollapsed ? 'chevron-forward' : 'chevron-down'}
                      size={14}
                      color={colors.textMuted}
                    />
                    <Text style={[styles.blocTitle, { color: accent }]} numberOfLines={1}>
                      {info.isCanonical ? info.label : cat.name}
                    </Text>
                    <Text style={styles.blocCount}>{cat.lines.length}</Text>
                    <Text style={[styles.blocTotal, { color: accent }]}>{fmtEur(total)}</Text>
                  </View>
                </PressableScale>

                {!isCollapsed && (
                  <View style={styles.blocBody}>
                    {cat.lines.map((line) => {
                      const c = calcLine(line, taux)
                      return (
                        <PressableScale
                          key={line.id || line._tempId}
                          haptic="selection"
                          onPress={() =>
                            setSheet({
                              catId: cat.id,
                              lineId: line.id || null,
                              tempId: line._tempId || null,
                            })
                          }
                        >
                          <View style={[styles.lineRow, !line.use_line && { opacity: 0.4 }]}>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={styles.lineTitle} numberOfLines={1}>
                                {line.produit || 'Sans nom'}
                              </Text>
                              <Text style={styles.lineSub} numberOfLines={1}>
                                {`${line.nb ?? 1} × ${line.quantite || 0} ${line.unite || 'F'} · ${fmtEur(line.tarif_ht || 0)}`}
                                {line.remise_pct > 0 && ` · -${line.remise_pct}%`}
                              </Text>
                            </View>
                            <Text style={styles.linePrice}>{fmtEur(c.prixVenteHT)}</Text>
                          </View>
                        </PressableScale>
                      )
                    })}
                    {!locked && (
                      <PressableScale
                        haptic="light"
                        onPress={() => {
                          const tempId = insertLine(cat.id, {
                            regime: info.defaultRegime || undefined,
                          })
                          setSheet({ catId: cat.id, lineId: null, tempId })
                        }}
                      >
                        <View style={styles.addRow}>
                          <Ionicons name="add" size={16} color={colors.textMuted} />
                          <Text style={styles.addText}>Ajouter une ligne</Text>
                        </View>
                      </PressableScale>
                    )}
                  </View>
                )}
              </View>
            )
          })}
        </View>
      </Animated.ScrollView>

      {/* Barre de synthèse sticky — tap = tiroir détail/ajustements */}
      <PressableScale
        haptic="light"
        onPress={() => setSynthOpen(true)}
        style={[styles.synthBar, { paddingBottom: Math.max(insets.bottom, 12) }]}
      >
        <SynthMetric label="Total HT" value={fmtEur(synth.totalHTFinal)} prominent />
        <SynthMetric label="TTC" value={fmtEur(synth.totalTTC)} />
        <SynthMetric
          label="Marge"
          value={fmtPct(synth.pctMargeFinale)}
          color={synth.margeFinale >= 0 ? colors.status.success : colors.status.danger}
        />
        <Ionicons
          name="chevron-up"
          size={16}
          color={colors.textMuted}
          style={{ alignSelf: 'center' }}
        />
      </PressableScale>

      <ScreenHeader
        title={`Devis V${devis?.version_number ?? ''}`}
        subtitle={devis?.title || undefined}
        leftMode="back"
        scrollY={scrollY}
        overlay
      />

      {/* Tiroir Synthèse : détail des totaux + ajustements globaux */}
      <BottomSheet visible={synthOpen} onClose={() => setSynthOpen(false)} heightPercent={82}>
        <SynthSheet
          devis={devis}
          synth={synth}
          readOnly={locked}
          updateDevisField={updateDevisField}
        />
      </BottomSheet>

      {/* Bottom sheet d'édition */}
      <BottomSheet visible={Boolean(current)} onClose={() => setSheet(null)} heightPercent={86}>
        {current && (
          <LineSheet
            line={current.line}
            catId={current.cat.id}
            taux={taux}
            bdd={bdd}
            readOnly={locked}
            updateLine={updateLine}
            updateLineBatch={updateLineBatch}
            onDuplicate={() => {
              duplicateLine(current.cat.id, current.line.id || null, current.line._tempId || null)
              setSheet(null)
            }}
            onDelete={() => {
              Alert.alert('Supprimer la ligne', `« ${current.line.produit || 'Sans nom'} » ?`, [
                { text: 'Annuler', style: 'cancel' },
                {
                  text: 'Supprimer',
                  style: 'destructive',
                  onPress: () => {
                    deleteLine(
                      current.cat.id,
                      current.line.id || null,
                      current.line._tempId || null,
                    )
                    setSheet(null)
                  },
                },
              ])
            }}
            onClose={() => setSheet(null)}
          />
        )}
      </BottomSheet>
    </View>
  )
}

function SynthMetric({ label, value, prominent, color }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text
        style={[
          styles.metricValue,
          prominent && { fontSize: 17 },
          color ? { color } : null,
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  )
}

// ─── Tiroir Synthèse : ajustements globaux + détail des totaux ────────────────

function AdjInput({ label, value, onChange, suffix = '%', computed, readOnly }) {
  return (
    <View style={styles.adjRow}>
      <Text style={styles.adjLabel}>{label}</Text>
      <View style={styles.adjInputWrap}>
        <TextInput
          keyboardType="decimal-pad"
          value={value == null || value === 0 ? '' : String(value)}
          placeholder="0"
          placeholderTextColor={colors.textDim}
          editable={!readOnly}
          onChangeText={(v) => onChange(parseFloat(v.replace(',', '.')) || 0)}
          style={styles.adjInput}
        />
        <Text style={styles.adjSuffix}>{suffix}</Text>
      </View>
      {computed != null && <Text style={styles.adjComputed}>{computed}</Text>}
    </View>
  )
}

function DetailRow({ label, value, strong, color }) {
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, strong && styles.detailStrong]}>{label}</Text>
      <Text
        style={[styles.detailValue, strong && styles.detailStrong, color ? { color } : null]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  )
}

function SynthSheet({ devis, synth, readOnly, updateDevisField }) {
  return (
    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <Text style={styles.synthTitle}>Synthèse</Text>

      {/* Ajustements globaux */}
      <Text style={styles.fieldLabel}>Ajustements globaux</Text>
      <AdjInput
        label="Mg + Fg"
        value={Number(devis?.marge_globale_pct) || 0}
        onChange={(v) => updateDevisField('marge_globale_pct', v)}
        computed={fmtEur(synth.montantMargeGlobale)}
        readOnly={readOnly}
      />
      <AdjInput
        label="Assurance"
        value={Number(devis?.assurance_pct) || 0}
        onChange={(v) => updateDevisField('assurance_pct', v)}
        computed={fmtEur(synth.montantAssurance)}
        readOnly={readOnly}
      />
      <AdjInput
        label="Remise globale"
        value={Number(devis?.remise_globale_pct) || 0}
        onChange={(v) => updateDevisField('remise_globale_pct', v)}
        computed={synth.montantRemiseGlobale ? `-${fmtEur(synth.montantRemiseGlobale)}` : null}
        readOnly={readOnly}
      />
      <AdjInput
        label="Remise fixe"
        value={Number(devis?.remise_globale_montant) || 0}
        onChange={(v) => updateDevisField('remise_globale_montant', v)}
        suffix="€"
        readOnly={readOnly}
      />
      <AdjInput
        label="TVA"
        value={devis?.tva_rate != null ? Number(devis.tva_rate) : 20}
        onChange={(v) => updateDevisField('tva_rate', v)}
        readOnly={readOnly}
      />
      <AdjInput
        label="Acompte"
        value={devis?.acompte_pct != null ? Number(devis.acompte_pct) : 30}
        onChange={(v) => updateDevisField('acompte_pct', v)}
        computed={fmtEur(synth.acompte)}
        readOnly={readOnly}
      />
      {readOnly && (
        <Text style={styles.sheetLockText}>Devis verrouillé : ajustements en lecture seule.</Text>
      )}

      {/* Détail des totaux */}
      <Text style={styles.fieldLabel}>Détail</Text>
      <View style={styles.detailBox}>
        <DetailRow label="Sous-total" value={fmtEur(synth.sousTotal)} />
        {synth.totalCharges > 0 && (
          <DetailRow label="+ Charges soc. pat." value={fmtEur(synth.totalCharges)} />
        )}
        {synth.montantMargeGlobale > 0 && (
          <DetailRow
            label={`+ Mg+Fg ${Number(devis?.marge_globale_pct) || 0}%`}
            value={fmtEur(synth.montantMargeGlobale)}
            color={colors.brand.blueLight}
          />
        )}
        {synth.montantAssurance > 0 && (
          <DetailRow
            label={`+ Assurance ${Number(devis?.assurance_pct) || 0}%`}
            value={fmtEur(synth.montantAssurance)}
            color={colors.brand.purple || '#A855F7'}
          />
        )}
        {synth.montantRemiseGlobale > 0 && (
          <DetailRow
            label="- Remise"
            value={`-${fmtEur(synth.montantRemiseGlobale)}`}
            color={colors.status.warning}
          />
        )}
        <DetailRow label="Total HT" value={fmtEur(synth.totalHTFinal)} strong />
        <DetailRow label={`TVA ${devis?.tva_rate ?? 20}%`} value={fmtEur(synth.tva)} />
        <DetailRow label="TOTAL TTC" value={fmtEur(synth.totalTTC)} strong />
      </View>

      {/* Marge + échéancier */}
      <Text style={styles.fieldLabel}>Marge & échéancier</Text>
      <View style={styles.detailBox}>
        <DetailRow
          label="Marge finale"
          value={`${fmtEur(synth.margeFinale)} (${fmtPct(synth.pctMargeFinale)})`}
          color={synth.margeFinale >= 0 ? colors.status.success : colors.status.danger}
        />
        <DetailRow label="Coût réel HT" value={fmtEur(synth.totalCoutReel)} />
        <DetailRow
          label={`Acompte ${devis?.acompte_pct ?? 30}%`}
          value={fmtEur(synth.acompte)}
        />
        <DetailRow label="Solde" value={fmtEur((synth.totalTTC || 0) - (synth.acompte || 0))} />
      </View>
      <View style={{ height: 24 }} />
    </ScrollView>
  )
}

// ─── Sheet d'édition d'une ligne ──────────────────────────────────────────────

function LineSheet({
  line,
  catId,
  taux,
  bdd,
  readOnly,
  updateLine,
  updateLineBatch,
  onDuplicate,
  onDelete,
  onClose,
}) {
  const c = calcLine(line, taux)
  const isSalarie = REGIMES_SALARIES.includes(line.regime)
  const [suggestOpen, setSuggestOpen] = useState(false)

  const set = (field, value) => {
    if (readOnly) return
    updateLine(catId, line.id || null, line._tempId || null, field, value)
  }

  // Suggestions catalogue BDD (6 max, filtre insensible à la casse)
  const suggestions = useMemo(() => {
    const q = (line.produit || '').trim().toLowerCase()
    if (!suggestOpen || q.length < 2) return []
    return bdd
      .filter((p) => (p.produit || '').toLowerCase().includes(q))
      .slice(0, 6)
  }, [bdd, line.produit, suggestOpen])

  const pickProduit = (p) => {
    const updates = { produit: p.produit, regime: regimeFromProduit(p) }
    if (p.tarif_defaut) updates.tarif_ht = Number(p.tarif_defaut)
    if (p.unite) updates.unite = p.unite
    if (p.description) updates.description = p.description
    updateLineBatch(catId, line.id || null, line._tempId || null, updates)
    setSuggestOpen(false)
  }

  const numProps = {
    keyboardType: 'decimal-pad',
    placeholderTextColor: colors.textDim,
    editable: !readOnly,
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {readOnly && (
        <View style={styles.sheetLockNote}>
          <Ionicons name="lock-closed-outline" size={13} color={colors.textSecondary} />
          <Text style={styles.sheetLockText}>Consultation seule (devis verrouillé).</Text>
        </View>
      )}

      {/* Produit + suggestions BDD */}
      <Text style={styles.fieldLabel}>Produit / poste</Text>
      <View style={styles.produitRow}>
        <TextInput
          value={line.produit || ''}
          onChangeText={(v) => {
            set('produit', v)
            setSuggestOpen(true)
          }}
          onFocus={() => setSuggestOpen(true)}
          placeholder="Cadreur, FX6, Étalonnage…"
          placeholderTextColor={colors.textDim}
          editable={!readOnly}
          style={[styles.input, { flex: 1 }]}
        />
        <View style={styles.useToggle}>
          <Text style={styles.useLabel}>Actif</Text>
          <Toggle value={Boolean(line.use_line)} onChange={(v) => set('use_line', v)} />
        </View>
      </View>
      {suggestions.length > 0 && (
        <View style={styles.suggestBox}>
          {suggestions.map((p) => (
            <PressableScale key={p.id} haptic="selection" onPress={() => pickProduit(p)}>
              <View style={styles.suggestRow}>
                <Text style={styles.suggestName} numberOfLines={1}>
                  {p.produit}
                </Text>
                {p.tarif_defaut != null && (
                  <Text style={styles.suggestPrice}>{fmtEur(p.tarif_defaut)}</Text>
                )}
              </View>
            </PressableScale>
          ))}
        </View>
      )}

      {/* Régime (chips) */}
      <Text style={styles.fieldLabel}>Régime</Text>
      <View style={styles.chipsWrap}>
        {Object.entries(REGIME_META).map(([regime, meta]) => {
          const active = line.regime === regime
          return (
            <PressableScale key={regime} haptic="selection" onPress={() => set('regime', regime)}>
              <View style={[styles.chip, active && styles.chipActive]}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{meta.abbr}</Text>
              </View>
            </PressableScale>
          )
        })}
      </View>

      {/* Description */}
      <Text style={styles.fieldLabel}>Description</Text>
      <TextInput
        value={line.description || ''}
        onChangeText={(v) => set('description', v)}
        placeholder="Description…"
        placeholderTextColor={colors.textDim}
        editable={!readOnly}
        multiline
        style={[styles.input, styles.inputMultiline]}
      />

      {/* Grille numérique */}
      <View style={styles.grid}>
        <View style={styles.cell}>
          <Text style={styles.fieldLabel}>Nb</Text>
          <TextInput
            {...numProps}
            value={String(line.nb ?? 1)}
            onChangeText={(v) => set('nb', parseFloat(v.replace(',', '.')) || 1)}
            style={[styles.input, styles.inputNum]}
          />
        </View>
        <View style={styles.cell}>
          <Text style={styles.fieldLabel}>Quantité</Text>
          <TextInput
            {...numProps}
            value={String(line.quantite ?? '')}
            onChangeText={(v) => set('quantite', parseFloat(v.replace(',', '.')) || 0)}
            style={[styles.input, styles.inputNum]}
          />
        </View>
        <View style={styles.cell}>
          <Text style={styles.fieldLabel}>Unité</Text>
          <View style={styles.uniteRow}>
            {UNITES.map((u) => {
              const active = (line.unite || 'F') === u
              return (
                <PressableScale key={u} haptic="selection" onPress={() => set('unite', u)}>
                  <View style={[styles.uniteChip, active && styles.chipActive]}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{u}</Text>
                  </View>
                </PressableScale>
              )
            })}
          </View>
        </View>
        <View style={styles.cell}>
          <Text style={styles.fieldLabel}>Tarif HT</Text>
          <TextInput
            {...numProps}
            value={String(line.tarif_ht ?? '')}
            onChangeText={(v) => set('tarif_ht', parseFloat(v.replace(',', '.')) || 0)}
            style={[styles.input, styles.inputNum]}
          />
        </View>
        <View style={styles.cell}>
          <Text style={styles.fieldLabel}>{isSalarie ? 'Coût (= tarif)' : 'Coût HT'}</Text>
          {isSalarie ? (
            <View style={[styles.input, styles.inputNum, { justifyContent: 'center' }]}>
              <Text style={{ color: colors.textMuted, textAlign: 'right' }}>
                {fmtEur(line.tarif_ht || 0)}
              </Text>
            </View>
          ) : (
            <TextInput
              {...numProps}
              value={line.cout_ht == null ? '' : String(line.cout_ht)}
              placeholder="= vente"
              onChangeText={(v) =>
                set('cout_ht', v === '' ? null : parseFloat(v.replace(',', '.')) || 0)
              }
              style={[styles.input, styles.inputNum]}
            />
          )}
        </View>
        <View style={styles.cell}>
          <Text style={styles.fieldLabel}>Remise %</Text>
          <TextInput
            {...numProps}
            value={line.remise_pct ? String(line.remise_pct) : ''}
            placeholder="0"
            onChangeText={(v) => set('remise_pct', parseFloat(v.replace(',', '.')) || 0)}
            style={[styles.input, styles.inputNum]}
          />
        </View>
      </View>

      {/* Prix calculé */}
      <View style={styles.priceRow}>
        <Text style={styles.priceLabel}>Prix de vente</Text>
        <Text style={styles.priceValue}>{fmtEur(c.prixVenteHT)}</Text>
      </View>

      {/* Actions */}
      {!readOnly && (
        <View style={styles.actionsRow}>
          <PressableScale haptic="light" onPress={onDuplicate} style={{ flex: 1 }}>
            <View style={styles.actionBtn}>
              <Ionicons name="copy-outline" size={15} color={colors.text} />
              <Text style={styles.actionText}>Dupliquer</Text>
            </View>
          </PressableScale>
          <PressableScale haptic="light" onPress={onDelete} style={{ flex: 1 }}>
            <View style={styles.actionBtn}>
              <Ionicons name="trash-outline" size={15} color={colors.status.danger} />
              <Text style={[styles.actionText, { color: colors.status.danger }]}>Supprimer</Text>
            </View>
          </PressableScale>
          <PressableScale haptic="light" onPress={onClose} style={{ flex: 1 }}>
            <View style={[styles.actionBtn, styles.actionPrimary]}>
              <Text style={[styles.actionText, { color: '#fff' }]}>OK</Text>
            </View>
          </PressableScale>
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  savingText: { color: colors.textMuted, fontSize: 11 },
  lockBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.glass.base,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  lockText: { color: colors.textSecondary, fontSize: 12, flex: 1 },
  empty: { color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 24 },

  bloc: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
    borderLeftWidth: 3,
    overflow: 'hidden',
  },
  blocHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  blocTitle: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    textTransform: 'uppercase',
    letterSpacing: 1,
    flexShrink: 1,
  },
  blocCount: { fontSize: 10, color: colors.textMuted },
  blocTotal: {
    marginLeft: 'auto',
    fontSize: 13,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
  },
  blocBody: { borderTopWidth: 0.5, borderTopColor: colors.glass.border },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.glass.border,
  },
  lineTitle: { fontSize: 13, color: colors.text, fontWeight: fontWeight.medium },
  lineSub: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  linePrice: {
    fontSize: 13,
    color: colors.brand.blueLight,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  addText: { color: colors.textMuted, fontSize: 12, fontWeight: fontWeight.semibold },

  synthBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: 12,
    backgroundColor: 'rgba(10,10,11,0.92)',
    borderTopWidth: 0.5,
    borderTopColor: colors.glass.border,
  },
  metricLabel: {
    fontSize: 9,
    color: colors.textMuted,
    fontWeight: fontWeight.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  metricValue: {
    fontSize: 14,
    color: colors.text,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
    marginTop: 1,
  },

  // ── Tiroir Synthèse ──
  synthTitle: {
    fontSize: 20,
    color: '#fff',
    fontWeight: fontWeight.bold,
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  adjRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 6,
  },
  adjLabel: { flex: 1, color: colors.text, fontSize: 13, fontWeight: fontWeight.medium },
  adjInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.glass.base,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
    borderRadius: radius.md,
    paddingHorizontal: 8,
  },
  adjInput: {
    width: 52,
    paddingVertical: 7,
    color: colors.text,
    fontSize: 14,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  adjSuffix: { color: colors.textMuted, fontSize: 12 },
  adjComputed: {
    width: 84,
    textAlign: 'right',
    color: colors.textMuted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  detailBox: {
    backgroundColor: colors.glass.base,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
  },
  detailLabel: { color: colors.textSecondary, fontSize: 13 },
  detailValue: { color: colors.text, fontSize: 13, fontVariant: ['tabular-nums'] },
  detailStrong: { fontWeight: fontWeight.bold, fontSize: 14, color: colors.text },

  // ── Sheet ──
  sheetLockNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  sheetLockText: { color: colors.textSecondary, fontSize: 12 },
  fieldLabel: {
    fontSize: 9,
    color: colors.textMuted,
    fontWeight: fontWeight.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 5,
    marginTop: spacing.md,
  },
  input: {
    backgroundColor: colors.glass.base,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 9,
    color: colors.text,
    fontSize: 14,
  },
  inputMultiline: { minHeight: 60, textAlignVertical: 'top' },
  inputNum: { textAlign: 'right', fontVariant: ['tabular-nums'] },
  produitRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  useToggle: { alignItems: 'center', gap: 2 },
  useLabel: { fontSize: 9, color: colors.textMuted },
  suggestBox: {
    marginTop: 4,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
    overflow: 'hidden',
  },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.glass.border,
  },
  suggestName: { color: colors.text, fontSize: 13, flex: 1, marginRight: 8 },
  suggestPrice: { color: colors.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.glass.base,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
  },
  chipActive: {
    backgroundColor: 'rgba(59,130,246,0.18)',
    borderColor: 'rgba(59,130,246,0.5)',
  },
  chipText: { color: colors.textSecondary, fontSize: 12, fontWeight: fontWeight.medium },
  chipTextActive: { color: colors.brand.blueLight, fontWeight: fontWeight.semibold },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md },
  cell: { width: '47%', flexGrow: 1 },
  uniteRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  uniteChip: {
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: radius.sm,
    backgroundColor: colors.glass.base,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: 'rgba(59,130,246,0.08)',
    borderRadius: radius.md,
    borderWidth: 0.5,
    borderColor: 'rgba(59,130,246,0.25)',
  },
  priceLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: fontWeight.semibold },
  priceValue: {
    color: colors.brand.blueLight,
    fontSize: 17,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: radius.md,
    backgroundColor: colors.glass.base,
    borderWidth: 0.5,
    borderColor: colors.glass.border,
  },
  actionPrimary: {
    backgroundColor: colors.brand.blue,
    borderColor: colors.brand.blue,
  },
  actionText: { color: colors.text, fontSize: 13, fontWeight: fontWeight.semibold },
})
