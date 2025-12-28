// Agent 1: Mask Generation Output
export interface MaskResult {
  mask_buffer: Buffer
  mask_base64: string
  generation_time_ms: number
  success: boolean
  error?: string
}

// Agent 2: Inpaint Output
export interface InpaintResult {
  edited_buffer: Buffer
  edited_base64: string
  processing_time_ms: number
  model_version: string
  smart_prompt: string
  success: boolean
  error?: string
}

// Agent 3: QA Output
export interface QAResult {
  qa_status: 'pass' | 'fail'
  pixel_delta_percent: number
  forensic_log: ForensicLog
  success: boolean
  error?: string
}

// Forensic Log for legal compliance
export interface ForensicLog {
  image_id: string
  timestamp_start: string
  timestamp_end: string
  processing_time_ms: number
  original_hash: string
  edited_hash: string
  mask_hash: string
  agents_executed: string[]
  agent1_output: {
    mask_generation_time_ms: number
    success: boolean
  }
  agent2_output: {
    inpaint_time_ms: number
    model: string
    smart_prompt: string
    success: boolean
  }
  qa_output: {
    pixel_delta_percent: number
    ssim_score: number
    qa_status: 'pass' | 'fail'
    subject_integrity: 'preserved' | 'modified'
    recommendation: string
  }
  vinted_safe: boolean
  audit_trail: string[]
}

// Full Pipeline Result
export interface PipelineResult {
  success: boolean
  image_id: string
  original_path: string
  edited_path: string
  mask_path: string
  forensic_path: string
  forensic_log: ForensicLog
  total_time_ms: number
  cost_estimate: number
  error?: string
}

// Pipeline Input
export interface PipelineInput {
  image_buffer: Buffer
  image_name: string
  output_dir?: string
}

// Agent Configuration
export interface AgentConfig {
  gemini_model: string
  imagen_model: string
  qa_threshold: number
  max_retries: number
  timeout_ms: number
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  gemini_model: 'gemini-2.0-flash',
  imagen_model: 'imagen-3.0-capability-001',
  qa_threshold: 3, // max 3% pixel delta
  max_retries: 2,
  timeout_ms: 60000
}
