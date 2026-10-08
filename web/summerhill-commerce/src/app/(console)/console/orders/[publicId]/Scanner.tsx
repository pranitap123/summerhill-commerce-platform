'use client'

import { useEffect, useRef, useState } from 'react'

interface Detector {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>
}
type DetectorCtor = new (opts: { formats: string[] }) => Detector

export function Scanner({ onScan, disabled }: { onScan(code: string): void; disabled?: boolean }) {
  const [code, setCode] = useState('')
  const [camera, setCamera] = useState(false)
  const supported =
    typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const value = code.trim()
          if (value) onScan(value)
          setCode('')
        }}
      >
        <label htmlFor="scan-input" className="font-medium">
          Scan
        </label>
        <input
          id="scan-input"
          value={code}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="off"
          placeholder="Scan or type a barcode"
          onChange={(e) => setCode(e.target.value)}
          className="min-w-0 flex-1 rounded border px-3 py-2 font-mono text-lg"
        />
        <button
          type="submit"
          disabled={disabled}
          className="rounded bg-[#1F3A2E] px-4 py-2 text-white disabled:opacity-50"
        >
          Check
        </button>
        {supported && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setCamera((c) => !c)}
            className="rounded border border-[#1F3A2E] px-4 py-2"
            aria-pressed={camera}
          >
            📷 Camera
          </button>
        )}
      </form>
      {camera && (
        <CameraScanner
          onScan={(c) => {
            setCamera(false)
            onScan(c)
          }}
          onClose={() => setCamera(false)}
        />
      )}
    </div>
  )
}

function CameraScanner({ onScan, onClose }: { onScan(code: string): void; onClose(): void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setInterval> | undefined
    let done = false
    const Ctor = (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector
    const detector = new Ctor({ formats: ['ean_13', 'upc_a'] })
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (s) => {
        stream = s
        if (!video.current) return
        video.current.srcObject = s
        await video.current.play()
        timer = setInterval(async () => {
          if (done || !video.current) return
          const found = await detector.detect(video.current).catch(() => [])
          if (found[0] && !done) {
            done = true
            onScan(found[0].rawValue)
          }
        }, 300)
      })
      .catch(() => setError('The camera is not available. Use a scanner or type the code.'))
    return () => {
      done = true
      clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onScan])
  return (
    <div className="mt-3">
      {error ? (
        <p role="alert" className="text-[#B3261E]">
          {error}
        </p>
      ) : (
        <video ref={video} muted playsInline className="max-h-64 w-full rounded bg-black" />
      )}
      <button type="button" className="mt-2 underline" onClick={onClose}>
        Close camera
      </button>
    </div>
  )
}
