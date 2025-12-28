import { PredictionServiceClient, helpers } from '@google-cloud/aiplatform'
import { VertexAI } from '@google-cloud/vertexai'
import sharp from 'sharp'
import type { InpaintResult } from '../types/pipeline'

// Configuration outpainting
const TARGET_OBJECT_RATIO = 0.85 // Objet = 85% du frame (best practice ecommerce)
const MIN_OUTPAINT_SCALE = 1.1 // Minimum 10% de padding
const MAX_OUTPAINT_SCALE = 2.0 // Maximum 100% de padding
const MAX_OUTPAINT_DIMENSION = 2048 // Limite Imagen 3

// Vinted optimal dimensions
const VINTED_WIDTH = 1000
const VINTED_HEIGHT = 1500 // Ratio 2:3 portrait

// 📐 Analyser le mask pour trouver la bounding box de l'objet
async function analyzeObjectBounds(maskBuffer: Buffer): Promise<{
  bbox: { x: number, y: number, width: number, height: number },
  objectRatio: number,
  imageWidth: number,
  imageHeight: number
}> {
  const { data, info } = await sharp(maskBuffer)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { width, height } = info
  let minX = width, minY = height, maxX = 0, maxY = 0
  let objectPixels = 0

  // Parcourir les pixels - noir (< 128) = objet
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = data[y * width + x]
      if (pixel < 128) { // Noir = objet
        objectPixels++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  // Si pas d'objet trouvé, utiliser toute l'image
  if (maxX < minX || maxY < minY) {
    return {
      bbox: { x: 0, y: 0, width, height },
      objectRatio: 1.0,
      imageWidth: width,
      imageHeight: height
    }
  }

  const bboxWidth = maxX - minX + 1
  const bboxHeight = maxY - minY + 1

  // Ratio = max(largeur objet / largeur image, hauteur objet / hauteur image)
  const objectRatio = Math.max(bboxWidth / width, bboxHeight / height)

  return {
    bbox: { x: minX, y: minY, width: bboxWidth, height: bboxHeight },
    objectRatio,
    imageWidth: width,
    imageHeight: height
  }
}

// 🧮 Calculer le scale adaptatif pour atteindre 85% target
function calculateAdaptiveScale(currentObjectRatio: number): number {
  // Si objet = 60% et target = 85%, on veut scale = 60/85 = 0.7
  // Mais scale est pour agrandir le canvas, donc scale = 1/0.7 = 1.43
  const neededScale = currentObjectRatio / TARGET_OBJECT_RATIO

  // Clamp entre min et max
  const scale = Math.max(MIN_OUTPAINT_SCALE, Math.min(MAX_OUTPAINT_SCALE, 1 / neededScale))

  return scale
}

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

    // 3. 🔳 Outpainting: Étendre l'image avec padding adaptatif
    console.log(`   🔳 Step 3: Outpainting with adaptive padding...`)

    // Analyser le mask pour calculer le ratio objet/image
    const objectAnalysis = await analyzeObjectBounds(maskBuffer)
    console.log(`   📊 Object ratio: ${(objectAnalysis.objectRatio * 100).toFixed(1)}% of frame`)
    console.log(`   📦 Object bbox: ${objectAnalysis.bbox.width}x${objectAnalysis.bbox.height}`)

    // Calculer le scale adaptatif pour atteindre 85% target
    const adaptiveScale = calculateAdaptiveScale(objectAnalysis.objectRatio)
    console.log(`   🎯 Target: ${TARGET_OBJECT_RATIO * 100}% → Adaptive scale: ${adaptiveScale.toFixed(2)}x`)

    // Get dimensions of inpainted image
    const inpaintedMeta = await sharp(inpaintedBuffer).metadata()
    let origWidth = inpaintedMeta.width!
    let origHeight = inpaintedMeta.height!

    // Resize if image is too large for Imagen (après outpaint)
    let resizedInpainted = inpaintedBuffer
    const maxDim = Math.max(origWidth, origHeight)
    const scaledMaxDim = maxDim * adaptiveScale

    if (scaledMaxDim > MAX_OUTPAINT_DIMENSION) {
      // Resize pour que l'image outpaintée ne dépasse pas la limite
      const resizeScale = MAX_OUTPAINT_DIMENSION / scaledMaxDim
      origWidth = Math.round(origWidth * resizeScale)
      origHeight = Math.round(origHeight * resizeScale)
      resizedInpainted = await sharp(inpaintedBuffer)
        .resize(origWidth, origHeight)
        .jpeg({ quality: 90 })
        .toBuffer()
      console.log(`   📏 Resized for outpaint limit: ${origWidth}x${origHeight}`)
    }

    // Calculate new dimensions with adaptive scale + Vinted 2:3 ratio
    const VINTED_RATIO = VINTED_HEIGHT / VINTED_WIDTH // 1.5 (portrait)

    let newWidth = Math.round(origWidth * adaptiveScale)
    let newHeight = Math.round(origHeight * adaptiveScale)

    // Ajuster pour ratio 2:3 (portrait Vinted) - étendre le plus petit côté
    const currentRatio = newHeight / newWidth
    if (currentRatio < VINTED_RATIO) {
      // Trop large → plus de padding vertical
      newHeight = Math.round(newWidth * VINTED_RATIO)
    } else if (currentRatio > VINTED_RATIO) {
      // Trop haut → plus de padding horizontal
      newWidth = Math.round(newHeight / VINTED_RATIO)
    }

    console.log(`   📐 Canvas ratio 2:3: ${newWidth}x${newHeight}`)

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
    console.log(`   ✅ Outpainting successful!`)
    console.log(`   📦 Outpainted size: ${(outpaintedBuffer.length / 1024).toFixed(1)} KB`)

    // 4. 📱 Resize final vers format Vinted optimal (1000x1500, ratio 2:3)
    console.log(`   📱 Step 4: Resizing to Vinted format ${VINTED_WIDTH}x${VINTED_HEIGHT}...`)

    const finalBuffer = await sharp(outpaintedBuffer)
      .resize(VINTED_WIDTH, VINTED_HEIGHT, {
        fit: 'contain',           // Garde tout, pas de crop
        background: { r: 255, g: 255, b: 255 } // Blanc si besoin de padding
      })
      .jpeg({ quality: 92 })
      .toBuffer()

    const processingTime = Date.now() - startTime

    console.log(`   ✅ Final Vinted image ready!`)
    console.log(`   📦 Final size: ${(finalBuffer.length / 1024).toFixed(1)} KB`)
    console.log(`   📐 Dimensions: ${VINTED_WIDTH}x${VINTED_HEIGHT}`)
    console.log(`   ⏱️  Total time: ${processingTime}ms`)

    return {
      edited_buffer: finalBuffer,
      edited_base64: finalBuffer.toString('base64'),
      inpainted_buffer: inpaintedBuffer,  // Pour QA (même résolution que original)
      processing_time_ms: processingTime,
      model_version: 'imagen-3.0 + gemini-2.0-flash + outpaint + vinted-resize',
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
