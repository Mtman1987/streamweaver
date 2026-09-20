'use client';

import * as React from 'react';

type AutoFitTextProps = {
  children: string;
  className?: string;
  minFontSize?: number;
  maxFontSize?: number;
  style?: React.CSSProperties;
};

export function AutoFitText({
  children,
  className,
  minFontSize = 8,
  maxFontSize = 20,
  style,
}: AutoFitTextProps) {
  const textRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const text = textRef.current;
    if (!text) return;

    const fit = () => {
      const available = text.clientWidth;
      if (!available) return;

      let low = minFontSize;
      let high = Math.max(minFontSize, maxFontSize);
      text.style.fontSize = `${high}px`;
      while (high - low > 0.25) {
        const size = (low + high) / 2;
        text.style.fontSize = `${size}px`;
        if (text.scrollWidth <= available) low = size;
        else high = size;
      }
      text.style.fontSize = `${Math.max(minFontSize, low).toFixed(2)}px`;
    };

    fit();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(text);
    void document.fonts?.ready.then(fit);
    return () => observer?.disconnect();
  }, [children, maxFontSize, minFontSize]);

  return (
    <div
      ref={textRef}
      className={className}
      title={children}
      style={{ minWidth: 0, maxWidth: '100%', overflow: 'hidden', whiteSpace: 'nowrap', ...style }}
    >
      {children}
    </div>
  );
}
