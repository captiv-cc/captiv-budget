// ════════════════════════════════════════════════════════════════════════════
// cache — persistance AsyncStorage simple (offline stale-while-revalidate)
// ════════════════════════════════════════════════════════════════════════════
//
// Les hooks Planning/Livrables écrivent leur dernier résultat ici après un
// fetch réussi, et hydratent depuis le cache au montage. Si le réseau est
// indispo (terrain festival), l'app affiche la dernière donnée connue.
//
// ════════════════════════════════════════════════════════════════════════════

import AsyncStorage from '@react-native-async-storage/async-storage'

const PREFIX = 'ccache:'

export async function loadCache(key) {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveCache(key, data) {
  AsyncStorage.setItem(PREFIX + key, JSON.stringify(data)).catch(() => {})
}
