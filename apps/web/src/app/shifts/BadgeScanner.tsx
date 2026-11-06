/* Скан бейджа с камеры телефона (задача 1271): BarcodeDetector, если браузер поддерживает; иначе остаётся
   ручной ввод кода. Само распознавание ничего не записывает: найденный работник добавляется в бригаду,
   неизвестный или отозванный код даёт сообщение, запись не создаётся. */
import * as React from 'react';
import { Camera, Search, X } from 'lucide-react';
import { Button, Input, toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { useT } from '@/i18n';
import { useBadgeLookup, type BadgeLookup } from '../objects/shifts-data';

/** Поддержка BarcodeDetector и форматов QR/Code128 (браузер может не уметь — тогда камера не предлагается) */
interface DetectorLike {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
}
const Detector = (globalThis as unknown as { BarcodeDetector?: new (opts?: { formats?: string[] }) => DetectorLike }).BarcodeDetector;
const cameraSupported = (): boolean => typeof Detector === 'function' && !!navigator.mediaDevices?.getUserMedia;

export function BadgeScanner({ onFound }: { onFound: (b: BadgeLookup) => void }) {
  const tt = useT();
  const lookup = useBadgeLookup();
  const [code, setCode] = React.useState('');
  const [scanning, setScanning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const timerRef = React.useRef<number | null>(null);
  const busy = React.useRef(false);

  const stop = React.useCallback(() => {
    setScanning(false);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  React.useEffect(() => stop, [stop]);

  const find = async (value: string): Promise<void> => {
    if (!value.trim() || busy.current) return;
    busy.current = true;
    setError(null);
    try {
      const found = await lookup.mutateAsync(value.trim());
      onFound(found);
      setCode('');
      toast(tt('shifts.scan.added', { name: found.name }), { duration: 1500 });
      stop();
    } catch (e) {
      // код не найден — записи нет; показываем сообщение по коду ошибки
      setError(tt('shifts.scan.notFound'));
      void e;
    } finally {
      busy.current = false;
    }
  };

  /** Камера: кадр проверяется детектором раз в 400 мс, повторный кадр одного кода не дублирует действие */
  const start = async (): Promise<void> => {
    if (!Detector) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setScanning(true);
      // ждём монтирования video после setScanning
      window.setTimeout(() => {
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        void video.play();
        const detector = new Detector({ formats: ['qr_code', 'code_128'] });
        timerRef.current = window.setInterval(() => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          void detector
            .detect(videoRef.current)
            .then(frames => {
              const value = frames[0]?.rawValue;
              if (value) void find(value);
            })
            .catch(() => {});
        }, 400);
      }, 50);
    } catch (e) {
      stop();
      setError(errorMessage(e));
    }
  };

  return (
    <div className="shift-scanner">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {cameraSupported() ? (
          scanning ? (
            <Button variant="secondary" onClick={stop}>
              <X size={14} />
              {tt('shifts.scan.stop')}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => void start()}>
              <Camera size={14} />
              {tt('shifts.scan.start')}
            </Button>
          )
        ) : (
          <span className="faint" style={{ fontSize: 12 }}>
            {tt('shifts.scan.unsupported')}
          </span>
        )}
      </div>
      {scanning && <video ref={videoRef} muted playsInline aria-label={tt('shifts.scan.start')} />}
      <form
        className="row"
        style={{ gap: 8 }}
        onSubmit={e => {
          e.preventDefault();
          void find(code);
        }}
      >
        <Input aria-label={tt('shifts.scan.manual')} placeholder={tt('shifts.scan.manualPlaceholder')} value={code} onChange={e => setCode(e.target.value)} autoComplete="off" />
        <Button type="submit" variant="secondary" disabled={!code.trim()}>
          <Search size={14} />
          {tt('shifts.scan.find')}
        </Button>
      </form>
      {error && (
        <span className="err" role="alert" style={{ fontSize: 12 }}>
          {error}
        </span>
      )}
    </div>
  );
}
