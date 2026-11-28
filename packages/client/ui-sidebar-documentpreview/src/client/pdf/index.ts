/** Builtin PDF registration through document metadata and the keyed body slot. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '../index.ts'
import type { DocumentPreviewDefinition } from '../contract/registry.ts'
import { LazyPdfBody } from '../contract/LazyPdfBody.tsx'
import { pdfBodyRegistration } from '../contract/pdf-registration.ts'
import { en, ja, es, fr, de, ru, pt, zh } from './locales.ts'

/** PDF metadata and keyed body share this package-local implementation identity. */
export const PDF_BODY_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/pdf'

/**
 * Describe the builtin PDF renderer independently from its keyed body slot.
 * @param title - locale-owned implementation name.
 * @returns the complete-file PDF registration.
 */
export function pdfBodyDefinition(title: () => string): DocumentPreviewDefinition {
  return { id: PDF_BODY_ID, extensions: ['pdf'], binaryExtensions: ['pdf'], priority: 'builtin', title, loading: 'bytes-complete', wrap: false }
}

/** @param ctx - context carrying the locale, document registry, and slot registry. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('sidebarPdf', { zh, en, ja, es, fr, de, ru, pt }))
  const t = ctx.locale.bind('sidebarPdf')
  ctx.effect(() => ctx.documentPreviews.register(pdfBodyDefinition(() => t('title'))))
  const presentation = pdfBodyRegistration(ctx)
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
    name: 'sidebar.right.tab.document', key: PDF_BODY_ID, locale: 'sidebarPdf', ...presentation,
  }, LazyPdfBody)))
}
