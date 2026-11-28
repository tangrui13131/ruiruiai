/** PDF body registration shared by the builtin PDF viewer and the Office viewer's PDF mode. */
import type { Context } from '@deepseek-ai/cordis'
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PdfBodyInjected } from './pdf.ts'
import { createPdfStore, type PdfStore } from './pdf-store.ts'
import { retainDocumentTabs } from './tab-lifetime.ts'
import { ZoomViewport, zoomSurfaceClass } from './zoom/ZoomViewport.tsx'

/**
 * Retain PDF viewing state for a document entry's tab lifetime.
 * @param ctx - owning registration context.
 * @returns the store and injection shared by ordinary and Office PDF registrations.
 */
export function pdfBodyRegistration(ctx: Context): {
  store: PdfStore
  inject: (sessionId: SessionId, actions: BoundActions<PdfStore>) => PdfBodyInjected
} {
  const store = createPdfStore()
  const retainTab = retainDocumentTabs(ctx)
  return {
    store,
    inject: (_sessionId, actions): PdfBodyInjected => ({
      retainTab: (tabId, signal) => { retainTab(tabId, signal, actions.forget) },
      ZoomViewport,
      zoomSurfaceClass,
    }),
  }
}
