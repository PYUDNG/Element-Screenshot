import type { SettingsLink } from '@element-screenshot/settings'

/** Project home, also the place issues and releases live. */
export const PROJECT_URL = 'https://github.com/PYUDNG/Element-Screenshot'
/** Greasyfork listing, where most users install from. */
export const STORE_URL = 'https://greasyfork.org/scripts/604334'

/**
 * Shown next to the version in the settings footer. Brand names are literal:
 * they read the same in every locale.
 */
export const projectLinks: SettingsLink[] = [
  { id: 'github', label: 'GitHub', href: PROJECT_URL, icon: 'github' },
  { id: 'greasyfork', label: 'Greasyfork', href: STORE_URL, icon: 'greasyfork' }
]
