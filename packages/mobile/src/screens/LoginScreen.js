// ════════════════════════════════════════════════════════════════════════════
// LoginScreen — connexion email/password (aligné maquette validée)
// ════════════════════════════════════════════════════════════════════════════
//
// Maquette : branding "captiv. DESK", titre "Connexion", champs email +
// password, bouton blanc "Se connecter", tagline "Reprenez le fil." en bas,
// footer copyright + mentions légales.
//
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  Alert,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'

import { Button, Input } from '../components/atoms'
import { useAuth } from '../lib/AuthContext'
import { colors, fontSize, fontWeight, spacing } from '../theme'

export default function LoginScreen() {
  const { signIn } = useAuth()
  const insets = useSafeAreaInsets()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit() {
    if (!email.trim() || !password) {
      Alert.alert('Connexion', 'Renseigne ton email et ton mot de passe.')
      return
    }
    setLoading(true)
    try {
      await signIn(email.trim(), password)
      // RootNavigator détectera la session via onAuthStateChange et switchera vers MainTabs.
    } catch (err) {
      Alert.alert('Connexion échouée', err?.message ?? 'Email ou mot de passe incorrect.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View
          style={[
            styles.inner,
            { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 14 },
          ]}
        >
          {/* Branding */}
          <View style={styles.branding}>
            <Text style={styles.brandText}>captiv.</Text>
            <View style={styles.brandBadge}>
              <Text style={styles.brandBadgeText}>DESK</Text>
            </View>
          </View>

          {/* Titre */}
          <View style={styles.titleBlock}>
            <Text style={styles.title}>Connexion</Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <Input
              label="Email"
              icon="mail-outline"
              value={email}
              onChangeText={setEmail}
              placeholder="votre@email.com"
              keyboardType="email-address"
              autoComplete="email"
              returnKeyType="next"
            />
            <Input
              label="Mot de passe"
              rightLabel="Mot de passe oublié ?"
              icon="lock-closed-outline"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
              autoComplete="password"
              returnKeyType="go"
              onSubmitEditing={handleSubmit}
            />

            <Button
              variant="primary"
              size="lg"
              onPress={handleSubmit}
              loading={loading}
              style={{ marginTop: spacing.md }}
            >
              Se connecter
            </Button>

            <View style={styles.sep} />

            <Text style={styles.contactText}>
              Pas encore de compte ?{' '}
              <Text style={styles.contactTextBold}>Contactez votre admin</Text>
            </Text>
          </View>

          {/* Tagline + footer */}
          <View style={styles.footer}>
            <Text style={styles.tagline}>Reprenez le fil.</Text>
            <Text style={styles.copyright}>
              © 2026 CAPTIV DESK ·{' '}
              <Text style={styles.link}>Mentions légales</Text> ·{' '}
              <Text style={styles.link}>Confidentialité</Text>
            </Text>
          </View>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 22,
  },
  branding: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  brandText: {
    fontSize: 20,
    color: '#fff',
    letterSpacing: -0.5,
    fontWeight: fontWeight.black,
  },
  brandBadge: {
    borderWidth: 0.5,
    borderColor: '#fff',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
  },
  brandBadgeText: {
    fontSize: 9,
    color: '#fff',
    fontWeight: fontWeight.bold,
    letterSpacing: 1.5,
  },
  titleBlock: {
    marginTop: 64,
    marginBottom: 36,
  },
  title: {
    fontSize: 30,
    color: '#fff',
    fontWeight: fontWeight.bold,
    letterSpacing: -0.8,
  },
  form: {
    gap: 14,
  },
  sep: {
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: 4,
  },
  contactText: {
    fontSize: fontSize.small,
    color: colors.textMuted,
    textAlign: 'center',
  },
  contactTextBold: {
    color: '#fff',
    fontWeight: fontWeight.medium,
  },
  footer: {
    marginTop: 'auto',
  },
  tagline: {
    fontSize: 18,
    color: '#fff',
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.4,
    marginBottom: 12,
  },
  copyright: {
    fontSize: 9,
    color: colors.textDim,
  },
  link: {
    color: colors.textMuted,
  },
})
