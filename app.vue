<template>
  <div class="app">
    <header>
      <h1>Bulk Photo Factory</h1>
      <p>Remove backgrounds from Vinted photos while preserving defects</p>
      <label class="toggle-qa">
        <input type="checkbox" v-model="skipQA" />
        Skip QA (faster)
      </label>
    </header>

    <main>
      <!-- Upload Section -->
      <section class="upload-section">
        <div
          class="dropzone"
          :class="{ 'dropzone--active': isDragging, 'dropzone--disabled': isProcessing }"
          @drop.prevent="handleDrop"
          @dragover.prevent="isDragging = true"
          @dragleave="isDragging = false"
          @click="triggerFileInput"
        >
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            multiple
            hidden
            @change="handleFileSelect"
          />
          <div class="dropzone-content">
            <span class="dropzone-icon">📷</span>
            <p v-if="!isProcessing">Drop images here or click to upload</p>
            <p v-else>Processing...</p>
          </div>
        </div>
      </section>

      <!-- Processing Status -->
      <section v-if="isProcessing" class="status-section">
        <div class="loader"></div>
        <p class="status-main">{{ statusMessage }}</p>
        <div class="pipeline-steps">
          <span :class="['step', { active: currentStep >= 1, done: currentStep > 1 }]">
            {{ currentStep > 1 ? '✅' : '🎭' }} Agent 1: Mask
          </span>
          <span class="step-arrow">→</span>
          <span :class="['step', { active: currentStep >= 2, done: currentStep > 2 }]">
            {{ currentStep > 2 ? '✅' : '🎨' }} Agent 2: Inpaint
          </span>
          <template v-if="!skipQA">
            <span class="step-arrow">→</span>
            <span :class="['step', { active: currentStep >= 3, done: currentStep > 3 }]">
              {{ currentStep > 3 ? '✅' : '🔍' }} Agent 3: QA
            </span>
          </template>
        </div>
      </section>

      <!-- Results Section -->
      <section v-if="results.length > 0" class="results-section">
        <h2>Results</h2>
        <div class="results-grid">
          <div v-for="result in results" :key="result.image_id" class="result-card">
            <div class="result-header">
              <span :class="['status-badge', result.qa_status]">
                {{ result.qa_status === 'pass' ? '✅ PASS' : '❌ FAIL' }}
              </span>
              <span class="time">{{ result.processing_time_ms }}ms</span>
            </div>

            <div class="images-comparison-3">
              <div class="image-container">
                <p>1. Original</p>
                <img v-if="result.original_preview" :src="result.original_preview" alt="Original" />
              </div>
              <div class="image-container">
                <p>2. Mask (Agent 1)</p>
                <img v-if="result.mask_image" :src="result.mask_image" alt="Mask" />
                <p v-else class="no-image">No mask</p>
              </div>
              <div class="image-container">
                <p>3. Edited (Agent 2)</p>
                <img v-if="result.edited_image" :src="result.edited_image" alt="Edited" />
                <p v-else class="no-image">No output</p>
              </div>
            </div>

            <div class="result-details">
              <p v-if="result.smart_prompt" class="smart-prompt">
                <strong>🧠 Prompt:</strong> "{{ result.smart_prompt }}"
              </p>
              <p><strong>SSIM:</strong> {{ (result.ssim_score * 100).toFixed(1) }}% | <strong>Delta:</strong> {{ result.pixel_delta }}%</p>
              <p><strong>Cost:</strong> ${{ result.cost_estimate?.toFixed(2) }} | <strong>Time:</strong> {{ (result.processing_time_ms / 1000).toFixed(1) }}s</p>
            </div>

            <div class="result-actions">
              <button v-if="result.edited_image" @click="downloadImage(result)">
                Download Edited
              </button>
              <button @click="showForensicLog(result)">
                View Forensic Log
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Forensic Log Modal -->
      <div v-if="showModal" class="modal-overlay" @click="showModal = false">
        <div class="modal" @click.stop>
          <h3>Forensic Log</h3>
          <pre>{{ JSON.stringify(selectedForensicLog, null, 2) }}</pre>
          <button @click="showModal = false">Close</button>
        </div>
      </div>
    </main>

    <footer>
      <p>Bulk Photo Factory - Vinted Background Remover</p>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

interface ProcessResult {
  image_id: string
  success: boolean
  edited_image: string | null
  mask_image: string | null
  original_preview: string
  forensic_log: any
  processing_time_ms: number
  cost_estimate: number
  qa_status: string
  pixel_delta: number
  ssim_score: number
  smart_prompt: string
}

const fileInput = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)
const isProcessing = ref(false)
const statusMessage = ref('')
const currentStep = ref(0)
const results = ref<ProcessResult[]>([])
const skipQA = ref(true) // Skip QA by default
const showModal = ref(false)
const selectedForensicLog = ref<any>(null)

function triggerFileInput() {
  if (!isProcessing.value) {
    fileInput.value?.click()
  }
}

function handleDrop(event: DragEvent) {
  isDragging.value = false
  if (isProcessing.value) return

  const files = event.dataTransfer?.files
  if (files) {
    processFiles(Array.from(files))
  }
}

function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement
  if (target.files) {
    processFiles(Array.from(target.files))
  }
}

async function processFiles(files: File[]) {
  const imageFiles = files.filter(f => f.type.startsWith('image/'))
  if (imageFiles.length === 0) return

  isProcessing.value = true

  for (let i = 0; i < imageFiles.length; i++) {
    const file = imageFiles[i]
    statusMessage.value = `Processing ${i + 1}/${imageFiles.length}: ${file.name}`
    currentStep.value = 1

    try {
      const formData = new FormData()
      formData.append('image', file)

      // Create preview
      const originalPreview = await fileToDataUrl(file)

      // Simulate step progression (API is synchronous)
      const stepTimer = setInterval(() => {
        if (currentStep.value < 3) {
          currentStep.value++
        }
      }, 8000) // Each step ~8s

      const response = await fetch(`/api/process${skipQA.value ? '?skipQA=true' : ''}`, {
        method: 'POST',
        body: formData
      })

      clearInterval(stepTimer)
      currentStep.value = 4 // Done

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Processing failed')
      }

      const data = await response.json()

      results.value.unshift({
        ...data,
        original_preview: originalPreview
      })
    } catch (error) {
      console.error(`Failed to process ${file.name}:`, error)
      results.value.unshift({
        image_id: crypto.randomUUID(),
        success: false,
        edited_image: null,
        mask_image: null,
        original_preview: await fileToDataUrl(file),
        forensic_log: { error: error instanceof Error ? error.message : 'Unknown error' },
        processing_time_ms: 0,
        cost_estimate: 0,
        qa_status: 'fail',
        pixel_delta: -1,
        ssim_score: 0,
        smart_prompt: ''
      })
    }
  }

  isProcessing.value = false
  statusMessage.value = ''
  currentStep.value = 0
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(file)
  })
}

function downloadImage(result: ProcessResult) {
  if (!result.edited_image) return

  const link = document.createElement('a')
  link.href = result.edited_image
  link.download = `edited_${result.image_id}.jpg`
  link.click()
}

function showForensicLog(result: ProcessResult) {
  selectedForensicLog.value = result.forensic_log
  showModal.value = true
}
</script>

<style>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f5f5f5;
  min-height: 100vh;
}

.app {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

header {
  text-align: center;
  margin-bottom: 2rem;
}

header h1 {
  color: #333;
  margin-bottom: 0.5rem;
}

header p {
  color: #666;
}

.toggle-qa {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
  padding: 0.5rem 1rem;
  background: #e8f4ff;
  border-radius: 20px;
  cursor: pointer;
  font-size: 0.875rem;
}

.toggle-qa input {
  cursor: pointer;
}

.upload-section {
  margin-bottom: 2rem;
}

.dropzone {
  border: 3px dashed #ccc;
  border-radius: 12px;
  padding: 3rem;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  background: white;
}

.dropzone:hover {
  border-color: #007bff;
  background: #f8f9ff;
}

.dropzone--active {
  border-color: #007bff;
  background: #e8f0ff;
}

.dropzone--disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.dropzone-icon {
  font-size: 3rem;
  display: block;
  margin-bottom: 1rem;
}

.status-section {
  text-align: center;
  padding: 2rem;
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.status-main {
  font-weight: 600;
  margin-bottom: 1rem;
}

.loader {
  width: 40px;
  height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #007bff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 1rem;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.pipeline-steps {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
  flex-wrap: wrap;
}

.step {
  padding: 0.5rem 1rem;
  border-radius: 20px;
  font-size: 0.875rem;
  background: #f0f0f0;
  color: #999;
  transition: all 0.3s;
}

.step.active {
  background: #fff3cd;
  color: #856404;
  animation: pulse 1.5s infinite;
}

.step.done {
  background: #d4edda;
  color: #155724;
  animation: none;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.step-arrow {
  color: #ccc;
  font-weight: bold;
}

.results-section h2 {
  margin-bottom: 1rem;
  color: #333;
}

.results-grid {
  display: grid;
  gap: 1.5rem;
}

.result-card {
  background: white;
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.status-badge {
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-weight: bold;
  font-size: 0.875rem;
}

.status-badge.pass {
  background: #d4edda;
  color: #155724;
}

.status-badge.fail {
  background: #f8d7da;
  color: #721c24;
}

.time {
  color: #666;
  font-size: 0.875rem;
}

.images-comparison {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-bottom: 1rem;
}

.images-comparison-3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 1rem;
  margin-bottom: 1rem;
}

.no-image {
  color: #999;
  font-style: italic;
}

.image-container {
  text-align: center;
}

.image-container p {
  font-size: 0.875rem;
  color: #666;
  margin-bottom: 0.5rem;
}

.image-container img {
  max-width: 100%;
  max-height: 300px;
  border-radius: 8px;
  border: 1px solid #eee;
}

.result-details {
  margin-bottom: 1rem;
  padding: 0.75rem;
  background: #f9f9f9;
  border-radius: 8px;
}

.result-details p {
  font-size: 0.875rem;
  color: #555;
  margin-bottom: 0.25rem;
}

.smart-prompt {
  background: #e8f4ff;
  padding: 0.5rem;
  border-radius: 4px;
  margin-bottom: 0.5rem !important;
  font-style: italic;
}

.result-actions {
  display: flex;
  gap: 0.5rem;
}

.result-actions button {
  flex: 1;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background 0.2s;
}

.result-actions button:first-child {
  background: #007bff;
  color: white;
}

.result-actions button:first-child:hover {
  background: #0056b3;
}

.result-actions button:last-child {
  background: #6c757d;
  color: white;
}

.result-actions button:last-child:hover {
  background: #545b62;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: white;
  padding: 2rem;
  border-radius: 12px;
  max-width: 600px;
  max-height: 80vh;
  overflow: auto;
}

.modal h3 {
  margin-bottom: 1rem;
}

.modal pre {
  background: #f5f5f5;
  padding: 1rem;
  border-radius: 8px;
  overflow: auto;
  font-size: 0.75rem;
  max-height: 400px;
}

.modal button {
  margin-top: 1rem;
  padding: 0.5rem 1.5rem;
  background: #007bff;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

footer {
  text-align: center;
  margin-top: 3rem;
  padding-top: 2rem;
  border-top: 1px solid #eee;
  color: #999;
}
</style>
