import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import './App.css'
import { activeSong } from './data/songs.js'
import {
  MIC_AUDIO_CONSTRAINTS,
  centsBetweenFrequencies,
  detectPitch,
  frequencyToNote,
  noteToFrequency,
} from './utils/pitch.js'

const GAME_STATES = {
  READY: 'ready',
  PLAYING: 'playing',
  FINISHED: 'finished',
}

const EMPTY_PITCH = {
  note: '--',
  frequency: null,
  cents: null,
}

const JUDGEMENT_POINTS = {
  PERFECT: 120,
  GOOD: 70,
  OK: 35,
}

const songDurationMs = Math.max(
  ...activeSong.notes.map((note) => note.startMs + note.durationMs),
) + 1200

function getActiveNote(elapsedMs) {
  return activeSong.notes.find(
    (note) =>
      elapsedMs >= note.startMs && elapsedMs <= note.startMs + note.durationMs,
  )
}

function getJudgement(cents) {
  if (cents === null) return null
  const absoluteCents = Math.abs(cents)

  if (absoluteCents <= 20) return 'PERFECT'
  if (absoluteCents <= 50) return 'GOOD'
  if (absoluteCents <= 100) return 'OK'
  return 'MISS'
}

function scheduleBackingTrack(synth, bassSynth) {
  const leadPart = new Tone.Part(
    (time, event) => {
      synth.triggerAttackRelease(event.note, event.durationMs / 1000, time, 0.55)
    },
    activeSong.notes.map((note) => ({
      time: note.startMs / 1000,
      note: note.note,
      durationMs: note.durationMs,
    })),
  )

  const bassPattern = [
    { note: 'C3', time: 0 },
    { note: 'G2', time: 2.7 },
    { note: 'A2', time: 5.4 },
    { note: 'F2', time: 8.3 },
    { note: 'G2', time: 11.3 },
  ]

  const bassPart = new Tone.Part((time, event) => {
    bassSynth.triggerAttackRelease(event.note, '1n', time, 0.32)
  }, bassPattern)

  leadPart.start(0)
  bassPart.start(0)
  return [leadPart, bassPart]
}

function App() {
  const [gameState, setGameState] = useState(GAME_STATES.READY)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [maxCombo, setMaxCombo] = useState(0)
  const [pitch, setPitch] = useState(EMPTY_PITCH)
  const [statusText, setStatusText] = useState('준비되면 시작하세요')
  const [judgement, setJudgement] = useState('')
  const [micError, setMicError] = useState('')

  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const sourceRef = useRef(null)
  const streamRef = useRef(null)
  const frameRef = useRef(null)
  const bufferRef = useRef(null)
  const startTimeRef = useRef(0)
  const smoothFrequencyRef = useRef(null)
  const scoredNotesRef = useRef(new Set())
  const tonePartsRef = useRef([])
  const synthsRef = useRef([])
  const judgementTimerRef = useRef(null)

  const activeNote = useMemo(() => getActiveNote(elapsedMs), [elapsedMs])
  const progress = Math.min(100, (elapsedMs / songDurationMs) * 100)
  const targetFrequency = activeNote ? noteToFrequency(activeNote.note) : null

  const stopGame = useCallback((nextState = GAME_STATES.READY) => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }

    if (judgementTimerRef.current) {
      window.clearTimeout(judgementTimerRef.current)
      judgementTimerRef.current = null
    }

    tonePartsRef.current.forEach((part) => {
      part.stop()
      part.dispose()
    })
    tonePartsRef.current = []

    synthsRef.current.forEach((synth) => synth.dispose())
    synthsRef.current = []
    Tone.Transport.stop()
    Tone.Transport.cancel()

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
    smoothFrequencyRef.current = null
    setGameState(nextState)
  }, [])

  const finishGame = useCallback(() => {
    stopGame(GAME_STATES.FINISHED)
    setElapsedMs(songDurationMs)
    setStatusText('게임 종료')
  }, [stopGame])

  const showJudgement = useCallback((nextJudgement) => {
    setJudgement('')
    window.requestAnimationFrame(() => {
      setJudgement(nextJudgement)
    })

    if (judgementTimerRef.current) {
      window.clearTimeout(judgementTimerRef.current)
    }

    judgementTimerRef.current = window.setTimeout(() => {
      setJudgement('')
    }, 520)
  }, [])

  const applyScore = useCallback(
    (noteIndex, nextJudgement) => {
      if (scoredNotesRef.current.has(noteIndex)) return
      scoredNotesRef.current.add(noteIndex)
      showJudgement(nextJudgement)

      if (nextJudgement === 'MISS') {
        setCombo(0)
        return
      }

      setScore((currentScore) => currentScore + JUDGEMENT_POINTS[nextJudgement])
      setCombo((currentCombo) => {
        const nextCombo = currentCombo + 1
        setMaxCombo((currentMax) => Math.max(currentMax, nextCombo))
        return nextCombo
      })
    },
    [showJudgement],
  )

  const startGame = async () => {
    stopGame(GAME_STATES.READY)
    setMicError('')
    setElapsedMs(0)
    setScore(0)
    setCombo(0)
    setMaxCombo(0)
    setPitch(EMPTY_PITCH)
    setJudgement('')
    setStatusText('마이크 준비 중')
    scoredNotesRef.current = new Set()

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

      await Tone.start()
      Tone.Transport.bpm.value = activeSong.bpm
      Tone.Transport.position = 0

      const leadSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.02, decay: 0.18, sustain: 0.35, release: 0.6 },
      }).toDestination()
      const bassSynth = new Tone.MonoSynth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.01, decay: 0.22, sustain: 0.28, release: 0.8 },
      }).toDestination()

      tonePartsRef.current = scheduleBackingTrack(leadSynth, bassSynth)
      synthsRef.current = [leadSynth, bassSynth]

      audioContextRef.current = audioContext
      analyserRef.current = analyser
      sourceRef.current = source
      streamRef.current = stream
      bufferRef.current = new Float32Array(analyser.fftSize)
      startTimeRef.current = performance.now()
      setGameState(GAME_STATES.PLAYING)
      setStatusText('목표 음정을 따라 불러보세요')
      Tone.Transport.start()

      const analyze = () => {
        const currentAnalyser = analyserRef.current
        const currentBuffer = bufferRef.current
        const currentContext = audioContextRef.current

        if (!currentAnalyser || !currentBuffer || !currentContext) return

        const nowMs = performance.now() - startTimeRef.current
        setElapsedMs(nowMs)

        currentAnalyser.getFloatTimeDomainData(currentBuffer)
        const detectedFrequency = detectPitch(
          currentBuffer,
          currentContext.sampleRate,
        )
        const currentNote = getActiveNote(nowMs)

        if (!detectedFrequency || !currentNote) {
          smoothFrequencyRef.current = null
          setPitch(EMPTY_PITCH)
          setStatusText(
            currentNote ? '소리 감지 안 됨' : '다음 음정을 기다리는 중',
          )
        } else {
          const smoothedFrequency =
            smoothFrequencyRef.current === null
              ? detectedFrequency
              : smoothFrequencyRef.current * 0.72 + detectedFrequency * 0.28
          smoothFrequencyRef.current = smoothedFrequency

          const noteInfo = frequencyToNote(smoothedFrequency)
          const currentTargetFrequency = noteToFrequency(currentNote.note)
          const cents = centsBetweenFrequencies(
            smoothedFrequency,
            currentTargetFrequency,
          )
          const currentJudgement = getJudgement(cents)

          setPitch({
            note: noteInfo.note,
            frequency: smoothedFrequency,
            cents,
          })
          setStatusText(currentJudgement)

          const noteIndex = activeSong.notes.indexOf(currentNote)
          const scoringPoint = currentNote.startMs + currentNote.durationMs * 0.62
          if (nowMs >= scoringPoint) {
            applyScore(noteIndex, currentJudgement)
          }
        }

        activeSong.notes.forEach((note, noteIndex) => {
          if (
            !scoredNotesRef.current.has(noteIndex) &&
            nowMs > note.startMs + note.durationMs
          ) {
            setStatusText('소리 감지 안 됨')
          }
        })

        if (nowMs >= songDurationMs) {
          finishGame()
          return
        }

        frameRef.current = requestAnimationFrame(analyze)
      }

      frameRef.current = requestAnimationFrame(analyze)
    } catch (error) {
      stopGame(GAME_STATES.READY)
      setStatusText('준비되면 시작하세요')
      setMicError(
        error?.name === 'NotAllowedError'
          ? '마이크 권한이 거부되었습니다. 브라우저 설정에서 권한을 허용해 주세요.'
          : '마이크를 시작할 수 없습니다. HTTPS 또는 localhost에서 다시 시도해 주세요.',
      )
    }
  }

  useEffect(() => {
    return () => {
      stopGame(GAME_STATES.READY)
    }
  }, [stopGame])

  const cursorOffset = targetFrequency
    ? Math.max(-120, Math.min(120, pitch.cents ?? 0))
    : 0

  return (
    <main className={`game-shell state-${gameState}`}>
      <header className="top-bar">
        <div>
          <span>Score</span>
          <strong>{score}</strong>
        </div>
        <h1>Sing A Song</h1>
        <div>
          <span>Combo</span>
          <strong>{combo}</strong>
        </div>
      </header>

      <section className="stage" aria-label="음정 게임 스테이지">
        <div className="progress-track">
          <span style={{ width: `${progress}%` }} />
        </div>

        <div className="note-road">
          {activeSong.notes.map((note) => {
            const left = (note.startMs / songDurationMs) * 100
            const width = (note.durationMs / songDurationMs) * 100
            const isActive = activeNote === note

            return (
              <span
                key={`${note.note}-${note.startMs}`}
                className={`target-note ${isActive ? 'active' : ''}`}
                style={{ left: `${left}%`, width: `${width}%` }}
              >
                {note.note}
              </span>
            )
          })}
          <span className="playhead" style={{ left: `${progress}%` }} />
        </div>

        <div className="target-display">
          <span>Target</span>
          <strong>{activeNote?.note ?? '--'}</strong>
          <em>{activeNote?.lyric ?? 'Ready'}</em>
        </div>

        <div className="pitch-lane">
          <span className="lane-line" />
          <div
            className="voice-cursor"
            style={{ transform: `translateX(calc(-50% + ${cursorOffset}px))` }}
            aria-label="사용자 현재 음정 커서"
          >
            <span>Mic</span>
          </div>
        </div>

        <div className="judgement-zone" aria-live="polite">
          {judgement && (
            <strong className={`judgement judgement-${judgement.toLowerCase()}`}>
              {judgement}
            </strong>
          )}
        </div>
      </section>

      <section className="readout-panel" aria-label="게임 상태">
        <div className="status-line">
          <span>{statusText}</span>
        </div>
        <div className="readouts">
          <div>
            <span>현재 음정</span>
            <strong>{pitch.note}</strong>
          </div>
          <div>
            <span>주파수</span>
            <strong>
              {pitch.frequency ? `${pitch.frequency.toFixed(1)} Hz` : '--'}
            </strong>
          </div>
          <div>
            <span>오차</span>
            <strong>
              {pitch.cents === null
                ? '--'
                : `${pitch.cents > 0 ? '+' : ''}${pitch.cents}c`}
            </strong>
          </div>
        </div>
      </section>

      {gameState === GAME_STATES.READY && (
        <section className="overlay-panel">
          <p className="eyebrow">Vocal Rhythm Game</p>
          <h2>{activeSong.title}</h2>
          <p>
            스피커로 반주가 재생됩니다. 조용한 환경에서 화면의 목표 음정을
            따라 불러보세요.
          </p>
          <p className="warning">
            주변 소리가 크면 음정 인식이 부정확할 수 있어요.
          </p>
          {micError && <p className="mic-error">{micError}</p>}
          <button type="button" className="primary-action" onClick={startGame}>
            게임 시작
          </button>
        </section>
      )}

      {gameState === GAME_STATES.PLAYING && (
        <button type="button" className="stop-button" onClick={() => stopGame()}>
          정지
        </button>
      )}

      {gameState === GAME_STATES.FINISHED && (
        <section className="overlay-panel result-panel">
          <p className="eyebrow">Result</p>
          <h2>연습 완료</h2>
          <div className="result-grid">
            <div>
              <span>Score</span>
              <strong>{score}</strong>
            </div>
            <div>
              <span>Max Combo</span>
              <strong>{maxCombo}</strong>
            </div>
          </div>
          <button type="button" className="primary-action" onClick={startGame}>
            다시 시작
          </button>
        </section>
      )}
    </main>
  )
}

export default App
