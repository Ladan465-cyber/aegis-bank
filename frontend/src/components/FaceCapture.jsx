import { useEffect, useRef, useState } from 'react'
import { Camera, ScanFace } from 'lucide-react'
import { Spinner } from './ui.jsx'

// face-api.js model weights (≈ 7 MB). Served from the CDN by default; for an offline demo
// download them into frontend/public/models and set VITE_FACE_MODELS=/models in .env
const MODEL_URL = import.meta.env.VITE_FACE_MODELS || 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model'
let loading = null
function loadFaceApi() {
  loading ||= (async () => {
    const faceapi = await import('@vladmandic/face-api')
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ])
    return faceapi
  })().catch((e) => { loading = null; throw e })
  return loading
}

const PROMPTS = ['Look straight at the camera', 'Turn your head slightly left', 'Turn your head slightly right']

/**
 * mode="enroll": captures 3 samples then calls onSamples([[128 floats] x3])
 * mode="verify": captures one sample then calls onDescriptor([128 floats])
 * Only ONE face may be in frame; a second face is rejected.
 */
export default function FaceCapture({ mode = 'verify', onSamples, onDescriptor, busy = false, actionLabel = 'Verify my face' }) {
  const video = useRef(null)
  const stream = useRef(null)
  const api = useRef(null)
  const [status, setStatus] = useState('loading')   // loading | ready | error
  const [msg, setMsg] = useState('')
  const [samples, setSamples] = useState([])
  const [working, setWorking] = useState(false)

  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        api.current = await loadFaceApi()
        stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false })
        if (dead) return stream.current.getTracks().forEach((t) => t.stop())
        video.current.srcObject = stream.current
        await video.current.play()
        setStatus('ready')
      } catch (e) {
        setStatus('error')
        setMsg(e?.name === 'NotAllowedError' ? 'Camera access was blocked. Allow the camera in your browser and try again.'
          : 'Could not start the camera or load the face models. Check your connection and camera.')
      }
    })()
    return () => { dead = true; stream.current?.getTracks().forEach((t) => t.stop()) }
  }, [])

  async function grab() {
    const faceapi = api.current
    const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
    const all = await faceapi.detectAllFaces(video.current, opts).withFaceLandmarks().withFaceDescriptors()
    if (all.length === 0) throw new Error('No face found. Move closer and face the light.')
    if (all.length > 1) throw new Error('More than one face in view. Only you should be in the frame.')
    if (all[0].detection.score < 0.7) throw new Error('Face is not clear enough. Improve the lighting.')
    return Array.from(all[0].descriptor)
  }

  async function capture() {
    setWorking(true); setMsg('')
    try {
      const d = await grab()
      if (mode === 'verify') return onDescriptor?.(d)
      const next = [...samples, d]
      setSamples(next)
      if (next.length === 3) { onSamples?.(next); setSamples([]) }
    } catch (e) { setMsg(e.message) } finally { setWorking(false) }
  }

  const disabled = status !== 'ready' || working || busy
  return (
    <div>
      <div className="relative mx-auto aspect-[4/3] w-full max-w-sm overflow-hidden rounded-2xl bg-ink-900">
        <video ref={video} playsInline muted className="h-full w-full -scale-x-100 object-cover" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-[78%] w-[52%] rounded-[50%] border-2 border-dashed border-white/80" />
        </div>
        {status === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink-900 text-sm text-white">
            <Spinner /> Starting camera and loading face models…
          </div>
        )}
        {(working || busy) && status === 'ready' && (
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink-900/80 px-3 py-1.5 text-xs text-white"><Spinner className="!size-3.5" /> Analysing</div>
        )}
      </div>

      {mode === 'enroll' && (
        <div className="mt-4 flex items-center justify-center gap-2">
          {[0, 1, 2].map((i) => <span key={i} className={`h-2 w-10 rounded-full ${i < samples.length ? 'bg-safe' : 'bg-ink-900/15'}`} />)}
        </div>
      )}
      <p className="mt-3 min-h-[1.25rem] text-center text-sm font-medium text-ink-700">
        {status === 'error' ? <span className="text-danger">{msg}</span>
          : msg ? <span className="text-danger">{msg}</span>
          : mode === 'enroll' ? PROMPTS[samples.length] : 'Centre your face in the oval, then verify.'}
      </p>
      <button className="btn-primary mt-3 w-full" disabled={disabled} onClick={capture}>
        {mode === 'enroll' ? <><Camera size={16} /> Capture sample {samples.length + 1} of 3</> : <><ScanFace size={16} /> {actionLabel}</>}
      </button>
    </div>
  )
}
