import { readMultipartFormData, createError, getQuery } from 'h3'
import { processImage, type PipelineConfig } from '../../src/pipeline'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const query = getQuery(event)
  const skipQA = query.skipQA === 'true' || query.skipQA === '1'

  // Validate configuration
  if (!config.googleApiKey || !config.gcpProjectId) {
    throw createError({
      statusCode: 500,
      message: 'Server configuration error: Missing GCP credentials'
    })
  }

  // Parse multipart form data
  const formData = await readMultipartFormData(event)

  if (!formData || formData.length === 0) {
    throw createError({
      statusCode: 400,
      message: 'No file uploaded. Please send an image file.'
    })
  }

  // Find the image file
  const imageFile = formData.find(
    (part) => part.name === 'image' && part.data && part.data.length > 0
  )

  if (!imageFile) {
    throw createError({
      statusCode: 400,
      message: 'No image file found in request. Use field name "image".'
    })
  }

  // Validate file type
  const contentType = imageFile.type || ''
  if (!contentType.startsWith('image/')) {
    throw createError({
      statusCode: 400,
      message: 'Invalid file type. Please upload an image (JPEG, PNG).'
    })
  }

  // Process the image
  const pipelineConfig: PipelineConfig = {
    googleApiKey: config.googleApiKey,
    gcpProjectId: config.gcpProjectId,
    gcpLocation: config.gcpLocation || 'us-central1',
    outputDir: '.'
  }

  const result = await processImage(
    {
      image_buffer: imageFile.data,
      image_name: imageFile.filename || 'uploaded_image.jpg'
    },
    pipelineConfig,
    { skipQA }
  )

  if (!result.success) {
    throw createError({
      statusCode: 500,
      message: result.error || 'Image processing failed'
    })
  }

  // Return result with base64 encoded images for frontend display
  const fs = await import('fs')
  const path = await import('path')

  let editedBase64 = ''
  let maskBase64 = ''
  let studioBase64 = ''

  try {
    if (result.edited_path) {
      const editedBuffer = fs.readFileSync(result.edited_path)
      editedBase64 = editedBuffer.toString('base64')
    }
    if (result.mask_path) {
      const maskBuffer = fs.readFileSync(result.mask_path)
      maskBase64 = maskBuffer.toString('base64')
    }
    // Charger l'image de référence statique
    const studioRefPath = path.join(process.cwd(), 'public', 'studio-ref.jpg')
    const studioBuffer = fs.readFileSync(studioRefPath)
    studioBase64 = studioBuffer.toString('base64')
  } catch (e) {
    // Files might not exist if processing failed
  }

  return {
    success: true,
    image_id: result.image_id,
    edited_image: editedBase64 ? `data:image/jpeg;base64,${editedBase64}` : null,
    mask_image: maskBase64 ? `data:image/png;base64,${maskBase64}` : null,
    studio_image: studioBase64 ? `data:image/jpeg;base64,${studioBase64}` : null,
    forensic_log: result.forensic_log,
    processing_time_ms: result.total_time_ms,
    cost_estimate: result.cost_estimate,
    qa_status: result.forensic_log?.qa_output?.qa_status || 'unknown',
    pixel_delta: result.forensic_log?.qa_output?.pixel_delta_percent || 0,
    ssim_score: result.forensic_log?.qa_output?.ssim_score || 0,
    smart_prompt: result.forensic_log?.agent2_output?.smart_prompt || ''
  }
})
