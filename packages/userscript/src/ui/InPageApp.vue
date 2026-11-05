<script setup lang="ts">
import { computed } from 'vue'
import type { ShotAppApi } from './api'
import Fab from './Fab.vue'
import PickerOverlay from './PickerOverlay.vue'
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
    <PickerOverlay v-if="state.mode !== 'idle'" :app="app" />
    <ToastHost :toasts="state.toasts" />
  </div>
</template>
