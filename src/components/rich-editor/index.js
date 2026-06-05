// ════════════════════════════════════════════════════════════════════════════
// rich-editor — Barrel export
// ════════════════════════════════════════════════════════════════════════════
//
// Importez :
//   import RichEditor, { EMPTY_DOC, isDocEmpty, docsEqual, extractPlainText }
//     from '@/components/rich-editor'
// ou en relatif :
//   import RichEditor from '../../components/rich-editor'
// ════════════════════════════════════════════════════════════════════════════

export { default } from './RichEditor'
export { default as RichEditorToolbar } from './RichEditorToolbar'
export {
  EMPTY_DOC,
  docsEqual,
  isDocEmpty,
  extractPlainText,
} from './utils'
