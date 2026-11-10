import { h } from 'vue'
import type { FunctionalComponent } from 'vue'

export interface IconProps {
  size?: number
  strokeWidth?: number
}

type SvgNode = [tag: 'path' | 'circle' | 'rect' | 'line', attrs: Record<string, string | number>]

function createIcon(nodes: SvgNode[], solid = false): FunctionalComponent<IconProps> {
  const Icon: FunctionalComponent<IconProps> = (props, context) => {
    const { class: className, ...rest } = context.attrs
    return h(
      'svg',
      {
        ...rest,
        xmlns: 'http://www.w3.org/2000/svg',
        width: props.size ?? 18,
        height: props.size ?? 18,
        viewBox: '0 0 24 24',
        fill: solid ? 'currentColor' : 'none',
        stroke: solid ? 'none' : 'currentColor',
        'stroke-width': solid ? undefined : (props.strokeWidth ?? 2),
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
        focusable: 'false',
        class: ['es-icon', className]
      },
      nodes.map(([tag, attrs]) => h(tag, attrs))
    )
  }

  Icon.props = {
    size: Number,
    strokeWidth: Number
  }

  return Icon
}

export const CameraIcon = createIcon([
  [
    'path',
    {
      d: 'M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z'
    }
  ],
  ['circle', { cx: 12, cy: 13, r: 3 }]
])

export const SettingsIcon = createIcon([
  ['line', { x1: 21, x2: 14, y1: 4, y2: 4 }],
  ['line', { x1: 10, x2: 3, y1: 4, y2: 4 }],
  ['line', { x1: 21, x2: 12, y1: 12, y2: 12 }],
  ['line', { x1: 8, x2: 3, y1: 12, y2: 12 }],
  ['line', { x1: 21, x2: 16, y1: 20, y2: 20 }],
  ['line', { x1: 12, x2: 3, y1: 20, y2: 20 }],
  ['line', { x1: 14, x2: 14, y1: 2, y2: 6 }],
  ['line', { x1: 8, x2: 8, y1: 10, y2: 14 }],
  ['line', { x1: 16, x2: 16, y1: 18, y2: 22 }]
])

export const CloseIcon = createIcon([
  ['path', { d: 'M18 6 6 18' }],
  ['path', { d: 'm6 6 12 12' }]
])

export const CheckIcon = createIcon([['path', { d: 'M20 6 9 17l-5-5' }]])

export const CopyIcon = createIcon([
  ['rect', { x: 8, y: 8, width: 14, height: 14, rx: 2 }],
  ['path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' }]
])

export const DownloadIcon = createIcon([
  ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
  ['path', { d: 'M7 10l5 5 5-5' }],
  ['path', { d: 'M12 15V3' }]
])

export const SearchIcon = createIcon([
  ['circle', { cx: 11, cy: 11, r: 8 }],
  ['path', { d: 'm21 21-4.3-4.3' }]
])

export const ChevronDownIcon = createIcon([['path', { d: 'm6 9 6 6 6-6' }]])

export const ResetIcon = createIcon([
  ['path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }],
  ['path', { d: 'M3 3v5h5' }]
])

export const GlobeIcon = createIcon([
  ['circle', { cx: 12, cy: 12, r: 10 }],
  ['path', { d: 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20' }],
  ['path', { d: 'M2 12h20' }]
])

export const SunIcon = createIcon([
  ['circle', { cx: 12, cy: 12, r: 4 }],
  ['path', { d: 'M12 2v2' }],
  ['path', { d: 'M12 20v2' }],
  ['path', { d: 'm4.93 4.93 1.41 1.41' }],
  ['path', { d: 'm17.66 17.66 1.41 1.41' }],
  ['path', { d: 'M2 12h2' }],
  ['path', { d: 'M20 12h2' }],
  ['path', { d: 'm6.34 17.66-1.41 1.41' }],
  ['path', { d: 'm19.07 4.93-1.41 1.41' }]
])

export const MoonIcon = createIcon([['path', { d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z' }]])

export const MonitorIcon = createIcon([
  ['rect', { x: 2, y: 3, width: 20, height: 14, rx: 2 }],
  ['line', { x1: 8, x2: 16, y1: 21, y2: 21 }],
  ['line', { x1: 12, x2: 12, y1: 17, y2: 21 }]
])

export const PlusIcon = createIcon([
  ['path', { d: 'M5 12h14' }],
  ['path', { d: 'M12 5v14' }]
])

export const MinusIcon = createIcon([['path', { d: 'M5 12h14' }]])

export const TrashIcon = createIcon([
  ['path', { d: 'M3 6h18' }],
  ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }],
  ['path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }]
])

export const ImageIcon = createIcon([
  ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }],
  ['circle', { cx: 9, cy: 9, r: 2 }],
  ['path', { d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' }]
])

export const AlertIcon = createIcon([
  ['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z' }],
  ['path', { d: 'M12 9v4' }],
  ['path', { d: 'M12 17h.01' }]
])

export const InfoIcon = createIcon([
  ['circle', { cx: 12, cy: 12, r: 10 }],
  ['path', { d: 'M12 16v-4' }],
  ['path', { d: 'M12 8h.01' }]
])

export const MaximizeIcon = createIcon([
  ['path', { d: 'M8 3H5a2 2 0 0 0-2 2v3' }],
  ['path', { d: 'M21 8V5a2 2 0 0 0-2-2h-3' }],
  ['path', { d: 'M3 16v3a2 2 0 0 0 2 2h3' }],
  ['path', { d: 'M16 21h3a2 2 0 0 0 2-2v-3' }]
])

export const KeyboardIcon = createIcon([
  ['rect', { x: 2, y: 4, width: 20, height: 16, rx: 2 }],
  ['path', { d: 'M6 8h.01' }],
  ['path', { d: 'M10 8h.01' }],
  ['path', { d: 'M14 8h.01' }],
  ['path', { d: 'M18 8h.01' }],
  ['path', { d: 'M8 12h.01' }],
  ['path', { d: 'M12 12h.01' }],
  ['path', { d: 'M16 12h.01' }],
  ['path', { d: 'M7 16h10' }]
])

/** Brand marks are drawn filled, so they need a different default paint. */
const createSolidIcon = (nodes: SvgNode[]): FunctionalComponent<IconProps> =>
  createIcon(nodes, true)

export const GithubIcon = createSolidIcon([
  [
    'path',
    {
      d: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12'
    }
  ]
])

/** Greasyfork: a fork with a drip of grease. */
export const GreasyforkIcon = createIcon([
  ['path', { d: 'M5.5 3v5a4.5 4.5 0 0 0 9 0V3' }],
  ['path', { d: 'M10 3v5' }],
  ['path', { d: 'M10 12.5V21' }],
  ['path', { d: 'M18.5 9.5c1.6 2.2 2.4 3.8 2.4 4.8a2.4 2.4 0 1 1-4.8 0c0-1 .8-2.6 2.4-4.8Z' }]
])

export const iconMap = {
  camera: CameraIcon,
  settings: SettingsIcon,
  close: CloseIcon,
  check: CheckIcon,
  copy: CopyIcon,
  download: DownloadIcon,
  search: SearchIcon,
  chevronDown: ChevronDownIcon,
  reset: ResetIcon,
  globe: GlobeIcon,
  sun: SunIcon,
  moon: MoonIcon,
  monitor: MonitorIcon,
  plus: PlusIcon,
  minus: MinusIcon,
  trash: TrashIcon,
  image: ImageIcon,
  alert: AlertIcon,
  info: InfoIcon,
  maximize: MaximizeIcon,
  keyboard: KeyboardIcon,
  github: GithubIcon,
  greasyfork: GreasyforkIcon
} as const

export type IconName = keyof typeof iconMap

export function getIcon(name: IconName | undefined) {
  return name ? iconMap[name] : null
}
