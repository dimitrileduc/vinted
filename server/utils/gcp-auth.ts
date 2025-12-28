import { GoogleGenerativeAI } from '@google/generative-ai'
import { PredictionServiceClient, helpers } from '@google-cloud/aiplatform'

// Gemini 2.0 Flash client for mask generation
let geminiClient: GoogleGenerativeAI | null = null

export function getGeminiClient(): GoogleGenerativeAI {
  if (!geminiClient) {
    const apiKey = process.env.GOOGLE_API_KEY
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY is not set in environment variables')
    }
    geminiClient = new GoogleGenerativeAI(apiKey)
  }
  return geminiClient
}

// Vertex AI client for Imagen 3 inpainting
let vertexClient: PredictionServiceClient | null = null

export function getVertexClient(): PredictionServiceClient {
  if (!vertexClient) {
    const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS
    if (!credentials) {
      throw new Error('GOOGLE_APPLICATION_CREDENTIALS is not set')
    }
    vertexClient = new PredictionServiceClient({
      keyFilename: credentials
    })
  }
  return vertexClient
}

// GCP project configuration
export function getGcpConfig() {
  const projectId = process.env.GCP_PROJECT_ID
  const location = process.env.GCP_LOCATION || 'us-central1'

  if (!projectId) {
    throw new Error('GCP_PROJECT_ID is not set in environment variables')
  }

  return {
    projectId,
    location,
    imagenEndpoint: `projects/${projectId}/locations/${location}/publishers/google/models/imagen-3.0-capability-001`
  }
}

export { helpers as vertexHelpers }
