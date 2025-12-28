import { GoogleGenAI } from '@google/genai'
import type { MaskResult } from '../types/pipeline'

const MASK_PROMPT = `Create a black and white binary segmentation mask image.

The mask must show:
- Pure BLACK (#000000) pixels for the clothing/shoes/product (the subject to KEEP)
- Pure WHITE (#FFFFFF) pixels for the background (the area to REPLACE)

Rules:
- Only 2 colors: pure black and pure white
- No gray, no gradients, no anti-aliasing
- Black = subject (clothes, shoes, accessories)
- White = background
- Sharp clean edges between black and white areas

Output: A flat black and white silhouette mask image.`

export async function generateMask(
  imageBuffer: Buffer,
  projectId: string,
  _location: string = 'us-central1'
): Promise<MaskResult> {
  const startTime = Date.now()

  console.log(`🎭 Agent 1: Starting mask generation...`)
  console.log(`   📦 Image size: ${(imageBuffer.length / 1024).toFixed(1)} KB`)
  console.log(`   🔧 Project: ${projectId}`)
  console.log(`   🌍 Location: global (required for gemini-3-pro-image-preview)`)

  try {
    console.log(`   🔌 Initializing GoogleGenAI client...`)
    const ai = new GoogleGenAI({
      vertexai: true,
      project: projectId,
      location: 'global'
    })

    const imageBase64 = imageBuffer.toString('base64')
    console.log(`   📤 Sending request to Gemini 3 Pro Image...`)

    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: [
        {
          role: 'user',
          parts: [
            { text: MASK_PROMPT },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: imageBase64
              }
            }
          ]
        }
      ],
      config: {
        responseModalities: ['TEXT', 'IMAGE']
      }
    })

    console.log(`   📥 Response received from Gemini`)

    const candidates = response.candidates || []
    console.log(`   📊 Candidates: ${candidates.length}`)

    if (candidates.length === 0) {
      console.error(`   ❌ No candidates in response`)
      throw new Error('No candidates in Gemini response')
    }

    const parts = candidates[0]?.content?.parts || []
    console.log(`   📊 Parts in response: ${parts.length}`)

    // Log what types of parts we received
    const partTypes = parts.map((p, i) => {
      if (p.text) return `[${i}] text (${p.text.length} chars)`
      if (p.inlineData) return `[${i}] image (${p.inlineData.mimeType})`
      return `[${i}] unknown`
    })
    console.log(`   📋 Part types: ${partTypes.join(', ')}`)

    // Find image in response
    let maskBase64 = ''
    let maskMimeType = ''
    for (const part of parts) {
      if (part.inlineData) {
        maskBase64 = part.inlineData.data || ''
        maskMimeType = part.inlineData.mimeType || 'unknown'
        break
      }
    }

    if (!maskBase64) {
      // Log any text response for debugging
      const textParts = parts.filter(p => p.text).map(p => p.text)
      if (textParts.length > 0) {
        console.error(`   ❌ No image found. Text response: ${textParts.join(' | ')}`)
      } else {
        console.error(`   ❌ No image and no text in response`)
      }
      throw new Error('No mask image in Gemini response')
    }

    const maskBuffer = Buffer.from(maskBase64, 'base64')
    const generationTime = Date.now() - startTime

    console.log(`   ✅ Mask generated successfully!`)
    console.log(`   📦 Mask size: ${(maskBuffer.length / 1024).toFixed(1)} KB`)
    console.log(`   🎨 Mask type: ${maskMimeType}`)
    console.log(`   ⏱️  Time: ${generationTime}ms`)

    return {
      mask_buffer: maskBuffer,
      mask_base64: maskBase64,
      generation_time_ms: generationTime,
      success: true
    }

  } catch (error) {
    const generationTime = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    console.error(`   ❌ Agent 1 FAILED after ${generationTime}ms`)
    console.error(`   💥 Error: ${errorMessage}`)

    if (error instanceof Error && error.stack) {
      console.error(`   📍 Stack: ${error.stack.split('\n').slice(0, 3).join(' | ')}`)
    }

    return {
      mask_buffer: Buffer.alloc(0),
      mask_base64: '',
      generation_time_ms: generationTime,
      success: false,
      error: errorMessage
    }
  }
}
