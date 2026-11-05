let defaultCss = ''

/** Register CSS that `controller.open()` injects into its shadow root. */
export function setDefaultSettingsStyles(css: string): void {
  defaultCss = css
}

export function getDefaultSettingsStyles(): string {
  return defaultCss
}

/**
 * Inject CSS into a shadow root using constructable stylesheets when possible.
 * Constructed sheets are not subject to the page's inline-style CSP.
 */
export function applyShadowStyles(shadow: ShadowRoot, css: string): void {
  if (!css) return

  try {
    if (typeof CSSStyleSheet !== 'undefined' && 'adoptedStyleSheets' in shadow) {
      const sheet = new CSSStyleSheet()
      if (typeof sheet.replaceSync === 'function') {
        sheet.replaceSync(css)
        shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet]
        return
      }
    }
  } catch {
    // Fall through to a <style> element.
  }

  const style = document.createElement('style')
  style.textContent = css
  shadow.appendChild(style)
}
