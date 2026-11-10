<script setup lang="ts">
import { computed } from 'vue'
import type { ShotAppApi } from './api'
import Fab from './Fab.vue'
import PickerOverlay from './PickerOverlay.vue'
import RenderingChip from './RenderingChip.vue'
import ResultViewer from './ResultViewer.vue'
import ToastHost from './ToastHost.vue'

const props = defineProps<{
  app: ShotAppApi
}>()

const state = props.app.state
const isDark = computed(() => props.app.settings.resolvedTheme.value === 'dark')
const fabVisible = computed(
  () =>
    state.mode === 'idle' &&
    !props.app.settings.isOpen.value &&
    Boolean(props.app.settings.get('trigger.fabShow'))
)
</script>

<template>
  <div class="es-ui-root font-sans" :class="isDark ? 'dark' : ''">
    <Fab v-if="fabVisible" :app="app" />
    <!-- While rendering, the page stays interactive: no overlay, just a chip. -->
    <RenderingChip v-if="state.mode !== 'idle' && state.capturing" :app="app" />
    <!-- The page may have moved on since the pick, so the picker frame is only
         drawn while picking; the finished image gets its own viewer. -->
    <PickerOverlay v-else-if="state.mode === 'picking'" :app="app" />
    <ResultViewer v-else-if="state.mode === 'selected'" :app="app" />
    <ToastHost :toasts="state.toasts" />
  </div>
</template>
