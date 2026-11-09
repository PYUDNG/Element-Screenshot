import { DEFAULT_SHORTCUT } from '@element-screenshot/settings'
import type { SettingsTab } from '@element-screenshot/settings'
import { isValidSiteRule } from '../core/site-policy'

const validateRule = (value: string): string | null =>
  isValidSiteRule(value) ? null : 'app.site.invalidRule'

export function createSettingsTabs(): SettingsTab[] {
  return [
    {
      id: 'capture',
      title: 'app.tab.capture',
      icon: 'camera',
      groups: [
        {
          id: 'trigger',
          title: 'app.group.trigger',
          defaultOpen: true,
          fields: [
            {
              type: 'shortcut',
              key: 'capture.shortcut',
              label: 'app.field.shortcut',
              description: 'app.field.shortcutDesc',
              default: DEFAULT_SHORTCUT
            }
          ]
        },
        {
          id: 'picker',
          title: 'app.group.picker',
          fields: [
            {
              type: 'switch',
              key: 'capture.pointerIsolation',
              label: 'app.field.pointerIsolation',
              description: 'app.field.pointerIsolationDesc',
              default: true
            }
          ]
        },
        {
          id: 'frame',
          title: 'app.group.frame',
          fields: [
            {
              type: 'color',
              key: 'capture.borderColor',
              label: 'app.field.borderColor',
              description: 'app.field.borderColorDesc',
              default: '#2563eb',
              swatches: ['#2563eb', '#16a34a', '#dc2626', '#f59e0b', '#18181b']
            },
            {
              type: 'range',
              key: 'capture.borderWidth',
              label: 'app.field.borderWidth',
              description: 'app.field.borderWidthDesc',
              default: 2,
              min: 1,
              max: 8,
              step: 1,
              unit: 'px'
            }
          ]
        },
        {
          id: 'output',
          title: 'app.group.output',
          fields: [
            {
              type: 'select',
              key: 'capture.scale',
              label: 'app.field.scale',
              description: 'app.field.scaleDesc',
              default: 'auto',
              options: [
                { value: 'auto', label: 'app.field.scaleAuto' },
                { value: '1', label: '1×' },
                { value: '2', label: '2×' },
                { value: '3', label: '3×' }
              ]
            },
            {
              type: 'switch',
              key: 'capture.backgroundAuto',
              label: 'app.field.backgroundAuto',
              description: 'app.field.backgroundAutoDesc',
              default: true,
              visible: (values) => values['capture.transparent'] !== true
            },
            {
              type: 'color',
              key: 'capture.background',
              label: 'app.field.background',
              description: 'app.field.backgroundDesc',
              default: '#ffffff',
              visible: (values) =>
                values['capture.transparent'] !== true && values['capture.backgroundAuto'] !== true
            },
            {
              type: 'switch',
              key: 'capture.transparent',
              label: 'app.field.transparent',
              description: 'app.field.transparentDesc',
              default: false
            },
            {
              type: 'switch',
              key: 'capture.expandNested',
              label: 'app.field.expandNested',
              description: 'app.field.expandNestedDesc',
              default: true
            }
          ]
        }
      ]
    },
    {
      id: 'trigger',
      title: 'app.tab.trigger',
      icon: 'keyboard',
      groups: [
        {
          id: 'fab',
          title: 'app.group.fab',
          defaultOpen: true,
          fields: [
            {
              type: 'switch',
              key: 'trigger.fabShow',
              label: 'app.field.fabShow',
              description: 'app.field.fabShowDesc',
              default: true
            },
            {
              type: 'range',
              key: 'trigger.fabSize',
              label: 'app.field.fabSize',
              description: 'app.field.fabSizeDesc',
              default: 48,
              min: 40,
              max: 64,
              step: 2,
              unit: 'px'
            },
            {
              type: 'number',
              key: 'trigger.fabX',
              label: 'app.field.fabPosition',
              default: 1,
              visible: () => false
            },
            {
              type: 'number',
              key: 'trigger.fabY',
              label: 'app.field.fabPosition',
              default: 1,
              visible: () => false
            },
            {
              // Edge the button is docked to, persisted so a reload keeps it
              // parked half outside the viewport.
              type: 'text',
              key: 'trigger.fabDock',
              label: 'app.field.fabPosition',
              default: '',
              visible: () => false
            }
          ]
        }
      ]
    },
    {
      id: 'sites',
      title: 'app.tab.sites',
      icon: 'globe',
      groups: [
        {
          id: 'rules',
          title: 'app.group.rules',
          defaultOpen: true,
          fields: [
            {
              type: 'list',
              key: 'site.include',
              label: 'app.field.include',
              description: 'app.field.includeDesc',
              default: [],
              placeholder: 'example.com',
              validate: validateRule
            },
            {
              type: 'list',
              key: 'site.exclude',
              label: 'app.field.exclude',
              description: 'app.field.excludeDesc',
              default: [],
              placeholder: '*.example.com',
              validate: validateRule
            }
          ]
        }
      ]
    }
  ]
}
