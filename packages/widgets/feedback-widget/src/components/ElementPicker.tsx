import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { describeElement, type ElementAnchor } from '../elementAnchor';

interface ElementPickerProps {
  active: boolean;
  onPick: (anchor: ElementAnchor) => void;
  onCancel: () => void;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Is this node part of the widget's own chrome (so we never let it be picked)? */
function isWidgetChrome(el: Element | null): boolean {
  return !!el?.closest?.('[data-feedback-widget], .smw-picker');
}

/**
 * Full-page element picker. While active, hovering draws a highlight box over the
 * element under the cursor and clicking captures it as an anchor. Esc cancels.
 * It never mutates page elements (highlight is a floating overlay), and ignores
 * the widget's own UI.
 */
export const ElementPicker: React.FC<ElementPickerProps> = ({ active, onPick, onCancel }) => {
  const [box, setBox] = useState<Box | null>(null);

  const targetFromEvent = useCallback((e: MouseEvent): Element | null => {
    const t = e.target as Element | null;
    if (!t || isWidgetChrome(t)) return null;
    return t;
  }, []);

  useEffect(() => {
    if (!active) {
      setBox(null);
      return;
    }

    const onMove = (e: MouseEvent) => {
      const t = targetFromEvent(e);
      if (!t?.getBoundingClientRect) {
        setBox(null);
        return;
      }
      const r = t.getBoundingClientRect();
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
    };

    const onClick = (e: MouseEvent) => {
      const t = targetFromEvent(e);
      if (!t) return; // clicks on widget chrome pass through
      e.preventDefault();
      e.stopPropagation();
      onPick(describeElement(t));
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    document.body.style.cursor = 'crosshair';
    return () => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.cursor = '';
    };
  }, [active, targetFromEvent, onPick, onCancel]);

  if (!active) return null;

  return (
    <div className="smw-picker">
      {box && (
        <div
          className="smw-picker__box"
          style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
        />
      )}
      <div className="smw-picker__hint">
        Click the part of the page your feedback is about · <kbd>Esc</kbd> to cancel
      </div>
    </div>
  );
};
