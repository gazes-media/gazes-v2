<script setup lang="ts">
// Ultra-optimized video.js lazy loading with preloading hints
let videojs: any = null
let videojsPromise: Promise<any> | null = null

const loadVideoJS = async () => {
  if (videojs) return videojs
  if (videojsPromise) return videojsPromise

  // Add preload hint for video.js when component mounts
  if (typeof document !== 'undefined' && !document.querySelector('link[data-videojs-preload]')) {
    const preloadLink = document.createElement('link')
    preloadLink.rel = 'preload'
    preloadLink.href = '/_nuxt/video-player.js'
    preloadLink.as = 'script'
    preloadLink.setAttribute('data-videojs-preload', 'true')
    document.head.appendChild(preloadLink)
  }

  videojsPromise = import('video.js').then(async (module) => {
    videojs = module.default
    // Load minimal video.js CSS only when needed
    if (typeof document !== 'undefined') {
      // Load only essential video.js styles instead of full CSS bundle
      const essentialVideoCSS = `
        .video-js {
          width: 100%;
          height: 100%;
          font-size: 14px;
          color: #fff;
          background-color: #000;
          position: relative;
        }
        .vjs-tech {
          width: 100%;
          height: 100%;
          position: absolute;
          top: 0;
          left: 0;
        }
        .vjs-loading-spinner {
          display: none !important;
        }
        .vjs-big-play-button {
          display: none !important;
        }
        .vjs-text-track-display {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          top: 0;
          pointer-events: none;
        }
        .vjs-modal-dialog {
          background: rgba(0, 0, 0, 0.8);
          color: #fff;
        }
        .vjs-error-display {
          background: rgba(0, 0, 0, 0.8);
          color: #fff;
        }
      `
      const style = document.createElement('style')
      style.textContent = essentialVideoCSS
      document.head.appendChild(style)
    }
    return videojs
  })

  return videojsPromise
}

import { onBeforeUnmount, onMounted, ref, watch, nextTick, computed } from 'vue'
import { formatSeasonDisplay } from '~/shared/utils/season'
import { getProviderInfo } from '~/shared/utils/videoProviders'
import VideoControls from '~/components/VideoPlayer/VideoControls.vue'
import EpisodeSelector from '~/components/VideoPlayer/EpisodeSelector.vue'
import VideoOverlay from '~/components/VideoPlayer/VideoOverlay.vue'

// Use player layout (no navbar)
definePageMeta({
  layout: 'player'
})

const route = useRoute()

// Get route params as refs
const id = ref(route.params.id as string)
const season = ref(route.params.season as string)
const lang = ref(route.params.lang as 'vostfr' | 'vf' | 'va' | 'var' | 'vkr' | 'vcn' | 'vqc' | 'vf1' | 'vf2' | 'vj')
const episodeNum = ref(Number(route.params.episode))
const debug = computed(() => route.query.debug === '1' || route.query.debug === 'true')
const isContinueWatching = computed(() => route.query.continue === 'true')

const showPlayer = ref(true)
const playUrl = ref('')
const currentSourceIndex = ref(0)
const resolving = ref(false)
const resolveError = ref('')
const resolvedList = ref<{ type: string; url: string; directUrl: string; proxiedUrl: string; quality?: string }[]>([])
const notice = ref('')
const videoRef = ref<HTMLVideoElement | null>(null)
const videoError = ref('')
const videoLoading = ref(false)
const isBuffering = ref(false)
const bufferProgress = ref(0)

// Track which languages are currently being resolved
const resolvingLanguages = ref<Set<string>>(new Set())

// Cache for resolved sources by language to enable instant switching
const resolvedSourcesByLanguage = ref<Record<string, { sources: Array<{ type: string; url: string; directUrl: string; proxiedUrl: string; quality?: string }>; resolvedAt: number; episode: number; season: string }>>({})

// Language switching state
const availableLanguages = ref<Array<{ code: string; name: string; available: boolean }>>([])
const languageOptions = computed(() => availableLanguages.value.filter(lang => lang.available))
const showLanguageDropdown = ref(false)

// Video player state
const currentTime = ref(0)
const duration = ref(0)
const buffered = ref(0)
const volume = ref(1)
const isMuted = ref(false)
const isPlaying = ref(false)
const isFullscreen = ref(false)
const showControls = ref(true)
const isSeeking = ref(false)
const isDragging = ref(false)
const controlsTimeout = ref<ReturnType<typeof setTimeout> | null>(null)
const wasPlayingBeforeSeek = ref(false)
const playbackSpeed = ref(1)
const showSpeedDropdown = ref(false)
const isPictureInPicture = ref(false)
const showQualityDropdown = ref(false)
const autoPlayNext = ref(true) // Enable/disable auto-play next episode
const showNextEpisodeOverlay = ref(false)
const nextEpisodeCountdown = ref(10) // 10 second countdown
const nextEpisodeTimeout = ref<ReturnType<typeof setTimeout> | null>(null)

// CORS and proxy fallback state
const triedDirectUrl = ref(false)
const corsFailedSources = ref<Set<string>>(new Set())

// Mobile touch state
const touchSeekOverlay = ref(false)
const touchSeekTime = ref(0)

// Volume localStorage functions
const VOLUME_STORAGE_KEY = 'gazes-player-volume'

function saveVolumeSettings() {
  try {
    const settings = {
      volume: volume.value,
      isMuted: isMuted.value,
      timestamp: Date.now()
    }
    localStorage.setItem(VOLUME_STORAGE_KEY, JSON.stringify(settings))
  } catch (error) {
    console.warn('Failed to save volume settings:', error)
  }
}

function loadVolumeSettings() {
  try {
    const stored = localStorage.getItem(VOLUME_STORAGE_KEY)
    if (stored) {
      const settings = JSON.parse(stored)
      // Only load if settings are recent (within 30 days)
      const isRecent = settings.timestamp && (Date.now() - settings.timestamp) < (30 * 24 * 60 * 60 * 1000)

      if (isRecent) {
        volume.value = settings.volume ?? 1
        isMuted.value = settings.isMuted ?? false
        return true
      } else {
      }
    }
  } catch (error) {
    console.warn('Failed to load volume settings:', error)
  }
  return false
}

// Animation frame for smooth progress updates
let progressAnimationFrame: number | null = null

// Optimized progress updates with throttling
let lastProgressUpdate = 0
const PROGRESS_UPDATE_THROTTLE = 100 // Update at most every 100ms

// Buffer progress tracking
let bufferAnimationFrame: number | null = null

function updateProgressSmoothly() {
  const now = Date.now()
  if (now - lastProgressUpdate < PROGRESS_UPDATE_THROTTLE) {
    progressAnimationFrame = requestAnimationFrame(updateProgressSmoothly)
    return
  }

  const el = videoRef.value
  if (el && !el.paused && !el.ended) {
    const newTime = el.currentTime
    const newBuffered = el.buffered.length > 0 ? el.buffered.end(el.buffered.length - 1) : 0

    // Only update if values actually changed to reduce re-renders
    if (Math.abs(newTime - currentTime.value) > 0.1) {
      currentTime.value = newTime
    }
    if (Math.abs(newBuffered - buffered.value) > 0.5) {
      buffered.value = newBuffered
    }

    lastProgressUpdate = now
    progressAnimationFrame = requestAnimationFrame(updateProgressSmoothly)
  }
}

function startProgressUpdates() {
  if (progressAnimationFrame) {
    cancelAnimationFrame(progressAnimationFrame)
  }
  updateProgressSmoothly()
}

function stopProgressUpdates() {
  if (progressAnimationFrame) {
    cancelAnimationFrame(progressAnimationFrame)
    progressAnimationFrame = null
  }
}

function updateBufferProgress() {
  const el = videoRef.value
  if (el && el.buffered.length > 0 && duration.value > 0) {
    const bufferedEnd = el.buffered.end(el.buffered.length - 1)
    bufferProgress.value = Math.min(100, (bufferedEnd / duration.value) * 100)
  }
  bufferAnimationFrame = requestAnimationFrame(updateBufferProgress)
}

function startBufferUpdates() {
  if (bufferAnimationFrame) {
    cancelAnimationFrame(bufferAnimationFrame)
  }
  updateBufferProgress()
}

function stopBufferUpdates() {
  if (bufferAnimationFrame) {
    cancelAnimationFrame(bufferAnimationFrame)
    bufferAnimationFrame = null
  }
}

// Episode selector state
const showEpisodes = ref(false)
const episodesList = ref<Array<{ episode: number; title?: string; url: string; urls?: string[] }>>([])
const loadingEpisodes = ref(false)
const episodesScrollContainer = ref<HTMLElement | null>(null)

// Progress tracking state
const savedProgress = ref<{ currentTime: number; duration: number } | null>(null)
const progressSaveInterval = ref<ReturnType<typeof setInterval> | null>(null)
const lastSavedTime = ref(0)



// Computed for current language display
const currentLanguageDisplay = computed(() => {
  const current = languageOptions.value.find(opt => opt.code === lang.value)
  return current || { name: lang.value.toUpperCase() }
})

// Computed for formatted season display
const formattedSeasonDisplay = computed(() => formatSeasonDisplay(season.value))

// Computed for formatted episode display
const formattedEpisodeDisplay = computed(() => `Épisode ${episodeNum.value.toString().padStart(2, '0')}`)

// Computed for picture-in-picture support
const pictureInPictureEnabled = computed(() => {
  if (typeof document === 'undefined') return false
  return document.pictureInPictureEnabled
})

// Anime and episode metadata
const animeTitle = ref('')
const currentEpisodeTitle = ref('')

// Dynamic language flags from 179.43.149.218
const dynamicLanguageFlags = ref<Record<string, string>>({})

// Skip functionality state
const skipTimes = ref<Array<{ type: 'op' | 'ed'; startTime: number; endTime: number }>>([])
const skipEnabled = ref(true) // Enable/disable skip functionality
const showSkipButtons = ref(false)
const currentSkipType = ref<'op' | 'ed' | null>(null)
const skipTimeout = ref<ReturnType<typeof setTimeout> | null>(null)

// Track which skips have been dismissed for the current episode
const dismissedSkips = ref<Set<'op' | 'ed'>>(new Set())

// Sync localStorage progress to server (call this when user logs in)
async function syncLocalProgressToServer() {
  try {
    // Find all localStorage progress keys
    const progressKeys = Object.keys(localStorage).filter(key => key.startsWith('progress_'))

    for (const key of progressKeys) {
      try {
        const stored = localStorage.getItem(key)
        if (!stored) continue

        const progressData = JSON.parse(stored)

        // Try to save to server
        await $fetch(`/api/watch/progress/${progressData.animeId}`, {
          method: 'POST',
          body: {
            season: progressData.season,
            episode: progressData.episode,
            currentTime: progressData.currentTime,
            duration: progressData.duration
          }
        })

        // Remove from localStorage after successful sync
        localStorage.removeItem(key)
      } catch (error) {
        console.warn('Failed to sync progress for key:', key, error)
      }
    }
  } catch (error) {
    console.warn('Failed to sync local progress to server:', error)
  }
}
async function loadSavedProgress() {
  try {
    // First try to load from server
    const response = await $fetch(`/api/watch/progress/${id.value}`)
    if (response?.success && 'progress' in response) {
      // Handle both array and single object responses
      const progressData = Array.isArray(response.progress) ? response.progress : [response.progress]
      if (progressData.length > 0) {
        // Find progress for current episode
        const episodeProgress = progressData.find((p: any) =>
          p.season === season.value && p.episode === episodeNum.value
        )
        if (episodeProgress && !(episodeProgress as any).completed) {
          savedProgress.value = {
            currentTime: (episodeProgress as any).currentTime,
            duration: (episodeProgress as any).duration
          }
          return
        }
      }
    }
  } catch (error) {
    console.warn('Failed to load progress from server, trying localStorage:', error)
  }

  // Fallback to localStorage
  try {
    const progressKey = `progress_${id.value}_${season.value}_${episodeNum.value}`
    const stored = localStorage.getItem(progressKey)

    if (stored) {
      const progressData = JSON.parse(stored)

      // Check if data is recent (within 30 days)
      const isRecent = progressData.timestamp && (Date.now() - progressData.timestamp) < (30 * 24 * 60 * 60 * 1000)

      if (isRecent && progressData.currentTime && progressData.duration) {
        savedProgress.value = {
          currentTime: progressData.currentTime,
          duration: progressData.duration
        }
        return
      } else {
        // Clean up expired data
        localStorage.removeItem(progressKey)
      }
    }
  } catch (localStorageError) {
    console.warn('Failed to load progress from localStorage:', localStorageError)
  }
}

async function saveProgress(currentTime: number, duration: number) {
  // Don't save if duration is 0 or very short
  if (duration < 10) return

  // Don't save too frequently (throttle to every 5 seconds)
  const now = Date.now()
  if (now - lastSavedTime.value < 5000) return

  try {
    // Try to save to server first (if authenticated)
    const response = await $fetch(`/api/watch/progress/${id.value}`, {
      method: 'POST',
      body: {
        season: season.value,
        episode: episodeNum.value,
        currentTime,
        duration
      }
    })

    if (response?.success) {
      lastSavedTime.value = now
      return
    }
  } catch (error) {
    console.warn('Failed to save progress to server, falling back to localStorage:', error)

    // Fallback to localStorage if server save fails
    try {
      const progressKey = `progress_${id.value}_${season.value}_${episodeNum.value}`
      const progressData = {
        currentTime,
        duration,
        timestamp: now,
        animeId: id.value,
        season: season.value,
        episode: episodeNum.value
      }

      localStorage.setItem(progressKey, JSON.stringify(progressData))
      lastSavedTime.value = now
    } catch (localStorageError) {
      console.warn('Failed to save progress to localStorage:', localStorageError)
    }
  }
}

function startProgressSaving() {
  if (progressSaveInterval.value) {
    clearInterval(progressSaveInterval.value)
  }

  // Save progress every 30 seconds while playing
  progressSaveInterval.value = setInterval(() => {
    if (isPlaying.value && duration.value > 0) {
      saveProgress(currentTime.value, duration.value)
    }
  }, 30000)
}

function stopProgressSaving() {
  if (progressSaveInterval.value) {
    clearInterval(progressSaveInterval.value)
    progressSaveInterval.value = null
  }
}


// Computed progress values to avoid recalculating in template
const progressPercent = computed(() => {
  return duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0
})

const bufferedPercent = computed(() => {
  return duration.value > 0 ? (buffered.value / duration.value) * 100 : 0
})

let player: any = null

function isM3U8(url: string) { return /\.m3u8(\?.*)?$/i.test(url) }

let hlsLoadTimeout: ReturnType<typeof setTimeout> | null = null

function destroyPlayer() {
  try {
    if (player) {
      // Clear any pending timeouts
      if (hlsLoadTimeout) {
        clearTimeout(hlsLoadTimeout)
        hlsLoadTimeout = null
      }
      if (retryTimeout) {
        clearTimeout(retryTimeout)
        retryTimeout = null
      }
      player.dispose()
    }
  } catch (e) {
    console.warn('Error destroying player:', e)
  }
  player = null
  stopProgressUpdates() // Stop smooth progress updates
  // Also remove video event listeners
  removeVideoEventListeners(videoRef.value)
}

// Custom controls functions
function togglePlay() {
  if (player) {
    if (isPlaying.value) {
      player.pause()
    } else {
      player.play().catch((e: any) => {
      })
    }
  } else {
    const el = videoRef.value
    if (!el) return

    if (isPlaying.value) {
      el.pause()
    } else {
      el.play().catch(e => {
      })
    }
  }
  showControlsTemporarily()
}

function handleVideoClick(event: MouseEvent) {
  // Just toggle play, don't interfere with episodes panel
  togglePlay()
}

function handleVideoDoubleClick() {
  // Double tap to seek forward 10 seconds (like YouTube)
  seekBy(10)
  showSeekFeedback('forward', 10)
}

function showSeekFeedback(direction: 'forward' | 'backward', seconds: number) {
  touchSeekOverlay.value = true
  touchSeekTime.value = seconds
  setTimeout(() => {
    touchSeekOverlay.value = false
  }, 1000)
}

// Screenshot functionality


function seek(time: number) {
  // Prevent rapid seeking that can cause audio desynchronization
  if (isSeeking.value) {
    return
  }

  if (player) {
    player.currentTime(time)
    currentTime.value = time
  } else {
    const el = videoRef.value
    if (!el) return
    el.currentTime = time
    currentTime.value = time
  }
}

function seekBy(seconds: number) {
  // Prevent rapid seeking that can cause audio desynchronization
  if (isSeeking.value) {
    return
  }

  if (player) {
    const newTime = Math.max(0, Math.min(player.duration(), player.currentTime() + seconds))
    player.currentTime(newTime)
    currentTime.value = newTime
  } else {
    const el = videoRef.value
    if (!el) return
    const newTime = Math.max(0, Math.min(el.duration, el.currentTime + seconds))
    el.currentTime = newTime
    currentTime.value = newTime
  }
}

function toggleMute() {
  if (player) {
    player.muted(!player.muted())
    isMuted.value = player.muted()
  } else {
    const el = videoRef.value
    if (!el) return
    el.muted = !el.muted
    isMuted.value = el.muted
  }
  saveVolumeSettings()
}

function setVolume(newVolume: number) {
  const clampedVolume = Math.max(0, Math.min(1, newVolume))

  if (player) {
    player.volume(clampedVolume)
    volume.value = player.volume()
    if (player.volume() > 0) {
      player.muted(false)
      isMuted.value = false
    }
  } else {
    const el = videoRef.value
    if (!el) return
    el.volume = clampedVolume
    volume.value = el.volume
    if (el.volume > 0) {
      el.muted = false
      isMuted.value = false
    }
  }
  saveVolumeSettings()
}

// Playback speed functions
const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 2]

function setPlaybackSpeed(speed: number) {
  playbackSpeed.value = speed
  if (player) {
    player.playbackRate(speed)
  } else {
    const el = videoRef.value
    if (el) {
      el.playbackRate = speed
    }
  }
  showControlsTemporarily()
}

function cyclePlaybackSpeed() {
  const currentIndex = speedOptions.indexOf(playbackSpeed.value)
  const nextIndex = (currentIndex + 1) % speedOptions.length
  setPlaybackSpeed(speedOptions[nextIndex]!)
}

function toggleSpeedDropdown() {
  showSpeedDropdown.value = !showSpeedDropdown.value
}

function closeSpeedDropdown() {
  showSpeedDropdown.value = false
}

// Picture-in-Picture functions
function togglePictureInPicture() {
  if (typeof document === 'undefined' || !document.pictureInPictureEnabled) {
    console.warn('Picture-in-Picture not supported')
    return
  }

  const videoElement = player ? player.el() : videoRef.value
  if (!videoElement) return

  if (document.pictureInPictureElement) {
    document.exitPictureInPicture()
  } else {
    videoElement.requestPictureInPicture().catch((err: any) => {
      console.error('Failed to enter Picture-in-Picture:', err)
    })
  }
  showControlsTemporarily()
}

function handlePictureInPictureChange() {
  if (typeof document !== 'undefined') {
    isPictureInPicture.value = !!document.pictureInPictureElement
  }
}



// Quality selector functions
function toggleQualityDropdown() {
  showQualityDropdown.value = !showQualityDropdown.value
}

function closeQualityDropdown() {
  showQualityDropdown.value = false
}

function selectQuality(source: { type: string; url: string; proxiedUrl: string; quality?: string }) {
  switchToSource(source)
  showQualityDropdown.value = false
  showControlsTemporarily()
}

// Auto-play next episode functions
function startNextEpisodeCountdown() {
  if (!autoPlayNext.value) return

  // Check if there's a next episode
  const currentEpisodeIndex = episodesList.value.findIndex(ep => ep.episode === episodeNum.value)
  if (currentEpisodeIndex === -1 || currentEpisodeIndex >= episodesList.value.length - 1) return

  showNextEpisodeOverlay.value = true
  nextEpisodeCountdown.value = 10

  nextEpisodeTimeout.value = setInterval(() => {
    nextEpisodeCountdown.value--
    if (nextEpisodeCountdown.value <= 0) {
      playNextEpisode()
    }
  }, 1000)
}

function cancelNextEpisodeCountdown() {
  if (nextEpisodeTimeout.value) {
    clearInterval(nextEpisodeTimeout.value)
    nextEpisodeTimeout.value = null
  }
  showNextEpisodeOverlay.value = false
  nextEpisodeCountdown.value = 10
}

function playNextEpisode() {
  cancelNextEpisodeCountdown()
  const currentEpisodeIndex = episodesList.value.findIndex(ep => ep.episode === episodeNum.value)
  if (currentEpisodeIndex !== -1 && currentEpisodeIndex < episodesList.value.length - 1) {
    const nextEpisode = episodesList.value[currentEpisodeIndex + 1]
    if (nextEpisode) {
      selectEpisode(nextEpisode.episode)
    }
  }
}

function toggleAutoPlayNext() {
  autoPlayNext.value = !autoPlayNext.value
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen()
  } else {
    document.exitFullscreen()
  }
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

function showControlsTemporarily() {
  showControls.value = true
  updateCursorVisibility()
  if (controlsTimeout.value) {
    clearTimeout(controlsTimeout.value)
  }
  controlsTimeout.value = setTimeout(() => {
    if (isPlaying.value && !isDragging.value) {
      showControls.value = false
      updateCursorVisibility()
    }
  }, 3000)
}

function updateCursorVisibility() {
  const playerContainer = document.querySelector('.fixed.inset-0.bg-black.z-50') as HTMLElement
  const videoElement = videoRef.value as HTMLElement

  if (isFullscreen.value) {
    // In fullscreen, hide cursor when controls are hidden
    const cursorStyle = showControls.value ? 'default' : 'none'
    if (playerContainer) {
      playerContainer.style.cursor = cursorStyle
    }
    if (videoElement) {
      videoElement.style.cursor = cursorStyle
    }
    // Also set on body as fallback
    document.body.style.cursor = cursorStyle
  } else {
    // Outside fullscreen, always show cursor
    if (playerContainer) {
      playerContainer.style.cursor = 'default'
    }
    if (videoElement) {
      videoElement.style.cursor = 'pointer' // Restore pointer cursor for video element
    }
    document.body.style.cursor = 'default'
  }
}

function handleMouseMove() {
  showControlsTemporarily()
}

function handleProgressClick(event: MouseEvent) {
  // Prevent rapid seeking that can cause audio desynchronization
  if (isSeeking.value) {
    return
  }

  const el = videoRef.value
  const progressBar = event.currentTarget as HTMLElement
  if (!el || !progressBar) return

  const rect = progressBar.getBoundingClientRect()
  const clickX = event.clientX - rect.left
  const percentage = clickX / rect.width
  const newTime = percentage * el.duration

  seek(newTime)
}

function handleKeyPress(event: KeyboardEvent) {
  const el = videoRef.value
  if (!el) return

  switch (event.key) {
    case ' ':
    case 'k':
      event.preventDefault()
      togglePlay()
      break
    case 'ArrowLeft':
      event.preventDefault()
      seekBy(-10)
      break
    case 'ArrowRight':
      event.preventDefault()
      seekBy(10)
      break
    case 'ArrowUp':
      event.preventDefault()
      setVolume(volume.value + 0.1)
      break
    case 'ArrowDown':
      event.preventDefault()
      setVolume(volume.value - 0.1)
      break
    case 'm':
      event.preventDefault()
      toggleMute()
      break
    case 'f':
      event.preventDefault()
      toggleFullscreen()
      break
    case 'e':
    case 'E':
      event.preventDefault()
      toggleEpisodesPanel()
      break
     case 'l':
     case 'L':
       event.preventDefault()
       if (languageOptions.value.length > 1) {
         const currentIndex = languageOptions.value.findIndex(opt => opt.code === lang.value)
         const nextIndex = (currentIndex + 1) % languageOptions.value.length
         const nextOption = languageOptions.value[nextIndex]
         if (nextOption) {
           switchLanguage(nextOption.code as any)
         }
       }
       break
     case '<':
     case ',':
       event.preventDefault()
       cyclePlaybackSpeed()
       break
     case '>':
     case '.':
       event.preventDefault()
       // Cycle backwards
       const currentIndex = speedOptions.indexOf(playbackSpeed.value)
       const prevIndex = currentIndex === 0 ? speedOptions.length - 1 : currentIndex - 1
       setPlaybackSpeed(speedOptions[prevIndex]!)
       break
     case 'p':
     case 'P':
       event.preventDefault()
       togglePictureInPicture()
       break


     case 'Escape':
      event.preventDefault()
      if (showEpisodes.value) {
        showEpisodes.value = false
      } else if (document.fullscreenElement) {
        document.exitFullscreen()
      }
      break
  }
  showControlsTemporarily()
}

// --- Stable handler references for video events ---
function onVideoPlay() {
  isPlaying.value = true
  isBuffering.value = false
  videoLoading.value = false // Clear loading when video actually starts
  if (videoError.value && videoError.value.includes('Cliquez')) {
    videoError.value = '' // Clear autoplay error when video starts
  }
  startProgressUpdates() // Start smooth progress updates
  startBufferUpdates() // Start buffer progress updates
  startProgressSaving() // Start automatic progress saving
  showControlsTemporarily()
  updateCursorVisibility()
}
function onVideoPause() {
  isPlaying.value = false
  stopProgressUpdates() // Stop smooth progress updates
  stopBufferUpdates() // Stop buffer progress updates
  stopProgressSaving() // Stop automatic progress saving
  // Save progress immediately when paused
  if (duration.value > 0) {
    saveProgress(currentTime.value, duration.value)
  }
  showControls.value = true
  updateCursorVisibility()
}
function onVideoTimeUpdate() { handleTimeUpdate() }
function onVideoLoadedMetadata() { handleLoadedMetadata() }
function onVideoVolumeChange() { handleVolumeChange() }
function onVideoSeeking() {
  isSeeking.value = true
  // Pause video during seeking for smoother experience
  const el = videoRef.value
  if (el && !el.paused) {
    wasPlayingBeforeSeek.value = true
    el.pause()
  } else {
    wasPlayingBeforeSeek.value = false
  }
}
function onVideoSeeked() {
  isSeeking.value = false
  // Resume playback if video was playing before seek
  const el = videoRef.value
  if (el && wasPlayingBeforeSeek.value && el.paused) {
    el.play().catch(e => {
    })
  }
}
 function onVideoError(e: Event) {
  const videoEl = e.target as HTMLVideoElement
  const error = videoEl?.error
  videoError.value = 'Erreur de chargement vidéo'
  videoLoading.value = false
  handleVideoError(error, 'native')
}
 function onVideoEnded() {
   isPlaying.value = false
   showControls.value = true
   // Mark episode as completed when it actually ends
   if (duration.value > 0) {
     saveProgress(duration.value, duration.value) // This will mark it as completed
   }

   // Start auto-play countdown for next episode
   startNextEpisodeCountdown()
 }
// --- Stable handler references for Hls events ---
let hlsErrorHandler: ((event: string, data: any) => void) | null = null
let hlsManifestParsedHandler: (() => void) | null = null

// --- Stable handler references for global events ---
function handleFullscreenChange() {
  const wasFullscreen = isFullscreen.value
  isFullscreen.value = !!document.fullscreenElement

  // When exiting fullscreen, show controls temporarily
  if (wasFullscreen && !isFullscreen.value) {
    showControlsTemporarily()
  }

  updateCursorVisibility()
}

function removeVideoEventListeners(el: any) {
  if (!el) return
  el.removeEventListener('play', onVideoPlay)
  el.removeEventListener('pause', onVideoPause)
  el.removeEventListener('timeupdate', onVideoTimeUpdate)
  el.removeEventListener('loadedmetadata', onVideoLoadedMetadata)
  el.removeEventListener('volumechange', onVideoVolumeChange)
  el.removeEventListener('seeking', onVideoSeeking)
  el.removeEventListener('seeked', onVideoSeeked)
  el.removeEventListener('ended', onVideoEnded)
  el.removeEventListener('error', onVideoError)
}

function addVideoEventListeners(el: any) {
  if (!el) return
  // Use passive listeners for better performance where appropriate
  el.addEventListener('play', onVideoPlay, { passive: true })
  el.addEventListener('pause', onVideoPause, { passive: true })
  el.addEventListener('timeupdate', onVideoTimeUpdate, { passive: true })
  el.addEventListener('loadedmetadata', onVideoLoadedMetadata, { passive: true })
  el.addEventListener('volumechange', onVideoVolumeChange, { passive: true })
  el.addEventListener('seeking', onVideoSeeking, { passive: true })
  el.addEventListener('seeked', onVideoSeeked, { passive: true })
  el.addEventListener('ended', onVideoEnded, { passive: true })
  el.addEventListener('error', onVideoError, { passive: true })
}

function handleVideoEvents() {
  const el = videoRef.value
  if (!el) return
  removeVideoEventListeners(el)
  addVideoEventListeners(el)
}

function handlePlay() {
  isPlaying.value = true
  // Clear autoplay error when video actually starts playing
  if (videoError.value && videoError.value.includes('Autoplay')) {
    videoError.value = ''
  }
  showControlsTemporarily()
}

function handlePause() {
  isPlaying.value = false
  showControls.value = true
}

function handleTimeUpdate() {
  const el = videoRef.value
  if (!el) return
  // Only update if not using smooth updates (for paused/seeking states)
  if (!progressAnimationFrame) {
    currentTime.value = el.currentTime
    if (el.buffered.length > 0) {
      buffered.value = el.buffered.end(el.buffered.length - 1)
    }
  }

  // Check if skip buttons should be shown
  checkSkipAvailability()
}

function handleLoadedMetadata() {
  if (player) {
    duration.value = player.duration()
    // Apply loaded volume settings to the player
    if (volume.value !== undefined) {
      player.volume(volume.value)
    }
    if (isMuted.value !== undefined) {
      player.muted(isMuted.value)
    }
    // Apply playback speed
    player.playbackRate(playbackSpeed.value)
    // Update reactive refs to match player state
    volume.value = player.volume()
    isMuted.value = player.muted()
    isPlaying.value = !player.paused()
  } else {
    const el = videoRef.value
    if (!el) return
    duration.value = el.duration
    // Apply loaded volume settings to the video element
    if (volume.value !== undefined) {
      el.volume = volume.value
    }
    if (isMuted.value !== undefined) {
      el.muted = isMuted.value
    }
    // Apply playback speed
    el.playbackRate = playbackSpeed.value
    // Update reactive refs to match element state
    volume.value = el.volume
    isMuted.value = el.muted
    isPlaying.value = !el.paused
  }

  // Load skip times now that we have the episode duration
  loadSkipTimes()

  // Resume from saved progress if available
  if (savedProgress.value && savedProgress.value.duration > 0) {
    const resumeTime = savedProgress.value.currentTime
    const currentPlaybackTime = player ? player.currentTime() : videoRef.value?.currentTime || 0

    // Always resume if coming from continue watching, or if we're at the beginning (within first 5 seconds)
    const shouldResume = isContinueWatching.value || currentPlaybackTime < 5

    if (shouldResume) {
      if (player) {
        player.currentTime(resumeTime)
      } else if (videoRef.value) {
        videoRef.value.currentTime = resumeTime
      }
      currentTime.value = resumeTime

      // Show a notice when resuming from continue watching
      if (isContinueWatching.value) {
        notice.value = `Repris à ${Math.floor(resumeTime / 60)}:${String(Math.floor(resumeTime % 60)).padStart(2, '0')}`
        // Clear the notice after 3 seconds
        setTimeout(() => {
          notice.value = ''
        }, 3000)

        // For continue watching, try to autoplay after seeking
        setTimeout(() => {
          if (player && !player.playing()) {
            player.play().catch((e: any) => {
            })
          } else if (videoRef.value && videoRef.value.paused) {
            videoRef.value.play().catch((e: any) => {
            })
          }
        }, 500) // Small delay to ensure seek is complete
      }
    }
  }
}

function handleVolumeChange() {
  if (player) {
    volume.value = player.volume()
    isMuted.value = player.muted()
  } else {
    const el = videoRef.value
    if (!el) return
    volume.value = el.volume
    isMuted.value = el.muted
  }
}

function handleEnded() {
  isPlaying.value = false
  showControls.value = true
}

// Skip functionality functions
async function loadSkipTimes() {
  try {
    const params = duration.value > 0 ? { episodeLength: duration.value } : {}
    const response = await $fetch(`/api/anime/${id.value}/skip/${episodeNum.value}`, { params })
    if (response?.skipTimes && Array.isArray(response.skipTimes)) {
      skipTimes.value = response.skipTimes
    } else {
      skipTimes.value = []
    }
  } catch (error) {
    console.warn('⏭️ [SKIP] Failed to load skip times:', error)
    skipTimes.value = []
  }
}

function skipToEnd(skipType: 'op' | 'ed') {
  const skipTime = skipTimes.value.find(s => s.type === skipType)
  if (skipTime && videoRef.value) {
    seek(skipTime.endTime)
    hideSkipButtons()
  } else {
    console.warn(`⏭️ [SKIP] Could not skip ${skipType.toUpperCase()} - skip time not found or video not ready`)
  }
}

function hideSkipButtons() {
  showSkipButtons.value = false
  const skipType = currentSkipType.value
  currentSkipType.value = null

  // Mark the current skip type as dismissed for this episode
  if (skipType) {
    dismissedSkips.value.add(skipType)
  }

  if (skipTimeout.value) {
    clearTimeout(skipTimeout.value)
    skipTimeout.value = null
  }
}

function checkSkipAvailability() {
  if (!skipEnabled.value || skipTimes.value.length === 0) return

  const currentVideoTime = currentTime.value
  let shouldShowButtons = false
  let activeSkipType: 'op' | 'ed' | null = null

  for (const skipTime of skipTimes.value) {
    // Skip if this skip type has already been dismissed for this episode
    if (dismissedSkips.value.has(skipTime.type)) {
      continue
    }

    const timeUntilStart = skipTime.startTime - currentVideoTime
    const timeUntilEnd = skipTime.endTime - currentVideoTime

    // Show skip button when we're within the skip period
    if (currentVideoTime >= skipTime.startTime && currentVideoTime < skipTime.endTime) {
      shouldShowButtons = true
      activeSkipType = skipTime.type
      break
    }

    // Also show a few seconds before the skip period starts
    if (timeUntilStart > 0 && timeUntilStart <= 3) {
      shouldShowButtons = true
      activeSkipType = skipTime.type
      break
    }
  }

  if (shouldShowButtons && !showSkipButtons.value) {
    showSkipButtons.value = true
    currentSkipType.value = activeSkipType
    // Auto-hide after 10 seconds if not interacted with
    skipTimeout.value = setTimeout(() => {
      hideSkipButtons()
    }, 10000)
  } else if (!shouldShowButtons && showSkipButtons.value) {
    hideSkipButtons()
  }
}

// Track setup attempts to prevent infinite loops
let setupAttempts = 0

// Retry system for video errors
let currentSourceRetries = 0
const MAX_RETRIES_PER_SOURCE = 2
let lastErrorType = ''
let retryTimeout: ReturnType<typeof setTimeout> | null = null

// Test direct URL access with timeout and error detection
async function testDirectUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const testVideo = document.createElement('video')
    testVideo.crossOrigin = 'anonymous'
    testVideo.preload = 'metadata'

    const timeout = setTimeout(() => {
      testVideo.remove()
      reject(new Error('Direct URL test timeout'))
    }, 3000)

    const cleanup = () => {
      clearTimeout(timeout)
      testVideo.remove()
    }

    testVideo.addEventListener('loadedmetadata', () => {
      cleanup()
      resolve()
    })

    testVideo.addEventListener('error', (e) => {
      cleanup()
      const error = testVideo.error
      reject(new Error(`Direct URL failed: ${error?.message || 'Unknown error'}`))
    })

    testVideo.addEventListener('abort', () => {
      cleanup()
      reject(new Error('Direct URL test aborted'))
    })

    testVideo.src = url
    document.body.appendChild(testVideo)
  })
}

async function setupVideo() {
  const el = videoRef.value
  if (!el || !playUrl.value) {
    console.warn('setupVideo: Missing video element or playUrl')
    return
  }

  // Reset setup attempts and retry counters for new episode
  setupAttempts = 0
  currentSourceRetries = 0
  lastErrorType = ''
  triedDirectUrl.value = false

  videoError.value = ''
  videoLoading.value = true
  isBuffering.value = false
  isPlaying.value = false

  // Remove all old event listeners first
  removeVideoEventListeners(el)

  // Clear any existing player
  el.pause()
  destroyPlayer()
  el.removeAttribute('src')
  
  // Reset styles to ensure visibility
  el.style.display = 'block'
  el.style.visibility = 'visible'
  el.style.opacity = '1'
  el.style.width = '100%'
  el.style.height = '100%'

  // Apply saved volume settings to video element before setting up player
  loadVolumeSettings()
  el.volume = volume.value
  el.muted = isMuted.value
  el.crossOrigin = 'anonymous'

  // Determine if we should try direct URL first
  const currentSource = resolvedList.value[currentSourceIndex.value]
  const shouldTryDirect = currentSource?.directUrl && !corsFailedSources.value.has(currentSource.url)

  try {
    if (isM3U8(playUrl.value)) {
      // For HLS streams, we need to check if direct access works
      if (shouldTryDirect && !triedDirectUrl.value) {
        console.log('🎯 Trying direct HLS URL first:', currentSource.directUrl)
        triedDirectUrl.value = true

        // Try direct URL with timeout
        const directTestPromise = testDirectUrl(currentSource.directUrl)
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Direct URL timeout')), 3000)
        )

        try {
          await Promise.race([directTestPromise, timeoutPromise])
          console.log('✅ Direct HLS URL works, using it')
          playUrl.value = currentSource.directUrl
        } catch (directError) {
          console.log('❌ Direct HLS URL failed, falling back to proxy:', (directError as Error).message)
          corsFailedSources.value.add(currentSource.url)
          playUrl.value = currentSource.proxiedUrl
        }
      }

      // Use Video.js for HLS streams (direct or proxied)
      const VideoJS = await loadVideoJS()
      
      // Dispose old player if exists
      if (player) {
        try {
          player.dispose()
        } catch (e) {
          console.warn('Error disposing old player:', e)
        }
      }

      player = VideoJS(el, {
        controls: false, // We use custom controls
        autoplay: false, // Don't autoplay initially - we'll manually control it
        muted: isMuted.value,
        preload: 'auto',
        html5: {
          hls: {
            overrideNative: true,
            enableLowInitialPlaylist: true,
            smoothQualityChange: true,
            maxBufferLength: 30,
            maxMaxBufferLength: 600,
            debug: debug.value,
          },
          nativeAudioTracks: false,
          nativeVideoTracks: false,
        },
        responsive: true,
        fluid: true,
      })

      // Set the source first
      console.log('Setting HLS source:', playUrl.value)
      player.src({
        src: playUrl.value,
        type: 'application/x-mpegURL'
      })

      // Set up video.js event handlers
      player.off('error')
      player.off('loadedmetadata')
      player.off('canplay')
      player.off('waiting')
      player.off('playing')

      player.on('error', () => {
        const error = player.error()
        if (error) {
          console.error('Video.js HLS error:', error)
          videoError.value = `Erreur vidéo: ${error.message || 'Unknown error'}`
          videoLoading.value = false
          handleVideoError(error, 'videojs-hls')
        }
      })

      player.on('loadedmetadata', () => {
        console.log('HLS metadata loaded')
        videoLoading.value = false
        isBuffering.value = false
        handleLoadedMetadata()
      })

      player.on('canplay', () => {
        console.log('HLS can play')
        videoLoading.value = false
        isBuffering.value = false
      })

      player.on('waiting', () => {
        isBuffering.value = true
      })

      player.on('playing', () => {
        isBuffering.value = false
      })

      // Apply volume settings to Video.js player
      player.volume(volume.value)
      player.muted(isMuted.value)

      // Load the video
      player.load()

      // Try to play after a brief delay
      await nextTick()
      const playPromise = player.play()
      if (playPromise) {
        playPromise.catch((e: any) => {
          console.debug('HLS autoplay prevented:', e.message)
          videoLoading.value = false
        })
      }

      // Set timeout for loading
      if (hlsLoadTimeout) clearTimeout(hlsLoadTimeout)
      hlsLoadTimeout = setTimeout(() => {
        console.warn('HLS loading timeout')
        videoLoading.value = false
        isBuffering.value = false
      }, 15000)
    } else {
      // For MP4 and other direct video files, try direct access first
      if (shouldTryDirect && !triedDirectUrl.value) {
        console.log('🎯 Trying direct video URL first:', currentSource.directUrl)
        triedDirectUrl.value = true

        // Test direct URL access
        try {
          await testDirectUrl(currentSource.directUrl)
          console.log('✅ Direct video URL works, using it')
          playUrl.value = currentSource.directUrl
        } catch (directError) {
          console.log('❌ Direct video URL failed, falling back to proxy:', (directError as Error).message)
          corsFailedSources.value.add(currentSource.url)
          playUrl.value = currentSource.proxiedUrl
        }
      }

      // Use native video element for MP4
      console.log('Setting native video source:', playUrl.value)
      el.src = playUrl.value

      // Attach video element events
      handleVideoEvents()

      // Try to play
      await nextTick()
      el.play().catch(e => {
        console.debug('Native video autoplay prevented:', e.message)
        videoLoading.value = false
      })

      // Set a reasonable timeout for video loading
      const safetyTimeout = setTimeout(() => {
        if (videoLoading.value) {
          console.warn('Safety timeout: clearing loading state after 15 seconds')
          videoLoading.value = false
        }
      }, 15000)
    }

  } catch (error) {
    console.error('Setup video error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    videoError.value = `Erreur lors de la configuration vidéo: ${errorMessage}`
    videoLoading.value = false
  }
}

// Smart retry system that considers error types
function isRecoverableError(error: any): boolean {
  if (!error) return false

  // Get error code/message
  const errorCode = error.code || error.status || 0
  const errorMessage = (error.message || '').toLowerCase()

  // Network errors are recoverable
  if (errorCode >= 500 || errorMessage.includes('network') || errorMessage.includes('timeout') ||
      errorMessage.includes('connection') || errorMessage.includes('fetch')) {
    return true
  }

  // HLS specific recoverable errors
  if (errorMessage.includes('frag') || errorMessage.includes('segment') ||
      errorMessage.includes('buffer') || errorMessage.includes('manifest')) {
    return true
  }

  // CORS or temporary server issues
  if (errorCode === 0 || errorMessage.includes('cors') || errorMessage.includes('blocked')) {
    return true
  }

  return false
}

function handleVideoError(error: any, errorType: string = 'unknown') {
  console.error(`Video error (${errorType}):`, error)

  // Clear any pending retry
  if (retryTimeout) {
    clearTimeout(retryTimeout)
    retryTimeout = null
  }

  // Determine if this is a new error type
  const isNewErrorType = lastErrorType !== errorType
  if (isNewErrorType) {
    lastErrorType = errorType
    currentSourceRetries = 0
  }

  const recoverable = isRecoverableError(error)

  if (recoverable && currentSourceRetries < MAX_RETRIES_PER_SOURCE) {
    // Retry the same source
    currentSourceRetries++

    videoError.value = `Nouvelle tentative ${currentSourceRetries}/${MAX_RETRIES_PER_SOURCE}...`
    videoLoading.value = true

    retryTimeout = setTimeout(() => {
      setupVideo()
    }, 2000 * currentSourceRetries) // Exponential backoff

  } else {
    // Either not recoverable or max retries reached - try next source
    tryNextSource()
  }
}

function tryNextSource() {
  if (resolvedList.value.length <= 1) {
    videoError.value = 'Aucune source alternative disponible'
    return
  }

  // Track how many sources we've tried to avoid infinite loops
  const startIndex = currentSourceIndex.value
  currentSourceIndex.value = (currentSourceIndex.value + 1) % resolvedList.value.length

  // If we've cycled through all sources, stop trying
  if (currentSourceIndex.value === startIndex) {
    videoError.value = 'Toutes les sources vidéo ont échoué'
    return
  }

  const nextSource = resolvedList.value[currentSourceIndex.value]

  if (!nextSource) return

  // Reset retry counters when switching sources
  setupAttempts = 0
  currentSourceRetries = 0
  lastErrorType = ''

  playUrl.value = nextSource.proxiedUrl || nextSource.url
  videoError.value = '' // Clear previous error
  videoLoading.value = true // Set loading when switching
  setupVideo()
}

function switchToSource(source: { type: string; url: string; proxiedUrl: string; quality?: string }) {
  const index = resolvedList.value.findIndex(s => s.url === source.url)
  if (index !== -1) {
    currentSourceIndex.value = index
  }
  // Reset attempts and retry counters when switching sources
  setupAttempts = 0
  currentSourceRetries = 0
  lastErrorType = ''
  playUrl.value = source.proxiedUrl || source.url
  videoError.value = ''
  videoLoading.value = true // Set loading when switching
  setupVideo()
}

// Episode selector functions
async function loadAnimeMetadata() {
  try {
    const response = await $fetch(`/api/anime/${id.value}`) as any
    animeTitle.value = response?.title || response?.name || `Anime ${id.value}`

    // Extract dynamic language flags from the response
    if (response?.languageFlags) {
      dynamicLanguageFlags.value = response.languageFlags
    }
  } catch (error) {
    console.error('Failed to load anime metadata:', error)
    animeTitle.value = `Anime ${id.value}`
  }
}

async function loadEpisodesList() {
  if (episodesList.value.length > 0) return // Already loaded

  loadingEpisodes.value = true
  try {
    const url = `/api/anime/episodes/${id.value}/${season.value}/${lang.value}`
    const response = await $fetch(url) as any
    episodesList.value = (response?.episodes || []) as Array<{ episode: number; title?: string; url: string; urls?: string[] }>

    // Update current episode title
    const currentEp = episodesList.value.find(ep => ep.episode === episodeNum.value)
    currentEpisodeTitle.value = currentEp?.title || formattedEpisodeDisplay.value

    // Scroll will be handled by the watcher below
  } catch (error) {
    console.error('Failed to load episodes:', error)
    episodesList.value = []
    currentEpisodeTitle.value = formattedEpisodeDisplay.value
  } finally {
    loadingEpisodes.value = false
  }
}

function selectEpisode(episodeNumber: number) {
  if (episodeNumber === episodeNum.value) return // Already on this episode

  showEpisodes.value = false
  navigateTo({
    path: `/watch/${id.value}/${season.value}/${lang.value}/${episodeNumber}`,
    replace: true
  })
}

function scrollToCurrentEpisode() {
  if (!episodesScrollContainer.value) return

  // Find the current episode element
  const currentEpisodeElement = episodesScrollContainer.value.querySelector(`[data-episode="${episodeNum.value}"]`) as HTMLElement
  if (currentEpisodeElement) {
    // Scroll the element into view with smooth behavior
    currentEpisodeElement.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    })
  }
}

function toggleEpisodesPanel() {
  showEpisodes.value = !showEpisodes.value
  if (showEpisodes.value && episodesList.value.length === 0 && !loadingEpisodes.value) {
    loadEpisodesList()
  } else if (showEpisodes.value && episodesList.value.length > 0) {
    // Episodes already loaded, scroll immediately after DOM update
    nextTick(() => {
      scrollToCurrentEpisode()
    })
  }
}

function downloadVideo() {
  if (!playUrl.value) return

  // Create filename: [Gazes] Anime Title - S01E01.mp4
  const filename = `[Gazes] ${animeTitle.value} - S${season.value}E${episodeNum.value.toString().padStart(2, '0')}.mp4`
  
  // Create temporary link
  const link = document.createElement('a')
  link.href = playUrl.value
  link.download = filename
  link.target = '_blank' // Fallback for cross-origin
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  
  // Show feedback
  notice.value = 'Téléchargement lancé...'
  setTimeout(() => {
    notice.value = ''
  }, 2000)
}



onBeforeUnmount(() => {
  destroyPlayer()
  stopProgressUpdates() // Ensure animation frame is stopped
  removeVideoEventListeners(videoRef.value)

  // Clear any pending timeouts
  if (resolveTimeout) {
    clearTimeout(resolveTimeout)
    resolveTimeout = null
  }
  if (retryTimeout) {
    clearTimeout(retryTimeout)
    retryTimeout = null
  }

  // Clear skip timeout
  if (skipTimeout.value) {
    clearTimeout(skipTimeout.value)
    skipTimeout.value = null
  }

  // Reset cursor visibility
  const playerContainer = document.querySelector('.fixed.inset-0.bg-black.z-50') as HTMLElement
  const videoElement = videoRef.value as HTMLElement
  if (playerContainer) {
    playerContainer.style.cursor = 'default'
  }
  if (videoElement) {
    videoElement.style.cursor = 'pointer'
  }
  document.body.style.cursor = 'default'

  // Remove global event listeners to prevent memory leaks
  if (typeof document !== 'undefined') {
    document.removeEventListener('keydown', handleKeyPress)
    document.removeEventListener('fullscreenchange', handleFullscreenChange)
    document.removeEventListener('enterpictureinpicture', handlePictureInPictureChange)
    document.removeEventListener('leavepictureinpicture', handlePictureInPictureChange)
  }
})

async function fetchEpisodesFor(targetLang: 'vostfr' | 'vf' | 'va' | 'var' | 'vkr' | 'vcn' | 'vqc' | 'vf1' | 'vf2' | 'vj', maxRetries: number = 2): Promise<Array<{ episode: number; title?: string; url: string; urls?: string[] }>> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await $fetch(`/api/anime/episodes/${id.value}/${season.value}/${targetLang}`) as any
      const episodes = (response?.episodes || []) as Array<{ episode: number; title?: string; url: string; urls?: string[] }>

      // Validate that we got actual episodes with URLs
      if (episodes.length > 0 && episodes.some(ep => ep.urls && ep.urls.length > 0)) {
        return episodes
      } else {
        console.warn(`⚠️ Language ${targetLang} returned no valid episodes`)
        return [] // Return empty array instead of throwing
      }
    } catch (error: any) {
      console.warn(`Episode fetch attempt ${attempt}/${maxRetries} failed for ${targetLang}:`, error?.message || error)

      // If this is the last attempt, return empty array instead of throwing
      if (attempt === maxRetries) {
        console.warn(`❌ All attempts failed for ${targetLang}, marking as unavailable`)
        return []
      }

      // Wait before retrying (shorter delay for faster failure recovery)
      const delay = Math.min(500 * Math.pow(2, attempt - 1), 2000)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  // This should never be reached, but TypeScript needs it
  return []
}



// New clean language switching logic
async function switchLanguage(targetLang: string) {
  if (targetLang === lang.value) return // Already on this language

  console.log(`🔄 Switching language from ${lang.value} to ${targetLang}`)

  // Phase 1: Preparation - Check if target language is available
  const targetLangData = availableLanguages.value.find(l => l.code === targetLang)
  if (!targetLangData?.available) {
    console.warn(`❌ Language ${targetLang} not available for this episode`)
    notice.value = `Langue ${targetLang.toUpperCase()} indisponible pour cet épisode`
    return
  }

  // Phase 2: Pre-resolution - Check if sources are already resolved
  const cachedSources = resolvedSourcesByLanguage.value[targetLang]
  if (cachedSources && cachedSources.episode === episodeNum.value && cachedSources.season === season.value) {
    // Phase 3: Instant switching - Sources already available, navigate to update URL
    console.log(`✅ Sources already resolved for ${targetLang}, switching instantly`)
    await navigateTo({
      path: `/watch/${id.value}/${season.value}/${targetLang}/${episodeNum.value}`,
      replace: true,
    })
    notice.value = `Basculement en ${targetLang.toUpperCase()}`
    closeLanguageDropdown()
    return
  }

  // Phase 4: Fallback navigation - Navigate to new URL to trigger resolution
  console.log(`🔄 Navigating to ${targetLang} for fresh resolution`)
  await navigateTo({
    path: `/watch/${id.value}/${season.value}/${targetLang}/${episodeNum.value}`,
    replace: true,
  })
  closeLanguageDropdown()
}

function closeLanguageDropdown() {
  showLanguageDropdown.value = false
}

// Helper function to get human-readable language names
function getLanguageName(langCode: string): string {
  const names: Record<string, string> = {
    'vostfr': 'VOSTFR',
    'vf': 'VF',
    'va': 'VA',
    'var': 'VA+',
    'vkr': 'VKR',
    'vcn': 'VCN',
    'vqc': 'VQC',
    'vf1': 'VF1',
    'vf2': 'VF2',
    'vj': 'VJ'
  }
  return names[langCode] || langCode.toUpperCase()
}
async function resolveSourcesImmediately(candidateUrls: string[], targetLang: string) {
  let candidates = candidateUrls
  if (!candidates.length) return

  // Sort candidates by provider reliability (best first) for faster success
  candidates = candidates.sort((a, b) => {
    const getReliability = (url: string) => {
      try {
        const hostname = new URL(url).hostname.toLowerCase()
        if (hostname.includes('vidmoly')) return 10
        if (hostname.includes('streamtape')) return 8
        if (hostname.includes('sibnet')) return 7
        if (hostname.includes('uqload')) return 5
        if (hostname.includes('doodstream')) return 4
        if (hostname.includes('myvi')) return 3
        if (hostname.includes('sendvid')) return 1
        return 0
      } catch {
        return 0
      }
    }
    return getReliability(b) - getReliability(a)
  })

  // Try candidates in parallel and start playback immediately when one works
  const maxCandidates = Math.min(candidates.length, 3)
  const resolvePromises = candidates.slice(0, maxCandidates).map(async (targetUrl, index) => {
    if (!targetUrl) return null

    try {
      const encoder = new TextEncoder()
      const data = encoder.encode(targetUrl)
      const base64 = btoa(String.fromCharCode(...data))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "")

      let referer: string | undefined
      try {
        const u = new URL(targetUrl)
        referer = u.origin + "/"
      } catch {}

      const resolveResponse = await $fetch<any>("/api/player/resolve", {
        params: {
          u64: base64,
          referer,
          ...(debug.value ? { debug: "1" } : {}),
        },
        timeout: 5000, // Increased timeout for better resolution success
      })

      if (resolveResponse?.ok && resolveResponse?.urls?.length > 0) {
        // Immediately start playback with the first working source
        if (!playUrl.value) {
          resolvedList.value = resolveResponse.urls
          resolvedSourcesByLanguage.value[targetLang] = {
            sources: resolveResponse.urls,
            resolvedAt: Date.now(),
            episode: episodeNum.value,
            season: season.value
          }

          currentSourceIndex.value = 0
          const hlsFirst = resolveResponse.urls.find((u: any) => u.type === "hls") || resolveResponse.urls[0]
          if (hlsFirst) {
            playUrl.value = hlsFirst.proxiedUrl || hlsFirst.url
            console.log(`🎬 Started playback immediately with provider ${index + 1}`)
            console.log(`🔗 Using URL: ${hlsFirst.url}`)
            console.log(`🔗 Direct URL: ${hlsFirst.directUrl}`)
            console.log(`🔗 Proxied URL: ${hlsFirst.proxiedUrl}`)
          }
        }

        return resolveResponse.urls
      }
    } catch (error: any) {
      // Continue to next candidate
    }
    return null
  })

  // Wait for all to complete to get the full list
  const results = await Promise.allSettled(resolvePromises)
  const allSources: any[] = []

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      allSources.push(...result.value)
    }
  }

  // Update with all available sources if we got more than what we started with
  if (allSources.length > (resolvedList.value?.length || 0)) {
    // Remove duplicates
    const uniqueSources = new Map<string, any>()
    for (const source of allSources) {
      if (!uniqueSources.has(source.url)) {
        uniqueSources.set(source.url, source)
      }
    }

    const finalSources = Array.from(uniqueSources.values()).sort((a, b) => {
      const reliabilityA = a.provider?.reliability || 0
      const reliabilityB = b.provider?.reliability || 0
      return reliabilityB - reliabilityA
    })

    resolvedList.value = finalSources
    resolvedSourcesByLanguage.value[targetLang] = {
      sources: finalSources,
      resolvedAt: Date.now(),
      episode: episodeNum.value,
      season: season.value
    }
  }

  // If no sources worked at all, show error
  if (!playUrl.value && allSources.length === 0) {
    resolveError.value = "Aucune source vidéo trouvée"
  }
}

async function resolveSourcesForLanguage(targetLang: string, candidateUrls: string[]): Promise<{ type: string; url: string; directUrl: string; proxiedUrl: string; quality?: string }[]> {
  let candidates = candidateUrls
  if (!candidates.length) return []

  // Sort candidates by provider reliability (best first) for faster success
  candidates = candidates.sort((a, b) => {
    const getReliability = (url: string) => {
      try {
        const hostname = new URL(url).hostname.toLowerCase()
        if (hostname.includes('vidmoly')) return 10
        if (hostname.includes('streamtape')) return 8
        if (hostname.includes('sibnet')) return 7
        if (hostname.includes('uqload')) return 5
        if (hostname.includes('doodstream')) return 4
        if (hostname.includes('myvi')) return 3
        if (hostname.includes('sendvid')) return 1
        return 0
      } catch {
        return 0
      }
    }
    return getReliability(b) - getReliability(a)
  })

  // Test up to 3 candidates in parallel for much faster resolution
  const maxCandidates = Math.min(candidates.length, 3)
  const testPromises = candidates.slice(0, maxCandidates).map(async (targetUrl, index) => {
    if (!targetUrl) return null

    try {
      // Resolve the provider URL to actual video stream
      const encoder = new TextEncoder()
      const data = encoder.encode(targetUrl)
      const base64 = btoa(String.fromCharCode(...data))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "")

      let referer: string | undefined
      try {
        const u = new URL(targetUrl)
        referer = u.origin + "/"
      } catch {}

      try {
        const resolveResponse = await $fetch<any>("/api/player/resolve", {
          params: {
            u64: base64,
            referer,
            ...(debug.value ? { debug: "1" } : {}),
          },
          timeout: 5000, // Increased timeout for better resolution success
        })

        if (resolveResponse?.ok && resolveResponse?.urls?.length > 0) {
          return { urls: resolveResponse.urls, index }
        } else {
          const error = resolveResponse?.message || "No URLs found"
          console.warn(`❌ Candidate ${index + 1} failed for ${targetLang}: ${error}`)
          return null
        }
      } catch (resolveError: any) {
        const errorMsg = resolveError?.message || 'Network error during resolution'
        console.warn(`❌ Candidate ${index + 1} resolution error for ${targetLang}: ${errorMsg}`)
        return null
      }
    } catch (error: any) {
      const errorMsg = error?.message || 'Network error'
      console.warn(`❌ Candidate ${index + 1} error for ${targetLang}: ${errorMsg}`)
      return null
    }
  })

  // Wait for all parallel requests to complete
  const results = await Promise.allSettled(testPromises)

  // Find the first successful result (preferring higher reliability)
  let resolvedUrls: any[] = []
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value?.urls) {
      resolvedUrls = result.value.urls
      break // Use the first successful result
    }
  }

  if (resolvedUrls.length === 0) {
    // If no parallel requests succeeded, try one more time sequentially with longer timeout
    console.warn(`⚠️ All parallel requests failed for ${targetLang}, trying sequential fallback...`)
    for (let i = 0; i < maxCandidates; i++) {
      const targetUrl = candidates[i]
      if (!targetUrl) continue

      try {
        const encoder = new TextEncoder()
        const data = encoder.encode(targetUrl)
        const base64 = btoa(String.fromCharCode(...data))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "")

        let referer: string | undefined
        try {
          const u = new URL(targetUrl)
          referer = u.origin + "/"
        } catch {}

        const resolveResponse = await $fetch<any>("/api/player/resolve", {
          params: {
            u64: base64,
            referer,
            ...(debug.value ? { debug: "1" } : {}),
          },
          timeout: 3000, // Longer timeout for fallback
        })

        if (resolveResponse?.ok && resolveResponse?.urls?.length > 0) {
          resolvedUrls = resolveResponse.urls
          break
        }
      } catch (error: any) {
        // Continue to next candidate
      }
    }
  }

  if (resolvedUrls.length === 0) {
    const errors = results
      .filter(r => r.status === 'rejected')
      .map(r => (r as PromiseRejectedResult).reason?.message || 'Unknown error')
    throw new Error(`Toutes les sources ont échoué: ${errors.join(', ')}`)
  }

  return resolvedUrls
}

async function resolveEpisode() {
  resolving.value = true
  resolveError.value = ''
  notice.value = ''
  playUrl.value = ''
  resolvedList.value = []

  // Reset setup attempts and retry counters for new episode
  setupAttempts = 0
  currentSourceRetries = 0
  lastErrorType = ''


  try {
    // Check all languages for the current episode availability
    const allLanguages: ('vostfr' | 'vf' | 'va' | 'var' | 'vkr' | 'vcn' | 'vqc' | 'vf1' | 'vf2' | 'vj')[] =
      ['vostfr', 'vf', 'va', 'var', 'vkr', 'vcn', 'vqc', 'vf1', 'vf2', 'vj']

    // Start fetching for all languages to check episode availability
    const languagePromises = allLanguages.map(langCode =>
      fetchEpisodesFor(langCode, 1).then(episodes => ({
        lang: langCode,
        episodes,
        hasCurrentEpisode: episodes.some(ep => Number(ep.episode) === episodeNum.value)
      })).catch(() => ({ lang: langCode, episodes: [], hasCurrentEpisode: false }))
    )

    const languageResults = await Promise.all(languagePromises)

    // Update available languages based on whether they have the current episode
    availableLanguages.value = languageResults.map(({ lang, hasCurrentEpisode }) => ({
      code: lang,
      name: getLanguageName(lang),
      available: hasCurrentEpisode
    }))

    // Try requested language first
    const currentLangResult = languageResults.find(r => r.lang === lang.value)
    let ep = currentLangResult?.episodes.find(e => Number(e.episode) === episodeNum.value)

    // If not found in requested language, check other available languages
    if (!ep) {
      const availableLangResults = languageResults.filter(r => r.hasCurrentEpisode && r.lang !== lang.value)

      for (const { lang: altLang, episodes: altEpisodes } of availableLangResults) {
        const altEp = altEpisodes.find((e: any) => Number(e.episode) === episodeNum.value)
        if (altEp) {
          notice.value = `Langue ${lang.value.toUpperCase()} indisponible. Basculement en ${altLang.toUpperCase()}.`
          await navigateTo({
            path: `/watch/${id.value}/${season.value}/${altLang}/${episodeNum.value}`,
            query: { fallback: '1' },
            replace: true,
          })
          return
        }
      }

    }

    if (!ep) {
      resolveError.value = `Épisode ${episodeNum.value.toString().padStart(2, '0')} introuvable pour ${lang.value.toUpperCase()}`
      return
    }

    // Resolve sources for the current language first (for immediate playback)
    const epUrls = ep?.urls?.length ? ep.urls : ep?.url ? [ep.url] : []
    if (!epUrls.length) {
      resolveError.value = 'Aucun lien pour cet épisode'
      return
    }

    // Start resolving sources immediately and begin playback as soon as one works
    resolveSourcesImmediately(epUrls, lang.value)
      .then(() => {
        console.log('✅ Resolution completed successfully')
      })
      .catch(error => {
        console.error('❌ Failed to resolve sources:', error)

        // Fallback: Use original URLs through proxy only (last resort)
        console.warn('⚠️ Using original URLs as fallback sources (proxy only)')
      const fallbackSources = epUrls.map(url => ({
        type: 'unknown',
        url: url,
        directUrl: '', // Don't try embed URLs as direct URLs - they are HTML pages!
        proxiedUrl: `/api/proxy?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(url)}&origin=${encodeURIComponent(new URL(url).origin)}&rewrite=1`,
        quality: undefined,
        provider: null
      }))

      // Only use fallback if we don't already have resolved sources
      if (fallbackSources.length > 0 && !playUrl.value && resolvedList.value.length === 0) {
        resolvedList.value = fallbackSources
        currentSourceIndex.value = 0
        playUrl.value = fallbackSources[0].proxiedUrl
        console.log('🔄 Fallback: Started with original URLs through proxy')
      } else if (!playUrl.value) {
        resolveError.value = 'Erreur de résolution des sources'
      }
    })

    // Pre-resolve sources for other available languages in background
    const availableLangs = languageResults.filter(r => r.hasCurrentEpisode && r.lang !== lang.value)
    for (const { lang: otherLang, episodes: otherEpisodes } of availableLangs) {
      const otherEp = otherEpisodes.find((e: any) => Number(e.episode) === episodeNum.value)
      if (otherEp?.urls?.length) {
        // Mark as resolving
        resolvingLanguages.value.add(otherLang)

        // Resolve in background without awaiting
        resolveSourcesForLanguage(otherLang, otherEp.urls).then((sources: { type: string; url: string; directUrl: string; proxiedUrl: string; quality?: string }[]) => {
          resolvedSourcesByLanguage.value[otherLang] = {
            sources,
            resolvedAt: Date.now(),
            episode: episodeNum.value,
            season: season.value
          }
          resolvingLanguages.value.delete(otherLang)
        }).catch((error: any) => {
          console.warn(`Failed to pre-resolve sources for ${otherLang}:`, error)
          resolvingLanguages.value.delete(otherLang)
        })
      }
    }
  } catch (e: any) {
    resolveError.value = e?.message || 'Erreur de résolution'
  } finally {
    resolving.value = false
  }
}

watch([showPlayer, playUrl], async () => {
  if (!showPlayer.value) { 
    destroyPlayer()
    return 
  }
  
  // Only setup video if we have a valid playUrl
  if (playUrl.value && playUrl.value.trim()) {
    await nextTick()
    setupVideo()
  }
}, { immediate: false })

// Preload next episode URLs for faster navigation
async function preloadNextEpisode() {
  try {
    const nextEpisodeNum = episodeNum.value + 1
    const nextEpisodeUrl = `/api/anime/episodes/${id.value}/${season.value}/${lang.value}`

    // Prefetch the episodes list for next episode
    const response = await $fetch(nextEpisodeUrl) as any
    const episodes = response?.episodes || []
    const nextEpisode = episodes.find((ep: any) => ep.episode === nextEpisodeNum)

    if (nextEpisode && nextEpisode.urls && nextEpisode.urls.length > 0) {
      // Pre-resolve the next episode URLs in background without blocking UI
      console.log(`🔄 Preloading next episode ${nextEpisodeNum}...`)
      resolveEpisodeInBackground(id.value, season.value, lang.value, nextEpisodeNum, nextEpisode.urls)
        .then(() => console.log(`✅ Next episode ${nextEpisodeNum} preloaded`))
        .catch(error => console.debug('Background preload failed:', error))
    }
  } catch (error) {
    console.debug('Failed to preload next episode:', error)
  }
}

// Background episode resolution for preloading
async function resolveEpisodeInBackground(animeId: string, season: string, lang: string, episodeNum: number, candidateUrls: string[]) {

  // Sort candidates by provider reliability
  const candidates = candidateUrls.sort((a, b) => {
    const getReliability = (url: string) => {
      try {
        const hostname = new URL(url).hostname.toLowerCase()
        if (hostname.includes('vidmoly')) return 10
        if (hostname.includes('streamtape')) return 8
        if (hostname.includes('sibnet')) return 7
        if (hostname.includes('uqload')) return 5
        if (hostname.includes('doodstream')) return 4
        if (hostname.includes('myvi')) return 3
        if (hostname.includes('sendvid')) return 1
        return 0
      } catch {
        return 0
      }
    }
    return getReliability(b) - getReliability(a)
  })

  // Try candidates in parallel (same logic as main resolveEpisode)
  const resolvePromises = candidates.slice(0, 3).map(async (targetUrl) => {
    if (!targetUrl) return null

    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(targetUrl);
      const base64 = btoa(String.fromCharCode(...data))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      let referer: string | undefined;
      try {
        const u = new URL(targetUrl);
        referer = u.origin + "/";
      } catch {}

      const resolveResponse = await $fetch<any>("/api/player/resolve", {
        params: {
          u64: base64,
          referer,
        },
        timeout: 8000, // Longer timeout for background loading
      });

      if (resolveResponse?.ok && resolveResponse?.urls?.length > 0) {
        return resolveResponse.urls
      }
    } catch (error) {
      // Silent fail for background loading
    }
    return null
  })

  try {
    const results = await Promise.allSettled(resolvePromises)
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        // Process URLs the same way as main resolution
        const extractedUrls = result.value
        const uniqueUrls = new Map<string, any>()
        for (const urlData of extractedUrls) {
          if (!uniqueUrls.has(urlData.url)) {
            const providerInfo = getProviderInfo(urlData.url)
            uniqueUrls.set(urlData.url, {
              type: urlData.type === 'hls' ? 'hls' : urlData.type === 'mp4' ? 'mp4' : 'unknown',
              url: urlData.url,
              proxiedUrl: `/api/proxy?url=${encodeURIComponent(urlData.url)}&rewrite=1`,
              quality: urlData.quality,
              provider: providerInfo ? {
                hostname: providerInfo.hostname,
                reliability: providerInfo.reliability,
                description: providerInfo.description
              } : null
            })
          }
        }

        const finalUrls = Array.from(uniqueUrls.values()).sort((a, b) => {
          const reliabilityA = a.provider?.reliability || 0
          const reliabilityB = b.provider?.reliability || 0
          return reliabilityB - reliabilityA
        })

        if (finalUrls.length > 0) {
        }
        break
      }
    }
  } catch (error) {
    console.debug('Background resolution failed:', error)
  }
}

  // Initial setup after component mounts
  onMounted(async () => {
    // Small delay to ensure route params are fully reactive
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 100))

    // Start ALL API calls in parallel for maximum speed
    const [
      progressResult,
      metadataResult
    ] = await Promise.allSettled([
      loadSavedProgress().catch(() => null),
      loadAnimeMetadata().catch(() => null)
    ])

    // Start resolving episode immediately (most critical)
    const resolvePromise = resolveEpisode()

    // Wait only for episode resolution
    await resolvePromise

    // Preload next episode in background (non-blocking)
    preloadNextEpisode().catch(() => null)

  // Ensure video element events are set up immediately
  await nextTick()
  handleVideoEvents()

  // Sync initial state with video element
  const el = videoRef.value
  if (el) {
    isPlaying.value = !(el as HTMLVideoElement).paused
    currentTime.value = (el as HTMLVideoElement).currentTime
    duration.value = (el as HTMLVideoElement).duration || 0
    volume.value = (el as HTMLVideoElement).volume
    isMuted.value = (el as HTMLVideoElement).muted
  }

  // Load saved volume settings
  loadVolumeSettings()

  // setupVideo() will be called automatically by the watch when playUrl is set

  // Global event listeners
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', handleKeyPress)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('enterpictureinpicture', handlePictureInPictureChange)
    document.addEventListener('leavepictureinpicture', handlePictureInPictureChange)
    document.addEventListener('click', () => {
      closeSpeedDropdown()
      closeQualityDropdown()
    })
  }

  // Save progress before unloading the page
  const handleBeforeUnload = () => {
    if (duration.value > 0) {
      saveProgress(currentTime.value, duration.value)
    }
  }
  window.addEventListener('beforeunload', handleBeforeUnload)

  // Clean up on unmount
  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', handleBeforeUnload)
  })
})

// Re-resolve when params change (e.g., after fallback navigation) - debounced to prevent rapid calls
let resolveTimeout: ReturnType<typeof setTimeout> | null = null
let lastResolvedParams = ''
watch([season, lang, episodeNum], () => {
  if (resolveTimeout) clearTimeout(resolveTimeout)
  resolveTimeout = setTimeout(async () => {
    const currentParams = `${id.value}-${season.value}-${lang.value}-${episodeNum.value}`
    // Only re-resolve if params actually changed
    if (currentParams !== lastResolvedParams) {
      lastResolvedParams = currentParams

      // Reset dismissed skips when changing episodes
      dismissedSkips.value.clear()

      // Reload volume settings when navigating to new episode
      loadVolumeSettings()

      // When switching episodes or languages, we need to re-check language availability
      // for the new episode, so don't reset availableLanguages here - let resolveEpisode handle it
      resolveEpisode()
      // Skip times will be loaded automatically when video metadata loads
    }
  }, 100) // Small debounce to handle rapid param changes
})

// Update episode title when episode changes or episodes list loads - optimized to avoid unnecessary updates
watch([episodeNum, episodesList], () => {
  const currentEp = episodesList.value.find(ep => ep.episode === episodeNum.value)
  const newTitle = currentEp?.title || formattedEpisodeDisplay.value
  if (newTitle !== currentEpisodeTitle.value) {
    currentEpisodeTitle.value = newTitle
  }
}, { immediate: true })

// Watch for when both panel is visible and episodes are loaded to scroll to current episode
watch([showEpisodes, episodesList, loadingEpisodes], () => {
  if (showEpisodes.value && episodesList.value.length > 0 && !loadingEpisodes.value) {
    // Both panel is visible and episodes are loaded, scroll to current episode
    nextTick(() => {
      scrollToCurrentEpisode()
    })
  }
}, { immediate: true })
</script>

<template>
  <div
    class="fixed inset-0 bg-black z-50 flex flex-col h-screen overflow-hidden"
    @mousemove="handleMouseMove"
    @touchstart="handleMouseMove"
  >
    <!-- Overlay: Top Nav, Loading, Error -->
    <VideoOverlay
      :title="animeTitle || `Anime ${id}`"
      :subtitle="`${currentEpisodeTitle || formattedEpisodeDisplay} • ${formattedSeasonDisplay} • ${lang.toUpperCase()}`"
      :back-link="`/anime/${id}`"
      :notice="notice"
      :resolving="resolving"
      :error="resolveError"
      :loading="videoLoading"
      :buffering="isBuffering"
      :buffer-progress="bufferProgress"
      :show-controls="showControls"
      @retry="resolveEpisode"
    />

    <!-- Main video container -->
    <div class="flex-1 relative bg-black min-h-0" @click="showEpisodes = false">
      <video
        ref="videoRef"
        class="w-full h-full object-contain cursor-pointer"
        preload="metadata"
        autoplay
        crossorigin="anonymous"
        @click="handleVideoClick"
        @dblclick="handleVideoDoubleClick"
      >
        Votre navigateur ne supporte pas la lecture vidéo.
      </video>

      <!-- Skip Buttons Overlay -->
      <div v-if="showSkipButtons" class="absolute bottom-32 right-8 z-30 flex flex-col gap-2">
        <!-- Skip Intro -->
        <button
          v-if="currentSkipType === 'op'"
          @click="skipOp"
          class="bg-white text-black px-6 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-zinc-200 transition-colors shadow-lg animate-slide-in-right group"
        >
          <span>Passer l'intro</span>
          <Icon name="heroicons:forward" class="w-5 h-5 group-hover:translate-x-1 transition-transform" />
        </button>
        <!-- Skip Outro -->
        <button
          v-if="currentSkipType === 'ed'"
          @click="skipEd"
          class="bg-white text-black px-6 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-zinc-200 transition-colors shadow-lg animate-slide-in-right group"
        >
          <span>Passer l'outro</span>
          <Icon name="heroicons:forward" class="w-5 h-5 group-hover:translate-x-1 transition-transform" />
        </button>
      </div>

       <!-- Next Episode Auto-Play Overlay -->
      <div 
        v-if="showNextEpisodeOverlay" 
        class="absolute bottom-32 right-8 z-30 bg-zinc-900/90 backdrop-blur-md border border-zinc-700 p-4 rounded-xl shadow-2xl animate-slide-in-right max-w-sm"
      >
        <div class="flex items-start gap-4">
          <div class="flex-1">
            <h4 class="text-zinc-400 text-xs uppercase font-bold tracking-wider mb-1">Prochain épisode</h4>
            <div class="text-white font-medium mb-2">Épisode {{ episodeNum + 1 }}</div>
            <div class="h-1 w-full bg-zinc-700 rounded-full overflow-hidden">
              <div 
                class="h-full bg-violet-600 transition-all duration-1000 ease-linear"
                :style="{ width: `${(nextEpisodeCountdown / 10) * 100}%` }"
              ></div>
            </div>
          </div>
          <button 
            @click="playNextEpisode"
            class="bg-white text-black p-3 rounded-full hover:bg-zinc-200 transition-colors"
          >
            <Icon name="heroicons:play" class="w-6 h-6" />
          </button>
          <button 
            @click="cancelNextEpisodeCountdown" 
            class="text-zinc-400 hover:text-white mt-1"
          >
            <Icon name="heroicons:x-mark" class="w-5 h-5" />
          </button>
        </div>
      </div>

       <!-- Touch Seek Feedback -->
       <div 
         v-if="touchSeekOverlay"
         class="absolute inset-0 flex items-center justify-center pointer-events-none z-40 bg-black/20"
       >
         <div class="flex flex-col items-center justify-center bg-black/60 backdrop-blur-md rounded-full w-24 h-24 text-white">
            <Icon :name="touchSeekTime > 0 ? 'heroicons:forward' : 'heroicons:backward'" class="w-8 h-8 mb-1" />
            <span class="text-xs font-bold">{{ touchSeekTime > 0 ? '+' : '' }}{{ touchSeekTime }}s</span>
         </div>
       </div>

    </div>

    <!-- Episode Selector -->
    <EpisodeSelector
      :show="showEpisodes"
      :episodes="episodesList"
      :loading="loadingEpisodes"
      :current-episode="episodeNum"
      :season="season"
      :season-display="formattedSeasonDisplay"
      :lang="lang"
      @close="showEpisodes = false"
      @select="selectEpisode"
    />

    <!-- Video Controls -->
    <VideoControls
      :show="showControls"
      :is-playing="isPlaying"
      :is-muted="isMuted"
      :volume="volume"
      :current-time="currentTime"
      :duration="duration"
      :buffered="buffered"
      :is-seeking="isSeeking"
      :playback-speed="playbackSpeed"
      :is-fullscreen="isFullscreen"
      :sources="resolvedList"
      :current-source-url="playUrl"
      @toggle-play="togglePlay"
      @seek-by="seekBy"
      @toggle-mute="toggleMute"
      @set-volume="setVolume"
      @seek-to="seek"
      @set-speed="setPlaybackSpeed"
      @select-quality="selectQuality"
      @toggle-fullscreen="toggleFullscreen"
      @toggle-episodes="toggleEpisodesPanel"
      @download="downloadVideo"
      @interaction="showControlsTemporarily"
    />

  </div>
</template>

