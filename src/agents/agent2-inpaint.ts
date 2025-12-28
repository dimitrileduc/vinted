import { PredictionServiceClient, helpers } from '@google-cloud/aiplatform'
import { VertexAI } from '@google-cloud/vertexai'
import type { InpaintResult } from '../types/pipeline'

const DEFAULT_PROMPT = "Warm honey-toned herringbone parquet floor catching soft afternoon light, cream plastered walls with subtle texture, cozy lived-in Parisian apartment atmosphere, gentle natural shadows"

// 🧠 Cerveau: Gemini analyse l'image et génère un prompt adapté
async function generateSmartPrompt(
  imageBuffer: Buffer,
  projectId: string,
  location: string
): Promise<string> {
  const vertexAI = new VertexAI({ project: projectId, location })
  const model = vertexAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [
        {
          inlineData: {
            data: imageBuffer.toString('base64'),
            mimeType: 'image/jpeg'
          }
        },
        {
          text: `You are a creative director for Vinted resale photos. Generate a UNIQUE cozy home background.

RULES:
- Do NOT describe the current background - create something NEW
- Be CREATIVE and VARIED - never just "oak parquet + white walls"
- AUTHENTIC home feel (real apartment, not photo studio)
- Match the product style/vibe

FLOOR OPTIONS (pick one, be specific):
Herringbone parquet, whitewashed pine planks, polished concrete, hexagonal terracotta tiles, natural sisal rug on wood, soft sheepskin on floor, rumpled linen bedding, woven jute mat, vintage Persian rug corner

LIGHTING OPTIONS (be evocative):
Golden hour streaming through window, soft overcast afternoon, warm morning sunbeams with shadow patterns, diffused north-facing window, cozy evening ambient glow

STYLE MOODS:
- Streetwear/urban → raw concrete, industrial loft, minimal and edgy
- Luxury/designer → cream marble, Parisian elegance, refined simplicity
- Vintage/retro → aged honey oak, warm amber tones, lived-in charm
- Casual/basics → soft natural textiles, Scandinavian hygge
- Sportswear → bright airy space, clean energetic minimalism

Output 25-35 words describing the complete scene. Be specific, evocative, unique.

Examples:
"Honey-toned herringbone parquet catching golden afternoon light, soft shadows from window blinds, cream plastered walls, cozy Parisian apartment atmosphere with lived-in warmth"
"Raw polished concrete floor in minimalist loft, large industrial windows casting diffused overcast daylight, touches of warm wood, urban Scandinavian aesthetic"
"Soft rumpled cream linen as backdrop, gentle morning light filtering through sheer curtains, intimate cozy bedroom with natural earthy tones"`
        }
      ]
    }]
  })

  const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text
  return text?.trim() || DEFAULT_PROMPT
}

export async function inpaintBackground(
  originalBuffer: Buffer,
  maskBuffer: Buffer,
  projectId: string,
  location: string = 'us-central1'
): Promise<InpaintResult> {
  const startTime = Date.now()

  console.log(`🎨 Agent 2: Starting inpainting...`)
  console.log(`   📦 Original: ${(originalBuffer.length / 1024).toFixed(1)} KB`)
  console.log(`   📦 Mask: ${(maskBuffer.length / 1024).toFixed(1)} KB`)
  console.log(`   🔧 Project: ${projectId}`)
  console.log(`   🌍 Location: ${location}`)

  try {
    // 1. 🧠 Cerveau: Gemini génère le prompt intelligent
    let finalPrompt: string
    console.log(`   🧠 Step 1: Generating smart prompt with Gemini 1.5 Flash...`)
    try {
      finalPrompt = await generateSmartPrompt(originalBuffer, projectId, location)
      console.log(`   ✅ Smart Prompt: "${finalPrompt}"`)
    } catch (e) {
      console.warn(`   ⚠️  Smart prompt failed: ${e instanceof Error ? e.message : 'Unknown'}`)
      console.log(`   📝 Using default prompt`)
      finalPrompt = DEFAULT_PROMPT
    }

    // 2. 🎨 Peintre: Imagen 3 fait l'inpainting
    console.log(`   🎨 Step 2: Sending to Imagen 3 for inpainting...`)
    const client = new PredictionServiceClient({
      apiEndpoint: `${location}-aiplatform.googleapis.com`,
      clientConfig: {
        interfaces: {
          'google.cloud.aiplatform.v1.PredictionService': {
            methods: {
              Predict: {
                timeout_millis: 120000 // 2 minutes
              }
            }
          }
        }
      }
    })

    const endpoint = `projects/${projectId}/locations/${location}/publishers/google/models/imagen-3.0-capability-001`
    console.log(`   🔗 Endpoint: imagen-3.0-capability-001`)

    const originalBase64 = originalBuffer.toString('base64')
    const maskBase64 = maskBuffer.toString('base64')

    // Prompt enrichi pour Imagen: on lui dit de CRÉER un nouveau fond, pas de copier l'existant
    const imagenPrompt = `Generate a completely NEW background. Do NOT replicate or copy the existing background. Create: ${finalPrompt}`

    const instance = helpers.toValue({
      prompt: imagenPrompt,
      referenceImages: [
        {
          referenceType: 'REFERENCE_TYPE_RAW',
          referenceId: 1,
          referenceImage: { bytesBase64Encoded: originalBase64 }
        },
        {
          referenceType: 'REFERENCE_TYPE_MASK',
          referenceId: 2,
          referenceImage: { bytesBase64Encoded: maskBase64 },
          maskImageConfig: {
            maskMode: 'MASK_MODE_USER_PROVIDED',
            dilation: 0.0 // Pas de dilation pour préserver les bords
          }
        }
      ]
    })

    const parameters = helpers.toValue({
      editMode: 'EDIT_MODE_INPAINT_INSERTION',
      editConfig: { baseSteps: 100 },
      sampleCount: 1
    })

    console.log(`   📤 Calling Imagen 3 predict API...`)
    const [response] = await client.predict({
      endpoint,
      instances: [instance!],
      parameters
    })

    console.log(`   📥 Response received from Imagen 3`)
    const predictions = response.predictions || []
    console.log(`   📊 Predictions: ${predictions.length}`)

    if (predictions.length === 0) {
      console.error(`   ❌ No predictions in response`)
      throw new Error('No predictions returned from Imagen 3')
    }

    const prediction = helpers.fromValue(predictions[0] as any)
    const editedBase64 = (prediction as any).bytesBase64Encoded

    if (!editedBase64) {
      console.error(`   ❌ No image data in prediction`)
      throw new Error('No image data in Imagen 3 response')
    }

    const inpaintedBuffer = Buffer.from(editedBase64, 'base64')
    const processingTime = Date.now() - startTime

    console.log(`   ✅ Inpainting successful!`)
    console.log(`   📦 Inpainted size: ${(inpaintedBuffer.length / 1024).toFixed(1)} KB`)
    console.log(`   ⏱️  Total time: ${processingTime}ms`)

    return {
      edited_buffer: inpaintedBuffer,
      edited_base64: editedBase64,
      inpainted_buffer: inpaintedBuffer,
      processing_time_ms: processingTime,
      model_version: 'imagen-3.0 + gemini-2.0-flash',
      smart_prompt: finalPrompt,
      success: true
    }

  } catch (error) {
    const processingTime = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    console.error(`   ❌ Agent 2 FAILED after ${processingTime}ms`)
    console.error(`   💥 Error: ${errorMessage}`)

    if (error instanceof Error && error.stack) {
      console.error(`   📍 Stack: ${error.stack.split('\n').slice(0, 3).join(' | ')}`)
    }

    return {
      edited_buffer: Buffer.alloc(0),
      edited_base64: '',
      inpainted_buffer: Buffer.alloc(0),
      processing_time_ms: processingTime,
      model_version: 'imagen-3.0-capability-001',
      smart_prompt: '',
      success: false,
      error: errorMessage
    }
  }
}
