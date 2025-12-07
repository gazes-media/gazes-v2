<template>
  <div class="contents">
     <!-- Top navigation overlay -->
    <div class="absolute top-0 left-0 right-0 z-20 pointer-events-none" :class="{ 'opacity-0': !showControls, 'opacity-100': showControls }">
      <div class="bg-gradient-to-b from-black/80 via-black/40 to-transparent p-4 md:p-6 pointer-events-auto transition-opacity duration-300">
        <div class="flex items-center justify-between text-white">
          <div class="flex items-center gap-4">
            <NuxtLink :to="backLink" class="flex items-center gap-2 hover:text-zinc-300 transition-colors">
              <Icon name="heroicons:arrow-left" class="w-5 h-5" />
              <span class="text-sm font-medium hidden sm:inline">Retour</span>
            </NuxtLink>
            <div class="h-5 w-px bg-white/30 hidden sm:block"></div>
            <div class="flex flex-col">
              <div class="text-base font-medium text-white line-clamp-1">
                {{ title }}
              </div>
              <div class="text-xs sm:text-sm text-zinc-300 line-clamp-1">
                {{ subtitle }}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2">
             <!-- Extra header actions if needed -->
          </div>
        </div>

        <!-- Notice banner -->
        <div v-if="notice" class="mt-3 px-4 py-2 bg-amber-600/90 rounded-lg text-amber-100 text-sm">
          {{ notice }}
        </div>
      </div>
    </div>

     <!-- Loading state -->
      <div v-if="resolving" class="absolute inset-0 flex items-center justify-center text-white bg-black z-10">
        <div class="flex flex-col items-center justify-center text-white">
          <div class="w-16 h-16 border-2 border-white/20 border-t-violet-500 rounded-full animate-spin mb-4 mx-auto"></div>
          <p class="text-lg font-medium text-center">Recherche de sources...</p>
        </div>
      </div>

      <!-- Error state -->
      <div v-else-if="error" class="absolute inset-0 flex items-center justify-center text-white bg-black z-10">
        <div class="text-center max-w-md px-6">
          <Icon name="heroicons:exclamation-triangle" class="w-16 h-16 mx-auto mb-4 text-red-400" />
          <h3 class="text-xl font-semibold mb-2">Non disponible</h3>
          <p class="text-zinc-300 mb-4">{{ error }}</p>
          <button @click="$emit('retry')" class="bg-violet-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-violet-700 transition-colors">
            Réessayer
          </button>
        </div>
      </div>

       <!-- Video loading/buffering overlay -->
        <div v-if="loading || buffering" class="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-10 pointer-events-none">
          <div class="flex flex-col items-center justify-center text-white">
            <!-- Buffering indicator -->
            <div v-if="buffering" class="mb-4">
              <div class="w-16 h-16 border-4 border-violet-600/30 border-t-violet-600 rounded-full animate-spin mb-4 mx-auto"></div>
              <div class="w-32 h-2 bg-white/20 rounded-full overflow-hidden">
                <div
                  class="h-full bg-violet-600 transition-all duration-300"
                  :style="{ width: bufferProgress + '%' }"
                ></div>
              </div>
            </div>
            <!-- Regular loading -->
            <div v-else class="w-16 h-16 border-2 border-white/20 border-t-white rounded-full animate-spin mb-4 mx-auto"></div>
          </div>
        </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  subtitle: string
  backLink: string
  notice: string
  resolving: boolean
  error: string
  loading: boolean
  buffering: boolean
  bufferProgress: number
  showControls: boolean
}>()

defineEmits(['retry'])
</script>
