import { PredictionServiceClient, helpers } from '@google-cloud/aiplatform'
import { VertexAI } from '@google-cloud/vertexai'
import sharp from 'sharp'
import type { InpaintResult } from '../types/pipeline'

// Limite Imagen 3
const MAX_OUTPAINT_DIMENSION = 2048

// Vinted ratio 2:3 (portrait)
const VINTED_RATIO = 1.5 // height / width

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
    console.log(`   ✅ Inpainting successful!`)
    console.log(`   📦 Inpainted size: ${(inpaintedBuffer.length / 1024).toFixed(1)} KB`)

    // 3. 🔳 Outpainting: Étendre l'image vers ratio Vinted 2:3
    console.log(`   🔳 Step 3: Outpainting to Vinted 2:3 ratio...`)

    // Get dimensions of inpainted image
    const inpaintedMeta = await sharp(inpaintedBuffer).metadata()
    let origWidth = inpaintedMeta.width!
    let origHeight = inpaintedMeta.height!
    console.log(`   📐 Original: ${origWidth}x${origHeight}`)

    // Resize si trop grand pour Imagen
    let resizedInpainted = inpaintedBuffer
    const maxDim = Math.max(origWidth, origHeight)
    if (maxDim > MAX_OUTPAINT_DIMENSION) {
      const scale = MAX_OUTPAINT_DIMENSION / maxDim
      origWidth = Math.round(origWidth * scale)
      origHeight = Math.round(origHeight * scale)
      resizedInpainted = await sharp(inpaintedBuffer)
        .resize(origWidth, origHeight)
        .jpeg({ quality: 90 })
        .toBuffer()
      console.log(`   📏 Resized for Imagen limit: ${origWidth}x${origHeight}`)
    }

    // Calculer nouvelles dimensions pour ratio 2:3 (portrait Vinted)
    // On étend MINIMALEMENT pour atteindre le ratio 2:3
    let newWidth = origWidth
    let newHeight = origHeight
    const currentRatio = origHeight / origWidth

    if (currentRatio < VINTED_RATIO) {
      // Image trop large → ajouter du padding vertical (haut/bas)
      newHeight = Math.round(origWidth * VINTED_RATIO)
    } else if (currentRatio > VINTED_RATIO) {
      // Image trop haute → ajouter du padding horizontal (gauche/droite)
      newWidth = Math.round(origHeight / VINTED_RATIO)
    }

    console.log(`   📐 Canvas 2:3: ${newWidth}x${newHeight}`)

    // Calculate offset to center the original image
    const offsetX = Math.round((newWidth - origWidth) / 2)
    const offsetY = Math.round((newHeight - origHeight) / 2)

    console.log(`   📐 Original: ${origWidth}x${origHeight} → New: ${newWidth}x${newHeight}`)

    // Create larger canvas with inpainted image centered
    const extendedImage = await sharp({
      create: {
        width: newWidth,
        height: newHeight,
        channels: 3,
        background: { r: 200, g: 200, b: 200 } // Gray background for outpaint area
      }
    })
      .composite([{
        input: resizedInpainted,
        left: offsetX,
        top: offsetY
      }])
      .jpeg({ quality: 90 })
      .toBuffer()

    // Create outpaint mask: black where original image is, white around
    const outpaintMask = await sharp({
      create: {
        width: newWidth,
        height: newHeight,
        channels: 3,
        background: { r: 255, g: 255, b: 255 } // White = area to generate
      }
    })
      .composite([{
        input: await sharp({
          create: {
            width: origWidth,
            height: origHeight,
            channels: 3,
            background: { r: 0, g: 0, b: 0 } // Black = area to keep
          }
        }).png().toBuffer(),
        left: offsetX,
        top: offsetY
      }])
      .png()
      .toBuffer()

    console.log(`   📤 Calling Imagen 3 for outpainting...`)

    const outpaintInstance = helpers.toValue({
      prompt: finalPrompt, // Réutilise le même prompt
      referenceImages: [
        {
          referenceType: 'REFERENCE_TYPE_RAW',
          referenceId: 1,
          referenceImage: { bytesBase64Encoded: extendedImage.toString('base64') }
        },
        {
          referenceType: 'REFERENCE_TYPE_MASK',
          referenceId: 2,
          referenceImage: { bytesBase64Encoded: outpaintMask.toString('base64') },
          maskImageConfig: {
            maskMode: 'MASK_MODE_USER_PROVIDED',
            dilation: 0.03 // Recommandé pour outpainting
          }
        }
      ]
    })

    const outpaintParams = helpers.toValue({
      editMode: 'EDIT_MODE_OUTPAINT',
      editConfig: { baseSteps: 35 }, // Recommandé pour outpainting
      sampleCount: 1
    })

    const [outpaintResponse] = await client.predict({
      endpoint,
      instances: [outpaintInstance!],
      parameters: outpaintParams
    })

    const outpaintPredictions = outpaintResponse.predictions || []
    if (outpaintPredictions.length === 0) {
      throw new Error('No predictions from outpainting')
    }

    const outpaintPrediction = helpers.fromValue(outpaintPredictions[0] as any)
    const finalBase64 = (outpaintPrediction as any).bytesBase64Encoded

    if (!finalBase64) {
      throw new Error('No image data from outpainting')
    }

    const outpaintedBuffer = Buffer.from(finalBase64, 'base64')
    const processingTime = Date.now() - startTime

    // Get final dimensions
    const finalMeta = await sharp(outpaintedBuffer).metadata()

    console.log(`   ✅ Outpainting successful!`)
    console.log(`   📦 Final size: ${(outpaintedBuffer.length / 1024).toFixed(1)} KB`)
    console.log(`   📐 Dimensions: ${finalMeta.width}x${finalMeta.height}`)
    console.log(`   ⏱️  Total time: ${processingTime}ms`)

    return {
      edited_buffer: outpaintedBuffer,
      edited_base64: finalBase64,
      inpainted_buffer: inpaintedBuffer,
      processing_time_ms: processingTime,
      model_version: 'imagen-3.0 + gemini-2.0-flash + outpaint',
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
