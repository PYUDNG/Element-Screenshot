<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ChevronDownIcon, CloseIcon, SearchIcon, SettingsIcon, getIcon } from '../icons'
import type { SettingsController } from '../settings'
import type { SettingsField, SettingsGroup, SettingsTab } from '../types'
import FieldControl from './FieldControl.vue'

const props = defineProps<{
  controller: SettingsController
}>()

const query = ref('')
const activeTabId = ref('')
const openGroups = ref<Record<string, boolean>>({})
const panelRef = ref<HTMLElement | null>(null)
const searchRef = ref<HTMLInputElement | null>(null)
const contentRef = ref<HTMLElement | null>(null)

const t = (key: string, params?: Record<string, string | number>): string =>
  props.controller.i18n.t(key, params)

const isDark = computed(() => props.controller.resolvedTheme.value === 'dark')

/**
 * Custom properties for the panel root, e.g. the accent colour.
 *
 * Read through the controller's reactive `values`, so a change repaints the panel
 * while it is open instead of waiting for the next open.
 */
const rootStyle = computed<Record<string, string>>(
  () => props.controller.variables?.(props.controller.values) ?? {}
)

function isFieldVisible(field: SettingsField): boolean {
  return field.visible ? field.visible(props.controller.values) : true
}

function matchesQuery(field: SettingsField, q: string): boolean {
  if (!q) return true
  const haystack = [t(field.label), field.description ? t(field.description) : '', field.key]
    .join(' ')
    .toLowerCase()
  return haystack.includes(q)
}

const filteredTabs = computed<SettingsTab[]>(() => {
  const q = query.value.trim().toLowerCase()
  return props.controller.tabs
    .map((tab) => ({
      ...tab,
      groups: tab.groups
        .map((group) => ({
          ...group,
          fields: group.fields.filter((field) => isFieldVisible(field) && matchesQuery(field, q))
        }))
        .filter((group) => group.fields.length > 0)
    }))
    .filter((tab) => tab.groups.length > 0)
})

const activeTab = computed<SettingsTab | null>(() => {
  return (
    filteredTabs.value.find((tab) => tab.id === activeTabId.value) ?? filteredTabs.value[0] ?? null
  )
})

watch(
  filteredTabs,
  (tabs) => {
    if (!tabs.some((tab) => tab.id === activeTabId.value)) {
      activeTabId.value = tabs[0]?.id ?? ''
    }
  },
  { immediate: true }
)

watch(activeTabId, () => {
  contentRef.value?.scrollTo({ top: 0 })
})

function groupKey(tabId: string, groupId: string): string {
  return `${tabId}:${groupId}`
}

function isGroupOpen(tabId: string, group: SettingsGroup): boolean {
  if (query.value.trim()) return true
  const key = groupKey(tabId, group.id)
  const stored = openGroups.value[key]
  return stored === undefined ? group.defaultOpen === true : stored
}

function toggleGroup(tabId: string, group: SettingsGroup): void {
  const key = groupKey(tabId, group.id)
  openGroups.value[key] = !isGroupOpen(tabId, group)
}

function setField(field: SettingsField, value: Parameters<SettingsController['set']>[1]): void {
  props.controller.set(field.key, value)
}

function close(): void {
  props.controller.close()
}

function onTabKeydown(event: KeyboardEvent, index: number): void {
  if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) return
  event.preventDefault()
  const tabs = filteredTabs.value
  if (tabs.length === 0) return
  const delta = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1
  const next = (index + delta + tabs.length) % tabs.length
  const tab = tabs[next]
  if (!tab) return
  activeTabId.value = tab.id
  nextTick(() => {
    panelRef.value?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(tab.id)}"]`)?.focus()
  })
}

function focusableElements(): HTMLElement[] {
  const root = panelRef.value
  if (!root) return []
  const elements = Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  )
  const visible = elements.filter((element) => element.getClientRects().length > 0)
  return visible.length > 0 ? visible : elements
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    searchRef.value?.focus()
    searchRef.value?.select()
    return
  }

  if (event.key !== 'Tab') return
  const elements = focusableElements()
  if (elements.length === 0) return
  const first = elements[0]
  const last = elements[elements.length - 1]
  const active = document.activeElement
  if (event.shiftKey && active === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first?.focus()
  }
}

onMounted(() => {
  for (const tab of props.controller.tabs) {
    for (const group of tab.groups) {
      if (group.defaultOpen) openGroups.value[groupKey(tab.id, group.id)] = true
    }
  }
  nextTick(() => panelRef.value?.focus())
})
</script>

<template>
  <div
    class="es-root font-sans text-zinc-900 dark:text-zinc-100"
    :class="isDark ? 'dark' : ''"
    :style="rootStyle"
    @keydown="onKeydown"
  >
    <div class="pointer-events-auto fixed inset-0 bg-zinc-950/45" @click="close"></div>

    <div
      ref="panelRef"
      class="pointer-events-auto fixed inset-0 flex h-full w-full flex-col overflow-hidden border-zinc-200 bg-white outline-none dark:border-zinc-800 dark:bg-zinc-900 sm:m-auto sm:h-[min(760px,86vh)] sm:w-[min(980px,92vw)] sm:rounded-xl sm:border"
      role="dialog"
      aria-modal="true"
      :aria-label="t('settings.title')"
      tabindex="-1"
      @click.stop
    >
      <header
        class="flex shrink-0 flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:px-5"
      >
        <div class="flex items-center gap-2 text-base font-semibold">
          <SettingsIcon :size="18" class="text-primary-600 dark:text-primary-400" />
          <span>{{ t('settings.title') }}</span>
        </div>

        <div class="order-3 w-full sm:order-none sm:ml-auto sm:w-60">
          <div class="relative">
            <SearchIcon
              :size="15"
              class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
            />
            <input
              ref="searchRef"
              v-model="query"
              type="search"
              class="w-full rounded-md border border-zinc-300 bg-white py-1.5 pl-8 pr-2 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              :placeholder="t('settings.searchPlaceholder')"
              :aria-label="t('settings.searchPlaceholder')"
            />
          </div>
        </div>

        <button
          type="button"
          class="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          :aria-label="t('settings.close')"
          @click="close"
        >
          <CloseIcon :size="16" />
        </button>
      </header>

      <div class="flex min-h-0 flex-1 flex-col sm:flex-row">
        <nav
          class="flex shrink-0 gap-1 overflow-x-auto border-b border-zinc-200 px-2 py-2 dark:border-zinc-800 sm:w-52 sm:flex-col sm:border-b-0 sm:border-r"
          role="tablist"
          :aria-label="t('settings.tablist')"
          aria-orientation="vertical"
        >
          <button
            v-for="(tab, index) in filteredTabs"
            :key="tab.id"
            :id="`settings-tab-${tab.id}`"
            :data-tab-id="tab.id"
            role="tab"
            :aria-selected="tab.id === activeTabId"
            :aria-controls="`settings-panel-${tab.id}`"
            :tabindex="tab.id === activeTabId ? 0 : -1"
            class="flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
            :class="
              tab.id === activeTabId
                ? 'bg-primary-50 font-medium text-primary-700 dark:bg-primary-500/10 dark:text-primary-300'
                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
            "
            @click="activeTabId = tab.id"
            @keydown="onTabKeydown($event, index)"
          >
            <component :is="getIcon(tab.icon)" v-if="tab.icon" :size="16" />
            <span class="truncate">{{ t(tab.title) }}</span>
          </button>
        </nav>

        <main ref="contentRef" class="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div
            v-if="!activeTab"
            class="flex h-full flex-col items-center justify-center gap-2 py-16 text-zinc-400"
          >
            <SearchIcon :size="28" />
            <p class="text-sm">{{ t('settings.noResults') }}</p>
          </div>

          <div
            v-else
            :id="`settings-panel-${activeTab.id}`"
            role="tabpanel"
            :aria-labelledby="`settings-tab-${activeTab.id}`"
            class="space-y-3"
          >
            <section
              v-for="group in activeTab.groups"
              :key="group.id"
              class="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
            >
              <button
                type="button"
                class="flex w-full items-center gap-2 bg-zinc-50 px-3 py-2.5 text-left transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500/40 dark:bg-zinc-800/40 dark:hover:bg-zinc-800/70"
                :aria-expanded="isGroupOpen(activeTab.id, group)"
                :aria-controls="`settings-group-${activeTab.id}-${group.id}`"
                @click="toggleGroup(activeTab.id, group)"
              >
                <ChevronDownIcon
                  :size="16"
                  class="shrink-0 text-zinc-400 transition-transform"
                  :class="isGroupOpen(activeTab.id, group) ? '' : '-rotate-90'"
                />
                <span class="text-sm font-medium">{{ t(group.title) }}</span>
                <span
                  v-if="group.description"
                  class="ml-1 hidden truncate text-xs text-zinc-500 sm:inline dark:text-zinc-400"
                >
                  {{ t(group.description) }}
                </span>
              </button>

              <div
                v-show="isGroupOpen(activeTab.id, group)"
                :id="`settings-group-${activeTab.id}-${group.id}`"
                class="divide-y divide-zinc-100 px-3 dark:divide-zinc-800/70"
              >
                <FieldControl
                  v-for="field in group.fields"
                  :key="field.key"
                  :field="field"
                  :value="controller.values[field.key]"
                  :values="controller.values"
                  :i18n="controller.i18n"
                  @update="setField(field, $event)"
                />
              </div>
            </section>
          </div>
        </main>
      </div>

      <footer
        class="flex shrink-0 items-center gap-3 border-t border-zinc-200 px-4 py-2.5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
      >
        <div class="flex min-w-0 items-center gap-1.5">
          <span v-if="controller.version" class="truncate tabular-nums">{{
            t('settings.version', { version: controller.version })
          }}</span>
          <a
            v-for="link in controller.links"
            :key="link.id"
            :href="link.href"
            target="_blank"
            rel="noopener noreferrer"
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            :title="link.label"
            :aria-label="link.label"
          >
            <component :is="getIcon(link.icon)" v-if="link.icon" :size="14" />
            <span v-else class="text-[11px] font-medium">{{ link.label }}</span>
          </a>
        </div>
        <span class="ml-auto hidden sm:inline">{{ t('settings.footerHint') }}</span>
        <button
          type="button"
          class="rounded-md px-2 py-1 font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          @click="close"
        >
          {{ t('settings.close') }}
        </button>
      </footer>
    </div>
  </div>
</template>
