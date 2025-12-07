<template>
    <nav
        :class="[
            'p-4 lg:p-10 w-full z-[99] bg-transparent',
            (isAnimePage || isCataloguePage) ? 'relative' : 'absolute top-0 left-0',
        ]"
    >
        <div class="flex w-full items-center py-3 px-0 lg:px-9 gap-4 lg:gap-10 lg:pl-5 justify-between">
            
            <!-- Logo / Brand / Search (Mobile & Desktop) -->
            <div class="flex items-center gap-4">
                <!-- Mobile Menu Button -->
                <button 
                    @click="isMobileMenuOpen = true" 
                    class="lg:hidden p-2 text-white hover:text-violet-400 transition-colors"
                    aria-label="Open menu"
                >
                    <Icon name="heroicons:bars-3" class="w-6 h-6" />
                </button>

                <!-- Search Icon (Visible on all, adapted spacing) -->
                <NuxtLink to="/catalogue" :class="{ 'text-violet-400': isCataloguePage }" class="-mb-1 text-xl">
                    <ClientOnly>
                        <Icon name="heroicons-outline:search" />
                    </ClientOnly>
                </NuxtLink>
            </div>

            <!-- Desktop Navigation Links -->
            <ul class="hidden lg:flex items-center gap-10">
                <li>
                    <NuxtLink to="/" :class="{ 'text-violet-400': isHome }">Accueil</NuxtLink>
                </li>
                <li>
                    <NuxtLink to="/series" :class="{ 'text-violet-400': isSeries }">Séries</NuxtLink>
                </li>
                <li>
                    <NuxtLink to="/movies" :class="{ 'text-violet-400': isMovies }">Films</NuxtLink>
                </li>
            </ul>

            <!-- Authentication Section (Desktop) -->
            <div class="hidden lg:flex items-center gap-4">
                <ClientOnly>
                    <template v-if="pending">
                        <div class="w-8 h-8 bg-zinc-800 rounded-full animate-pulse"></div>
                    </template>
                    <template v-else-if="user">
                        <UserMenu :user="user" @logout="handleLogout" />
                    </template>
                    <template v-else>
                        <div class="flex items-center gap-2">
                            <NuxtLink
                                to="/login"
                                class="btn secondary text-sm"
                            >
                                Se connecter
                            </NuxtLink>
                            <NuxtLink
                                to="/register"
                                class="btn primary text-sm"
                            >
                                S'inscrire
                            </NuxtLink>
                        </div>
                    </template>
                </ClientOnly>
            </div>

            <!-- Mobile User Avatar (Visible on Mobile if logged in) -->
            <div class="lg:hidden" v-if="user && !pending">
                 <UserMenu :user="user" @logout="handleLogout" />
            </div>
             <div class="lg:hidden" v-else-if="!pending">
                <!-- Placeholder to balance flex layout if needed, or simple 'Connect' link icon if desired. 
                     For now strict design: Login is in menu. -->
            </div>
        </div>

        <!-- Mobile Menu Overlay -->
        <Teleport to="body">
            <Transition
                enter-active-class="transition ease-out duration-200"
                enter-from-class="opacity-0 -translate-x-full"
                enter-to-class="opacity-100 translate-x-0"
                leave-active-class="transition ease-in duration-150"
                leave-from-class="opacity-100 translate-x-0"
                leave-to-class="opacity-0 -translate-x-full"
            >
                <div 
                    v-if="isMobileMenuOpen" 
                    class="fixed inset-0 z-[100] bg-zinc-950/95 backdrop-blur-md flex flex-col p-6 lg:hidden"
                >
                    <!-- Close Button -->
                    <div class="flex justify-end mb-8">
                        <button 
                            @click="isMobileMenuOpen = false" 
                            class="p-2 text-zinc-400 hover:text-white"
                            aria-label="Close menu"
                        >
                            <Icon name="heroicons:x-mark" class="w-8 h-8" />
                        </button>
                    </div>

                    <!-- Mobile Nav Links -->
                    <nav class="flex flex-col gap-6 text-xl font-medium text-center">
                        <NuxtLink 
                            to="/" 
                            @click="isMobileMenuOpen = false"
                            :class="isHome ? 'text-violet-400' : 'text-zinc-200'"
                        >
                            Accueil
                        </NuxtLink>
                        <NuxtLink 
                            to="/series" 
                            @click="isMobileMenuOpen = false"
                            :class="isSeries ? 'text-violet-400' : 'text-zinc-200'"
                        >
                            Séries
                        </NuxtLink>
                        <NuxtLink 
                            to="/movies" 
                            @click="isMobileMenuOpen = false"
                            :class="isMovies ? 'text-violet-400' : 'text-zinc-200'"
                        >
                            Films
                        </NuxtLink>
                        
                        <div class="w-12 h-px bg-zinc-800 mx-auto my-2"></div>

                        <!-- Mobile Auth Buttons (if not logged in) -->
                         <ClientOnly>
                             <template v-if="!user && !pending">
                                <NuxtLink
                                    to="/login"
                                    @click="isMobileMenuOpen = false"
                                    class="text-zinc-300 hover:text-white"
                                >
                                    Se connecter
                                </NuxtLink>
                                <NuxtLink
                                    to="/register"
                                    @click="isMobileMenuOpen = false"
                                    class="btn primary w-full max-w-xs mx-auto mt-2"
                                >
                                    S'inscrire
                                </NuxtLink>
                            </template>
                         </ClientOnly>
                    </nav>
                </div>
            </Transition>
        </Teleport>
    </nav>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { useAuth } from '~/composables/useAuth'

const route = useRoute();
const isAnimePage = computed(() => route.path.startsWith("/anime/"));
const isCataloguePage = computed(() => route.path === "/catalogue");

const isHome = computed(() => route.path === "/");
const isSeries = computed(() => route.path === "/series");
const isMovies = computed(() => route.path === "/movies");

const { user, pending, checkAuth } = useAuth()

// Mobile Menu State
const isMobileMenuOpen = ref(false);

// Close menu on route change (extra safety)
watch(() => route.path, () => {
    isMobileMenuOpen.value = false;
});

const handleLogout = () => {
  // The logout is handled in UserMenu component
  // This is just for any additional cleanup if needed
}

onMounted(() => {
  checkAuth()
})
</script>
