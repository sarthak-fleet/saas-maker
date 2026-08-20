import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface ImageUploadProps {
  file: File | null;
  onFile: (file: File | null) => void;
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024;

const UploadIcon: React.FC = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const CloseIcon: React.FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export const ImageUpload: React.FC<ImageUploadProps> = ({ file, onFile }) => {
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl]
  );

  const selectFile = useCallback(
    (nextFile: File) => {
      if (!ALLOWED_TYPES.includes(nextFile.type)) {
        setError('Only JPEG, PNG, GIF, and WebP images are allowed.');
        return;
      }
      if (nextFile.size > MAX_SIZE) {
        setError('Image must be less than 5MB.');
        return;
      }
      setError(null);
      onFile(nextFile);
    },
    [onFile]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDragging(false);
      const nextFile = event.dataTransfer.files[0];
      if (nextFile) selectFile(nextFile);
    },
    [selectFile]
  );

  if (file && previewUrl) {
    return (
      <div className="smw-image-upload__preview">
        <img src={previewUrl} alt="Selected screenshot" className="smw-image-upload__img" />
        <button
          type="button"
          className="smw-image-upload__remove"
          onClick={() => onFile(null)}
          aria-label="Remove screenshot"
        >
          <CloseIcon />
        </button>
      </div>
    );
  }

  return (
    <div className="smw-image-upload">
      <div
        className={`smw-image-upload__dropzone ${dragging ? 'smw-image-upload__dropzone--active' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragging(false);
        }}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.gif,.webp"
          onChange={(event) => {
            const nextFile = event.target.files?.[0];
            if (nextFile) selectFile(nextFile);
            event.target.value = '';
          }}
          className="smw-image-upload__input"
          tabIndex={-1}
        />
        <UploadIcon />
        <span className="smw-image-upload__label">Drop an image here or click to attach</span>
        <span className="smw-image-upload__hint">JPEG, PNG, GIF, WebP (max 5MB)</span>
      </div>
      {error && <p className="smw-image-upload__error">{error}</p>}
    </div>
  );
};
