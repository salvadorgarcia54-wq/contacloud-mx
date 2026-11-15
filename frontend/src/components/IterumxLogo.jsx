import React, { useState } from 'react';

export const IterumxIsotipoSvg = ({ className = 'h-9 w-9' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 200 186"
    fill="none"
    className={className}
    aria-label="Iterumx Isotipo"
  >
    <path d="M22 162 L87 101 L96 111 L22 180 Z" fill="#57A82C" />
    <path d="M178 162 L113 101 L104 111 L178 180 Z" fill="#57A82C" />
    <path
      d="M15 8 C19 4 24 5 28 9 L100 77 L172 9 C176 5 181 4 185 8 C188 10 190 14 190 19 L190 174 C190 181 182 185 176 180 L172 176 L172 34 L105 97 C102 100 98 100 95 97 L28 34 L28 176 L24 180 C18 185 10 181 10 174 L10 19 C10 14 12 10 15 8 Z"
      fill="#1E2C5E"
    />
  </svg>
);

const IterumxLogo = ({
  collapsed = false,
  size = 'md',
  showSubtitle = false,
  subtitle = 'PLATAFORMA CONTABLE Y FISCAL',
  className = '',
}) => {
  const [imgError, setImgError] = useState(false);

  const sizeMap = {
    sm: {
      iconPx: 44,
      titleSize: '22px',
      subSize: '9px',
      subMarginTop: '3px',
      gap: '10px',
    },
    md: {
      iconPx: 54,
      titleSize: '26px',
      subSize: '9.5px',
      subMarginTop: '4px',
      gap: '12px',
    },
    lg: {
      iconPx: 68,
      titleSize: '34px',
      subSize: '10px',
      subMarginTop: '4px',
      gap: '14px',
    },
    xl: {
      iconPx: 80,
      titleSize: '42px',
      subSize: '11px',
      subMarginTop: '5px',
      gap: '16px',
    },
  };

  const currentSize = sizeMap[size] || sizeMap.md;
  const iconStyle = {
    width: `${currentSize.iconPx}px`,
    height: `${currentSize.iconPx}px`,
    minWidth: `${currentSize.iconPx}px`,
    minHeight: `${currentSize.iconPx}px`,
  };

  return (
    <div
      className={`inline-flex items-center select-none flex-shrink-0 ${className}`}
      style={{ gap: currentSize.gap }}
    >
      {!imgError ? (
        <img
          src="/api/assets/iterumx-isotipo"
          alt="Iterumx"
          onError={() => setImgError(true)}
          className="object-contain flex-shrink-0"
          style={iconStyle}
        />
      ) : (
        <div style={iconStyle} className="flex items-center justify-center flex-shrink-0">
          <IterumxIsotipoSvg className="w-full h-full" />
        </div>
      )}

      {!collapsed && (
        <div className="flex flex-col justify-center text-left leading-none">
          <div className="flex items-center leading-none">
            <span
              className="font-light tracking-wide leading-none whitespace-nowrap"
              style={{
                color: '#1E2C5E',
                fontSize: currentSize.titleSize,
                fontWeight: 300,
                letterSpacing: '0.02em',
                lineHeight: 0.95,
              }}
            >
              Iterum<span style={{ color: '#57A82C', fontWeight: 400 }}>x</span>
            </span>
          </div>
          {showSubtitle && (
            <span
              className="font-normal tracking-widest uppercase text-slate-500 leading-tight whitespace-nowrap"
              style={{
                fontSize: currentSize.subSize,
                marginTop: currentSize.subMarginTop,
              }}
            >
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default IterumxLogo;
