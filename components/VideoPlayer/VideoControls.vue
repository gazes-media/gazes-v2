<template>
  <div
    class="absolute bottom-0 left-0 right-0 transition-opacity duration-200 pointer-events-none z-20"
    :class="show ? 'opacity-100' : 'opacity-0'"
    @click.stop
    @mouseenter="$emit('interaction')"
  >
    <!-- Bottom controls container -->
    <div class="bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pb-4 pt-8 md:px-6 md:pb-6 pointer-events-auto">
      <!-- Progress bar -->
      <div class="mb-3 group/progress">
        <div
          class="relative h-1 bg-white/20 rounded-full cursor-pointer group-hover/progress:h-2 hover:h-2 transition-all duration-200"
          :class="{ 'opacity-75': isSeeking }"
          @click="handleProgressClick"
          @mouseenter="isDragging = true"
          @mouseleave="isDragging = false"
        >
            <!-- Preview/Hover Time (Optional: could add later) -->

            <!-- Buffered progress -->
            <div
                class="absolute top-0 left-0 h-full bg-white/40 rounded-full"
                :style="{ width: bufferedPercent + '%' }"
            ></div>
            <!-- Current progress -->
            <div
                class="absolute top-0 left-0 h-full bg-violet-600 rounded-full transition-all duration-100"
                :style="{ width: progressPercent + '%' }"
            ></div>
            <!-- Progress handle -->
            <div
                class="absolute top-1/2 transform -translate-y-1/2 w-3 h-3 bg-violet-600 rounded-full opacity-0 group-hover/progress:opacity-100 transition-opacity duration-200 scale-0 group-hover/progress:scale-100"
                :style="{ left: progressPercent + '%', marginLeft: '-6px' }"
            ></div>
        </div>
      </div>

      <!-- Control buttons and info -->
      <div class="flex items-center justify-between text-white">
        <div class="flex items-center gap-2 md:gap-4">
          <!-- Play/Pause -->
          <button @click="$emit('toggle-play')" class="p-2 hover:bg-white/10 rounded-full transition-colors touch-manipulation">
            <Icon :name="isPlaying ? 'heroicons:pause' : 'heroicons:play'" class="w-7 h-7 md:w-8 md:h-8" />
          </button>

          <!-- Skip back/forward -->
          <div class="flex items-center gap-1">
             <button @click="$emit('seek-by', -10)" class="p-2 hover:bg-white/10 rounded-full transition-colors touch-manipulation" title="Reculer 10s">
                <Icon name="heroicons:backward" class="w-5 h-5 md:w-6 md:h-6" />
            </button>
            <button @click="$emit('seek-by', 10)" class="p-2 hover:bg-white/10 rounded-full transition-colors touch-manipulation" title="Avancer 10s">
                <Icon name="heroicons:forward" class="w-5 h-5 md:w-6 md:h-6" />
            </button>
          </div>

          <!-- Volume control (Hidden on small mobile) -->
          <div class="hidden sm:flex items-center gap-2 group/volume">
            <button @click="$emit('toggle-mute')" class="p-2 hover:bg-white/10 rounded-full transition-colors">
              <Icon
                :name="isMuted ? 'heroicons:speaker-x-mark' : 'heroicons:speaker-wave'"
                class="w-5 h-5 md:w-6 md:h-6"
              />
            </button>
            <div class="w-0 overflow-hidden group-hover/volume:w-20 transition-all duration-300 relative h-1 bg-white/20 rounded-full ml-1">
                <div class="h-full bg-violet-600" :style="{ width: (volume * 100) + '%' }"></div>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    :value="volume"
                    @input="$emit('set-volume', parseFloat(($event.target as HTMLInputElement).value))"
                    class="absolute inset-0 w-full opacity-0 cursor-pointer"
                />
            </div>
          </div>

          <!-- Time display -->
          <div class="text-xs md:text-sm text-zinc-300 whitespace-nowrap font-mono ml-2">
            {{ formatTime(currentTime) }} / {{ formatTime(duration) }}
          </div>
        </div>

        <div class="flex items-center gap-1 md:gap-3">
          <!-- Playback speed -->
          <div class="relative hidden xs:block">
            <button
              @click="toggleSpeedDropdown"
              class="flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-full transition-colors text-xs md:text-sm font-medium"
            >
              <span>{{ playbackSpeed }}x</span>
            </button>

             <div
                v-if="showSpeedDropdown"
                class="absolute bottom-full right-0 mb-2 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg z-50 w-24 overflow-hidden"
              >
                <button
                    v-for="speed in speedOptions"
                    :key="speed"
                    @click="setPlaybackSpeed(speed)"
                    class="w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 transition-colors"
                    :class="{ 'bg-zinc-700 text-white': speed === playbackSpeed, 'text-zinc-300': speed !== playbackSpeed }"
                >
                    {{ speed }}x
                </button>
            </div>
          </div>
          
           <!-- Episodes Toggle Button -->
          <button 
            @click="$emit('toggle-episodes')" 
            class="flex items-center gap-2 px-3 py-1.5 bg-violet-600/20 hover:bg-violet-600/40 text-violet-300 rounded-full transition-colors text-xs md:text-sm font-medium border border-violet-600/30"
          >
            <Icon name="heroicons:queue-list" class="w-4 h-4" />
            <span class="hidden sm:inline">Épisodes</span>
          </button>

          <!-- Quality selector -->
          <div v-if="hasMultipleSources" class="relative">
            <button
              @click="toggleQualityDropdown"
              class="flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-full transition-colors text-xs md:text-sm font-medium"
            >
              <Icon name="heroicons:cog-6-tooth" class="w-4 h-4" />
            </button>

             <div
                v-if="showQualityDropdown"
                class="absolute bottom-full right-0 mb-2 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg z-50 w-48 overflow-hidden"
            >
                <div class="py-1">
                    <button
                    v-for="(source, index) in sources"
                    :key="index"
                    @click="selectQuality(source)"
                    class="w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 transition-colors flex items-center gap-2"
                    :class="{ 'bg-zinc-700 text-white': source.proxiedUrl === currentSourceUrl, 'text-zinc-300': source.proxiedUrl !== currentSourceUrl }"
                    >
                    <span class="truncate flex-1">{{ source.quality || source.type.toUpperCase() }}</span>
                    </button>
                </div>
            </div>
          </div>
          

          <!-- Download -->
          <button @click="$emit('download')" class="p-2 hover:bg-white/10 rounded-full transition-colors hidden sm:block">
            <Icon name="heroicons:arrow-down-tray" class="w-5 h-5 md:w-6 md:h-6" />
          </button>
          
          <!-- Fullscreen -->
           <button @click="$emit('toggle-fullscreen')" class="p-2 hover:bg-white/10 rounded-full transition-colors">
            <Icon :name="isFullscreen ? 'heroicons:arrows-pointing-in' : 'heroicons:arrows-pointing-out'" class="w-5 h-5 md:w-6 md:h-6" />
           </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  show: boolean
  isPlaying: boolean
  isMuted: boolean
  volume: number
  currentTime: number
  duration: number
  buffered: number
  isSeeking: boolean
  playbackSpeed: number
  isFullscreen: boolean
  sources: Array<any>
  currentSourceUrl: string
}>()

const emit = defineEmits([
  'toggle-play', 'seek-by', 'toggle-mute', 'set-volume', 
  'seek-to', 'set-speed', 'select-quality', 'toggle-fullscreen',
  'interaction', 'toggle-episodes', 'download'
])

// Local state for UI toggles
const showSpeedDropdown = ref(false)
const showQualityDropdown = ref(false)
const isDragging = ref(false)

const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 2]

const progressPercent = computed(() => {
  return props.duration > 0 ? (props.currentTime / props.duration) * 100 : 0
})

const bufferedPercent = computed(() => {
  return props.duration > 0 ? (props.buffered / props.duration) * 100 : 0
})

const hasMultipleSources = computed(() => props.sources.length > 1)

// Methods
function handleProgressClick(event: MouseEvent) {
  const progressBar = event.currentTarget as HTMLElement
  const rect = progressBar.getBoundingClientRect()
  const pos = (event.clientX - rect.left) / rect.width
  const time = pos * props.duration
  emit('seek-to', time)
}

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

function toggleSpeedDropdown() {
    showSpeedDropdown.value = !showSpeedDropdown.value
    if(showSpeedDropdown.value) showQualityDropdown.value = false
}

function setPlaybackSpeed(speed: number) {
    emit('set-speed', speed)
    showSpeedDropdown.value = false
}

function toggleQualityDropdown() {
    showQualityDropdown.value = !showQualityDropdown.value
    if(showQualityDropdown.value) showSpeedDropdown.value = false
}

function selectQuality(source: any) {
    emit('select-quality', source)
    showQualityDropdown.value = false
}
</script>
