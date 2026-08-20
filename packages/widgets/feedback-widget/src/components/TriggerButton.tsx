import type React from 'react';

interface TriggerButtonProps {
  onClick: () => void;
  position: 'bottom-right' | 'bottom-left';
  accentColor: string;
  triggerText: string;
}

const MegaphoneIcon: React.FC = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m3 11 18-5v12L3 13v-2z" />
    <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
  </svg>
);

export const TriggerButton: React.FC<TriggerButtonProps> = ({
  onClick,
  position,
  accentColor,
  triggerText,
}) => {
  const positionClass =
    position === 'bottom-left' ? 'smw-trigger--bottom-left' : 'smw-trigger--bottom-right';

  return (
    <button
      type="button"
      className={`smw-trigger ${positionClass}`}
      style={{ '--smw-accent': accentColor } as React.CSSProperties}
      onClick={onClick}
      aria-label={triggerText}
    >
      <MegaphoneIcon />
      <span className="smw-trigger__text">{triggerText}</span>
    </button>
  );
};
