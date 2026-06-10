// ════════════════════════════════════════════════════════════════════════════
// Metro config — monorepo aware
// ════════════════════════════════════════════════════════════════════════════
//
// Metro est le bundler React Native. Par défaut, il ne sait pas regarder en
// dehors du dossier du projet. Pour que `@captiv/shared` (situé dans
// packages/shared/) soit résolu correctement, on configure Metro pour :
//   1. Watcher tout le workspace (packages/* à la racine du monorepo)
//   2. Résoudre les node_modules au root ET dans packages/mobile/
//   3. Désactiver le hierarchical lookup pour éviter les conflits de versions
//
// Référence : https://docs.expo.dev/guides/monorepos/
//
// ════════════════════════════════════════════════════════════════════════════

const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

// 1. Watch all files within the monorepo
config.watchFolders = [workspaceRoot]

// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

// 3. Force Metro to resolve (sub)dependencies only from the `nodeModulesPaths`
config.resolver.disableHierarchicalLookup = true

module.exports = config
