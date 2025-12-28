// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: [],

  // Runtime config - valeurs par défaut vides, surchargées par NUXT_* env vars
  runtimeConfig: {
    // Private keys (server-only)
    // NUXT_GOOGLE_API_KEY → googleApiKey
    // NUXT_GCP_PROJECT_ID → gcpProjectId
    // NUXT_GCP_LOCATION → gcpLocation
    googleApiKey: '',
    gcpProjectId: '',
    gcpLocation: 'us-central1',

    // Public keys (exposed to client)
    public: {
      apiBase: '/api'
    }
  },

  // TypeScript
  typescript: {
    strict: true
  }
})
