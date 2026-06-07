export const MIC_AUDIO_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const A4_MIDI = 69
const A4_FREQUENCY = 440
const MIN_RMS = 0.015
const MIN_FREQUENCY = 60
const MAX_FREQUENCY = 1200

export function frequencyToNote(frequency) {
  const midi = Math.round(12 * Math.log2(frequency / A4_FREQUENCY) + A4_MIDI)
  const noteFrequency = A4_FREQUENCY * 2 ** ((midi - A4_MIDI) / 12)
  const cents = Math.round(1200 * Math.log2(frequency / noteFrequency))
  const noteName = NOTE_NAMES[((midi % 12) + 12) % 12]
  const octave = Math.floor(midi / 12) - 1

  return {
    note: `${noteName}${octave}`,
    cents,
    targetFrequency: noteFrequency,
  }
}

export function detectPitch(buffer, sampleRate) {
  let rms = 0

  for (let index = 0; index < buffer.length; index += 1) {
    rms += buffer[index] * buffer[index]
  }

  rms = Math.sqrt(rms / buffer.length)
  if (rms < MIN_RMS) return null

  // Autocorrelation compares the waveform with delayed copies of itself.
  // The strongest repeating delay is treated as the period of the sung note.
  const minLag = Math.floor(sampleRate / MAX_FREQUENCY)
  const maxLag = Math.min(
    Math.floor(sampleRate / MIN_FREQUENCY),
    buffer.length - 1,
  )
  const correlations = new Float32Array(maxLag + 1)

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    for (let index = 0; index < buffer.length - lag; index += 1) {
      correlations[lag] += buffer[index] * buffer[index + lag]
    }
  }

  let lag = minLag
  while (lag < correlations.length - 1 && correlations[lag] > correlations[lag + 1]) {
    lag += 1
  }

  let bestLag = -1
  let bestCorrelation = 0
  for (; lag < correlations.length; lag += 1) {
    if (correlations[lag] > bestCorrelation) {
      bestCorrelation = correlations[lag]
      bestLag = lag
    }
  }

  if (bestLag <= 0) return null

  const previous = correlations[bestLag - 1]
  const current = correlations[bestLag]
  const next = correlations[bestLag + 1]
  const shift = (next - previous) / (2 * (2 * current - next - previous))
  const refinedLag = Number.isFinite(shift) ? bestLag + shift : bestLag
  const frequency = sampleRate / refinedLag

  if (frequency < MIN_FREQUENCY || frequency > MAX_FREQUENCY) return null
  return frequency
}
