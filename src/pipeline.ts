import { randomUUID } from 'crypto'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { generateMask } from './agents/agent1-removebg'
import { inpaintBackground } from './agents/agent2-inpaint'
import { validateEdit } from './agents/agent3-qa'
import type { PipelineResult, PipelineInput, DEFAULT_AGENT_CONFIG } from './types/pipeline'

// Cost estimates per API call
const COST_IMAGEN_MASK = 0.04 // $0.04 per mask
const COST_IMAGEN_INPAINT = 0.08 // $0.08 per inpaint

export interface PipelineConfig {
  googleApiKey: string
  gcpProjectId: string
  gcpLocation: string
  outputDir: string
}

export async function processImage(
  input: PipelineInput,
  config: PipelineConfig
): Promise<PipelineResult> {
  const imageId = randomUUID()
  const startTime = Date.now()

  // Ensure output directories exist
  const masksDir = join(config.outputDir, 'masks')
  const editedDir = join(config.outputDir, 'edited')
  const logsDir = join(config.outputDir, 'logs')

  await Promise.all([
    mkdir(masksDir, { recursive: true }),
    mkdir(editedDir, { recursive: true }),
    mkdir(logsDir, { recursive: true })
  ])

  const baseName = input.image_name.replace(/\.[^/.]+$/, '')

  try {
    // ===== AGENT 1: Generate Mask (Imagen 3) =====
    console.log(`[${imageId}] Agent 1: Generating mask with Imagen 3...`)
    const maskResult = await generateMask(input.image_buffer, config.gcpProjectId, config.gcpLocation)

    if (!maskResult.success) {
      throw new Error(`Mask generation failed: ${maskResult.error}`)
    }

    const maskPath = join(masksDir, `${baseName}_mask.png`)
    await writeFile(maskPath, maskResult.mask_buffer)
    console.log(`[${imageId}] Agent 1: Mask saved (${maskResult.generation_time_ms}ms)`)

    // ===== AGENT 2: Inpaint Background =====
    console.log(`[${imageId}] Agent 2: Inpainting background...`)
    const inpaintResult = await inpaintBackground(
      input.image_buffer,
      maskResult.mask_buffer,
      config.gcpProjectId,
      config.gcpLocation
    )

    if (!inpaintResult.success) {
      throw new Error(`Inpainting failed: ${inpaintResult.error}`)
    }

    const editedPath = join(editedDir, `${baseName}_edited.jpg`)
    await writeFile(editedPath, inpaintResult.edited_buffer)
    console.log(`[${imageId}] Agent 2: Edited image saved (${inpaintResult.processing_time_ms}ms)`)

    // ===== AGENT 3: QA Validation =====
    // QA sur inpainted_buffer (même résolution que original) pas sur outpainted
    console.log(`[${imageId}] Agent 3: Running QA validation...`)
    const qaResult = await validateEdit(
      input.image_buffer,
      inpaintResult.inpainted_buffer,  // QA sur inpaint (avant outpaint)
      maskResult.mask_buffer,
      imageId,
      {
        agent1_time_ms: maskResult.generation_time_ms,
        agent2_time_ms: inpaintResult.processing_time_ms,
        smart_prompt: inpaintResult.smart_prompt
      }
    )

    // Save forensic log
    const forensicPath = join(logsDir, `${baseName}_forensic.json`)
    await writeFile(forensicPath, JSON.stringify(qaResult.forensic_log, null, 2))
    console.log(`[${imageId}] Agent 3: QA ${qaResult.qa_status.toUpperCase()} (${qaResult.pixel_delta_percent}%)`)

    const totalTime = Date.now() - startTime
    const costEstimate = COST_IMAGEN_MASK + COST_IMAGEN_INPAINT

    return {
      success: true, // Pipeline completed - QA status is informational
      image_id: imageId,
      original_path: input.image_name,
      edited_path: editedPath,
      mask_path: maskPath,
      forensic_path: forensicPath,
      forensic_log: qaResult.forensic_log,
      total_time_ms: totalTime,
      cost_estimate: costEstimate
    }

  } catch (error) {
    const totalTime = Date.now() - startTime

    return {
      success: false,
      image_id: imageId,
      original_path: input.image_name,
      edited_path: '',
      mask_path: '',
      forensic_path: '',
      forensic_log: {} as any,
      total_time_ms: totalTime,
      cost_estimate: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// Batch processing
export async function processBatch(
  inputs: PipelineInput[],
  config: PipelineConfig,
  concurrency: number = 3
): Promise<PipelineResult[]> {
  const results: PipelineResult[] = []

  // Process in batches
  for (let i = 0; i < inputs.length; i += concurrency) {
    const batch = inputs.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map(input => processImage(input, config))
    )
    results.push(...batchResults)

    console.log(`Processed ${Math.min(i + concurrency, inputs.length)}/${inputs.length} images`)
  }

  return results
}

