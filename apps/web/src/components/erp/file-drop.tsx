/* Зона загрузки файла: пунктирная рамка, клик открывает выбор файла, файл можно перетащить.
   Стиль .dropzone (styles/files.css) — тот же, что у импорта сметы и файлов проекта. */
import * as React from 'react';
import { FileText, UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';

export function FileDrop({
  accept,
  onFile,
  label,
  fileName,
  disabled,
  className,
}: {
  accept?: string;
  onFile: (file: File) => void;
  /** Подсказка в пустой зоне: «Перетащите файл сюда или нажмите…» */
  label: React.ReactNode;
  /** Выбранный файл — показывается вместо подсказки, зона остаётся рабочей для замены */
  fileName?: string | null;
  disabled?: boolean;
  className?: string;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  return (
    <>
      <button
        type="button"
        className={cn('dropzone w-full', over && 'over', className)}
        disabled={disabled}
        onClick={() => input.current?.click()}
        onDragOver={e => {
          e.preventDefault();
          if (e.dataTransfer.types.includes('Files')) setOver(true);
        }}
        onDragLeave={e => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
        }}
        onDrop={e => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f && !disabled) onFile(f);
        }}
      >
        {fileName ? <FileText size={18} aria-hidden /> : <UploadCloud size={18} aria-hidden />}
        <span>{fileName ? <strong style={{ overflowWrap: 'anywhere' }}>{fileName}</strong> : label}</span>
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </>
  );
}
