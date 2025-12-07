<template>
  <!-- Mobile Bottom Sheet / Desktop Floating Panel -->
  <div
    v-if="show"
    class="fixed inset-x-0 bottom-0 z-40 lg:absolute lg:inset-auto lg:right-4 lg:bottom-24 lg:w-96 lg:max-h-[32rem] lg:rounded-lg lg:border lg:border-zinc-700 bg-zinc-900/95 backdrop-blur-sm shadow-2xl overflow-hidden flex flex-col transition-transform duration-300 ease-out"
    :class="[
      // Mobile specific animations/styles
      'rounded-t-2xl lg:rounded-none border-t border-zinc-700 lg:border-t-0',
      show ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 lg:translate-y-0 lg:opacity-0'
    ]"
    @click.stop
  >
    <!-- Header -->
    <div class="flex items-center justify-between p-4 border-b border-zinc-700">
      <div>
        <h3 class="text-white font-semibold text-lg">Épisodes</h3>
        <p class="text-zinc-400 text-sm">{{ seasonDisplay }} • {{ lang.toUpperCase() }}</p>
      </div>
      <button @click="$emit('close')" class="text-zinc-400 hover:text-white transition-colors p-1 hover:bg-white/10 rounded">
        <Icon name="heroicons:x-mark" class="w-6 h-6" />
      </button>
    </div>

    <!-- Episodes List -->
    <div ref="scrollContainer" class="flex-1 overflow-y-auto custom-scrollbar max-h-[60vh] lg:max-h-80">
      <div v-if="loading" class="p-6 text-center text-zinc-400">
        <div class="w-8 h-8 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
        <p>Chargement des épisodes...</p>
      </div>

      <div v-else-if="episodes.length === 0" class="p-6 text-center text-zinc-400">
        <Icon name="heroicons:exclamation-triangle" class="w-12 h-12 mx-auto mb-3 text-zinc-500" />
        <p>Aucun épisode trouvé</p>
      </div>

      <div v-else class="divide-y divide-zinc-800">
        <button
          v-for="ep in episodes"
          :key="ep.episode"
          :data-episode="ep.episode"
          @click="$emit('select', ep.episode)"
          class="w-full p-4 text-left hover:bg-zinc-800/50 transition-all duration-200 flex items-center gap-4 group relative"
          :class="ep.episode === currentEpisode ? 'bg-violet-600/10 border-l-4 border-violet-500 pl-3' : 'hover:border-l-4 hover:border-zinc-600 pl-4'"
        >
          <!-- Episode thumbnail/number -->
          <div class="flex-shrink-0 w-20 h-12 bg-zinc-800 rounded-md overflow-hidden flex items-center justify-center relative group-hover:bg-zinc-700 transition-colors">
            <span class="text-white font-bold text-lg">{{ ep.episode.toString().padStart(2, '0') }}</span>
            <div v-if="ep.episode === currentEpisode" class="absolute inset-0 bg-violet-600/20 flex items-center justify-center">
              <Icon name="heroicons:play-circle" class="w-6 h-6 text-violet-400" />
            </div>
            <div v-else class="absolute inset-0 bg-black/0 group-hover:bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
              <Icon name="heroicons:play" class="w-5 h-5 text-white" />
            </div>
          </div>

          <!-- Episode info -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <h4 class="text-white font-medium text-base line-clamp-1">
                {{ ep.title || `Épisode ${ep.episode.toString().padStart(2, '0')}` }}
              </h4>
            </div>
            <p class="text-zinc-400 text-sm line-clamp-1">
              {{ ep.episode === currentEpisode ? 'En cours de lecture' : `Saison ${season}` }}
            </p>
          </div>

          <!-- Play indicator -->
          <div class="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity hidden lg:block">
            <Icon name="heroicons:chevron-right" class="w-5 h-5 text-zinc-400" />
          </div>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'

const props = defineProps<{
  show: boolean
  episodes: Array<{ episode: number; title?: string; url?: string }>
  loading: boolean
  currentEpisode: number
  season: string
  seasonDisplay: string
  lang: string
}>()

const emit = defineEmits(['close', 'select'])

const scrollContainer = ref<HTMLElement | null>(null)

// Auto-scroll to current episode
watch(() => props.show, (isShow) => {
  if (isShow && props.episodes.length > 0 && !props.loading) {
    nextTick(() => {
      scrollToCurrent()
    })
  }
})

function scrollToCurrent() {
  if (!scrollContainer.value) return
  
  const activeBtn = scrollContainer.value.querySelector(`[data-episode="${props.currentEpisode}"]`) as HTMLElement
  if (activeBtn) {
    activeBtn.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
}
</script>

<style scoped>
/* Custom Scrollbar */
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 10px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}
</style>
