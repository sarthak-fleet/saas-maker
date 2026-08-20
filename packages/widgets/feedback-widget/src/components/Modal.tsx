import type React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import type { ElementAnchor } from '../elementAnchor';
import type { FeedbackSubmission, FeedbackType } from '../types';
import { SubmitForm } from './SubmitForm';

interface ModalProps {
  isOpen: boolean;
  /** Kept mounted but visually hidden (e.g. during element picking) so form state survives. */
  hidden?: boolean;
  onClose: () => void;
  onSubmit: (feedback: FeedbackSubmission) => void | Promise<void>;
  userEmail?: string;
  userName?: string;
  requireEmail?: boolean;
  types: FeedbackType[];
  accentColor: string;
  enablePointing?: boolean;
  anchor?: ElementAnchor | null;
  onStartPick?: () => void;
  onClearAnchor?: () => void;
}

const CloseIcon: React.FC = () => (
  <svg
    width="20"
    height="20"
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

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  hidden = false,
  onClose,
  onSubmit,
  userEmail,
  userName,
  requireEmail,
  types,
  accentColor,
  enablePointing,
  anchor,
  onStartPick,
  onClearAnchor,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    // Don't let Esc close the modal while picking — there Esc cancels the pick.
    if (isOpen && !hidden) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, hidden, handleKeyDown]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  if (!isOpen) return null;

  return (
    <div
      className="smw-overlay"
      onClick={handleBackdropClick}
      style={hidden ? { display: 'none' } : undefined}
    >
      <div
        ref={modalRef}
        className="smw-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Feedback"
      >
        {/* Header */}
        <div className="smw-modal__header">
          <h2 className="smw-modal__title">Feedback</h2>
          <button type="button" className="smw-modal__close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        {/* Body */}
        <div className="smw-modal__body">
          <SubmitForm
            onSubmit={onSubmit}
            userEmail={userEmail}
            userName={userName}
            requireEmail={requireEmail}
            types={types}
            accentColor={accentColor}
            enablePointing={enablePointing}
            anchor={anchor}
            onStartPick={onStartPick}
            onClearAnchor={onClearAnchor}
          />
        </div>
      </div>
    </div>
  );
};
