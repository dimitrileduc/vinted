import sharp from 'sharp'
import { createHash } from 'crypto'
import type { QAResult, ForensicLog } from '../types/pipeline'

const SSIM_THRESHOLD = 0.92 // Minimum structural similarity for subject area

/**
 * Calculate SSIM (Structural Similarity Index) between two grayscale buffers
 * SSIM measures perceptual similarity - better than pixel comparison for AI-edited images
 */
function calculateSSIM(
  img1: Buffer,
  img2: Buffer,
  _width: number,
  _height: number
): number {
  const L = 255 // Dynamic range
  const k1 = 0.01
  const k2 = 0.03
  const c1 = (k1 * L) ** 2
  const c2 = (k2 * L) ** 2

  let sumX = 0, sumY = 0
  let sumX2 = 0, sumY2 = 0
  let sumXY = 0
  const n = img1.length

  for (let i = 0; i < n; i++) {
    const x = img1[i]
    const y = img2[i]
    sumX += x
    sumY += y
    sumX2 += x * x
    sumY2 += y * y
    sumXY += x * y
  }

  const meanX = sumX / n
  const meanY = sumY / n
  const varX = (sumX2 / n) - (meanX * meanX)
  const varY = (sumY2 / n) - (meanY * meanY)
  const covXY = (sumXY / n) - (meanX * meanY)

  const numerator = (2 * meanX * meanY + c1) * (2 * covXY + c2)
  const denominator = (meanX * meanX + meanY * meanY + c1) * (varX + varY + c2)

  return numerator / denominator
}

export async function validateEdit(
  originalBuffer: Buffer,
  editedBuffer: Buffer,
  maskBuffer: Buffer,
  imageId: string,
  agentTimings: {
    agent1_time_ms: number
    agent2_time_ms: number
    smart_prompt: string
  }
): Promise<QAResult> {
  const startTime = Date.now()
  const timestampStart = new Date().toISOString()
  const auditTrail: string[] = []

  console.log(`🔍 Agent 3: Starting QA validation...`)
  console.log(`   📦 Original: ${(originalBuffer.length / 1024).toFixed(1)} KB`)
  console.log(`   📦 Edited: ${(editedBuffer.length / 1024).toFixed(1)} KB`)
  console.log(`   📦 Mask: ${(maskBuffer.length / 1024).toFixed(1)} KB`)
  console.log(`   🆔 Image ID: ${imageId.slice(0, 8)}...`)

  try {
    // Generate SHA-256 hashes
    console.log(`   🔐 Generating SHA-256 hashes...`)
    const originalHash = `sha256:${createHash('sha256').update(originalBuffer).digest('hex')}`
    const editedHash = `sha256:${createHash('sha256').update(editedBuffer).digest('hex')}`
    const maskHash = `sha256:${createHash('sha256').update(maskBuffer).digest('hex')}`
    auditTrail.push('Hashes generated for all images')
    console.log(`   ✅ Hashes generated`)

    // Load images with Sharp
    console.log(`   📷 Loading images with Sharp...`)
    const originalImage = sharp(originalBuffer)
    const editedImage = sharp(editedBuffer)
    const maskImage = sharp(maskBuffer)

    // Get metadata
    const origMeta = await originalImage.metadata()
    const width = origMeta.width!
    const height = origMeta.height!
    console.log(`   📐 Image dimensions: ${width}x${height}`)

    // Extract raw pixel data - convert to grayscale for SSIM
    console.log(`   🔄 Extracting pixel data for SSIM...`)
    const [origGray, editGray, maskRaw] = await Promise.all([
      originalImage.resize(width, height).grayscale().raw().toBuffer(),
      editedImage.resize(width, height).grayscale().raw().toBuffer(),
      maskImage.resize(width, height).grayscale().raw().toBuffer()
    ])

    auditTrail.push('Pixel data extracted for SSIM analysis')

    // Extract only subject pixels (where mask is BLACK < 128)
    const subjectOriginal: number[] = []
    const subjectEdited: number[] = []

    for (let i = 0; i < origGray.length; i++) {
      if (maskRaw[i] < 128) {
        subjectOriginal.push(origGray[i])
        subjectEdited.push(editGray[i])
      }
    }

    auditTrail.push(`Subject area: ${subjectOriginal.length} pixels extracted`)
    console.log(`   📊 Subject pixels: ${subjectOriginal.length.toLocaleString()} (${((subjectOriginal.length / origGray.length) * 100).toFixed(1)}% of image)`)

    // Calculate SSIM for subject area only
    console.log(`   🧮 Calculating SSIM...`)
    const ssim = calculateSSIM(
      Buffer.from(subjectOriginal),
      Buffer.from(subjectEdited),
      1,
      subjectOriginal.length
    )

    const ssimPercent = Math.round(ssim * 10000) / 100
    auditTrail.push(`SSIM (subject area): ${ssimPercent}%`)
    console.log(`   📈 SSIM Score: ${ssimPercent}% (threshold: ${SSIM_THRESHOLD * 100}%)`)

    // Also calculate simple pixel delta for reference
    let changedPixels = 0
    for (let i = 0; i < subjectOriginal.length; i++) {
      if (Math.abs(subjectOriginal[i] - subjectEdited[i]) > 10) {
        changedPixels++
      }
    }
    const pixelDelta = (changedPixels / subjectOriginal.length) * 100
    auditTrail.push(`Pixel delta (reference): ${pixelDelta.toFixed(2)}%`)

    // QA Decision based on SSIM
    const qaStatus = ssim >= SSIM_THRESHOLD ? 'pass' : 'fail'
    const subjectIntegrity = ssim >= SSIM_THRESHOLD ? 'preserved' : 'modified'

    if (qaStatus === 'pass') {
      auditTrail.push(`✅ QA PASS: SSIM ${ssimPercent}% >= ${SSIM_THRESHOLD * 100}%`)
      console.log(`   ✅ QA PASS: Subject integrity preserved`)
    } else {
      auditTrail.push(`❌ QA FAIL: SSIM ${ssimPercent}% < ${SSIM_THRESHOLD * 100}%`)
      console.log(`   ❌ QA FAIL: Subject may have been modified`)
    }

    const timestampEnd = new Date().toISOString()
    const qaTime = Date.now() - startTime
    const totalProcessingTime = agentTimings.agent1_time_ms + agentTimings.agent2_time_ms + qaTime
    console.log(`   ⏱️  QA Time: ${qaTime}ms | Total pipeline: ${totalProcessingTime}ms`)

    const forensicLog: ForensicLog = {
      image_id: imageId,
      timestamp_start: timestampStart,
      timestamp_end: timestampEnd,
      processing_time_ms: totalProcessingTime,
      original_hash: originalHash,
      edited_hash: editedHash,
      mask_hash: maskHash,
      agents_executed: ['removebg', 'inpaint', 'qa'],
      agent1_output: {
        mask_generation_time_ms: agentTimings.agent1_time_ms,
        success: true
      },
      agent2_output: {
        inpaint_time_ms: agentTimings.agent2_time_ms,
        model: 'imagen-3.0-capability-001',
        smart_prompt: agentTimings.smart_prompt,
        success: true
      },
      qa_output: {
        pixel_delta_percent: Math.round(pixelDelta * 100) / 100,
        ssim_score: Math.round(ssim * 1000) / 1000,
        qa_status: qaStatus,
        subject_integrity: subjectIntegrity,
        recommendation: qaStatus === 'pass' ? 'Ready for Vinted' : 'Manual review required'
      },
      vinted_safe: qaStatus === 'pass',
      audit_trail: auditTrail
    }

    return {
      qa_status: qaStatus,
      pixel_delta_percent: Math.round(pixelDelta * 100) / 100,
      forensic_log: forensicLog,
      success: true
    }

  } catch (error) {
    const qaTime = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`   ❌ Agent 3 FAILED after ${qaTime}ms`)
    console.error(`   💥 Error: ${errorMessage}`)
    auditTrail.push(`ERROR: ${errorMessage}`)

    const forensicLog: ForensicLog = {
      image_id: imageId,
      timestamp_start: timestampStart,
      timestamp_end: new Date().toISOString(),
      processing_time_ms: qaTime,
      original_hash: '',
      edited_hash: '',
      mask_hash: '',
      agents_executed: ['removebg', 'inpaint', 'qa'],
      agent1_output: { mask_generation_time_ms: agentTimings.agent1_time_ms, success: true },
      agent2_output: { inpaint_time_ms: agentTimings.agent2_time_ms, model: 'imagen-3.0-capability-001', smart_prompt: agentTimings.smart_prompt, success: true },
      qa_output: {
        pixel_delta_percent: -1,
        ssim_score: -1,
        qa_status: 'fail',
        subject_integrity: 'modified',
        recommendation: 'QA process failed - manual review required'
      },
      vinted_safe: false,
      audit_trail: auditTrail
    }

    return {
      qa_status: 'fail',
      pixel_delta_percent: -1,
      forensic_log: forensicLog,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}
