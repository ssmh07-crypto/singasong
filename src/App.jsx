import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  MIC_AUDIO_CONSTRAINTS,
  detectPitch,
  frequencyToNote,
} from './utils/pitch.js'

const EMPTY_READING = {
  note: '--',
  frequency: null,
  cents: null,
  status: 'idle',
  message: '음정 분석을 시작해 주세요',
}

function extractYouTubeVideoId(url) {
  try {
    const parsed = new URL(url.trim())

    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.split('/').filter(Boolean)[0] || ''
    }

    if (
      parsed.hostname === 'www.youtube.com' ||
      parsed.hostname === 'youtube.com' ||
      parsed.hostname.endsWith('.youtube.com')
    ) {
      return parsed.searchParams.get('v') || ''
    }
  } catch {
    return ''
  }

  return ''
}

function getStatusText(cents) {
  if (cents === null) {
    return { status: 'silent', message: '소리가 감지되지 않아요' }
  }

  if (Math.abs(cents) <= 10) {
    return { status: 'accurate', message: '정확해요' }
  }

  if (cents > 10) {
    return { status: 'sharp', message: '조금 높아요' }
  }

  return { status: 'flat', message: '조금 낮아요' }
}

function App() {
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [videoId, setVideoId] = useState('')
  const [youtubeMessage, setYoutubeMessage] = useState('')
  const [reading, setReading] = useState(EMPTY_READING)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [micError, setMicError] = useState('')

  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const sourceRef = useRef(null)
  const streamRef = useRef(null)
  const frameRef = useRef(null)
  const bufferRef = useRef(null)

  const embedUrl = useMemo(() => {
    if (!videoId) return ''
    return `https://www.youtube.com/embed/${videoId}`
  }, [videoId])

  const handleLoadVideo = () => {
    const nextVideoId = extractYouTubeVideoId(youtubeUrl)

    if (!nextVideoId) {
      setYoutubeMessage('지원하는 유튜브 URL을 입력해 주세요.')
      setVideoId('')
      return
    }

    setVideoId(nextVideoId)
    setYoutubeMessage('')
  }

  const stopAnalysis = useCallback(() => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect()
      sourceRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    analyserRef.current = null
    bufferRef.current = null
    setIsAnalyzing(false)
  }, [])

  const startAnalysis = async () => {
    stopAnalysis()
    setMicError('')
    setReading({
      ...EMPTY_READING,
      status: 'silent',
      message: '소리가 감지되지 않아요',
    })

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: MIC_AUDIO_CONSTRAINTS,
      })
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      const audioContext = new AudioContextClass()
      const analyser = audioContext.createAnalyser()

      analyser.fftSize = 4096
      analyser.smoothingTimeConstant = 0

      const source = audioContext.createMediaStreamSource(stream)
      source.connect(analyser)

      audioContextRef.current = audioContext
      analyserRef.current = analyser
      sourceRef.current = source
      streamRef.current = stream
      bufferRef.current = new Float32Array(analyser.fftSize)
      setIsAnalyzing(true)

      const analyze = () => {
        const currentAnalyser = analyserRef.current
        const currentBuffer = bufferRef.current
        const currentContext = audioContextRef.current

        if (!currentAnalyser || !currentBuffer || !currentContext) return

        currentAnalyser.getFloatTimeDomainData(currentBuffer)

        const frequency = detectPitch(
          currentBuffer,
          currentContext.sampleRate,
        )

        if (!frequency) {
          setReading({
            note: '--',
            frequency: null,
            cents: null,
            status: 'silent',
            message: '소리가 감지되지 않아요',
          })
        } else {
          const noteInfo = frequencyToNote(frequency)
          const statusInfo = getStatusText(noteInfo.cents)

          setReading({
            note: noteInfo.note,
            frequency,
            cents: noteInfo.cents,
            ...statusInfo,
          })
        }

        frameRef.current = requestAnimationFrame(analyze)
      }

      frameRef.current = requestAnimationFrame(analyze)
    } catch (error) {
      stopAnalysis()
      setMicError(
        error?.name === 'NotAllowedError'
          ? '마이크 권한이 거부되었습니다. 브라우저 설정에서 권한을 허용해 주세요.'
          : '마이크를 시작할 수 없습니다. HTTPS 또는 localhost에서 다시 시도해 주세요.',
      )
    }
  }

  useEffect(() => {
    return () => {
      stopAnalysis()
    }
  }, [stopAnalysis])

  const meterPosition = Math.max(
    0,
    Math.min(100, 50 + (reading.cents ?? 0)),
  )

  return (
    <main className="app-shell">
      <header className="app-header">
        <p className="eyebrow">Mobile Vocal Tuner</p>
        <h1>Sing A Song</h1>
      </header>

      <section className="youtube-panel" aria-label="유튜브 영상 불러오기">
        <label htmlFor="youtube-url">유튜브 URL</label>
        <div className="url-row">
          <input
            id="youtube-url"
            value={youtubeUrl}
            onChange={(event) => setYoutubeUrl(event.target.value)}
            placeholder="https://www.youtube.com/watch?v=VIDEO_ID"
            inputMode="url"
          />
          <button type="button" onClick={handleLoadVideo}>
            영상 불러오기
          </button>
        </div>
        {youtubeMessage && <p className="form-message">{youtubeMessage}</p>}

        <div className="player-frame">
          {embedUrl ? (
            <iframe
              title="YouTube video player"
              src={embedUrl}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : (
            <p>유튜브 영상을 불러오면 여기에 표시됩니다.</p>
          )}
        </div>
      </section>

      <section
        className={`tuner-panel status-${reading.status}`}
        aria-label="실시간 음정 분석"
      >
        <p className="guide">
          이어폰을 사용하면 유튜브 소리가 마이크에 다시 들어가는 현상을 줄일
          수 있어요.
        </p>

        <div className="note-display">
          <span className="note-label">현재 음정</span>
          <strong>{reading.note}</strong>
          <span className="status-text">{reading.message}</span>
        </div>

        <div className="meter" aria-label="튜너 게이지">
          <div className="meter-track">
            <span className="meter-zone flat-zone" />
            <span className="meter-zone center-zone" />
            <span className="meter-zone sharp-zone" />
            <span
              className="meter-needle"
              style={{ left: `${meterPosition}%` }}
            />
          </div>
          <div className="meter-labels">
            <span>낮음</span>
            <span>정확함</span>
            <span>높음</span>
          </div>
        </div>

        <div className="readout-grid">
          <div>
            <span>주파수</span>
            <strong>
              {reading.frequency ? `${reading.frequency.toFixed(1)} Hz` : '--'}
            </strong>
          </div>
          <div>
            <span>cents 오차</span>
            <strong>
              {reading.cents === null
                ? '--'
                : `${reading.cents > 0 ? '+' : ''}${reading.cents}`}
            </strong>
          </div>
        </div>

        {micError && <p className="mic-error">{micError}</p>}

        <div className="control-row">
          <button type="button" className="primary" onClick={startAnalysis}>
            음정 분석 시작
          </button>
          <button
            type="button"
            className="secondary"
            onClick={stopAnalysis}
            disabled={!isAnalyzing}
          >
            정지
          </button>
        </div>
      </section>
    </main>
  )
}

export default App
