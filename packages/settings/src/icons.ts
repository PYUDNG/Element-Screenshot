import { h } from 'vue'
import type { FunctionalComponent } from 'vue'

export interface IconProps {
  size?: number
  strokeWidth?: number
}

type SvgNode = [tag: 'path' | 'circle' | 'rect' | 'line', attrs: Record<string, string | number>]

function createIcon(nodes: SvgNode[]): FunctionalComponent<IconProps> {
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
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': props.strokeWidth ?? 2,
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
  keyboard: KeyboardIcon
} as const

export type IconName = keyof typeof iconMap

export function getIcon(name: IconName | undefined) {
  return name ? iconMap[name] : null
}
