import React from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';

/**
 * CSS-only scroll illustration using nested divs.
 * Renders a decorative Torah scroll shape.
 */
function ScrollIllustration() {
  return (
    <div className="flex items-center justify-center gap-1 mb-8 select-none" aria-hidden="true">
      {/* Left handle */}
      <div className="flex flex-col items-center gap-0.5">
        <div className="w-3 h-2 rounded-full bg-[#B8973A] opacity-70" />
        <div className="w-1.5 h-14 rounded-full bg-[#B8973A] opacity-60" />
        <div className="w-3 h-2 rounded-full bg-[#B8973A] opacity-70" />
      </div>

      {/* Scroll body */}
      <div
        className="relative w-36 h-20 rounded-sm flex items-center justify-center overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #F8F6F1 60%, #EDE9E0 100%)',
          border: '1.5px solid #D8D2C4',
          boxShadow: '0 2px 8px rgba(27,43,94,0.10)',
        }}
      >
        {/* Ruled lines */}
        {[20, 32, 44, 56].map((top) => (
          <div
            key={top}
            className="absolute right-4 left-4 h-px"
            style={{ top, background: '#D8D2C4' }}
          />
        ))}
        {/* Decorative Hebrew letter aleph */}
        <span
          className="text-3xl font-bold leading-none"
          style={{ color: '#1B2B5E', opacity: 0.12, fontFamily: 'Heebo, serif' }}
        >
          ?
        </span>
      </div>

      {/* Right handle */}
      <div className="flex flex-col items-center gap-0.5">
        <div className="w-3 h-2 rounded-full bg-[#B8973A] opacity-70" />
        <div className="w-1.5 h-14 rounded-full bg-[#B8973A] opacity-60" />
        <div className="w-3 h-2 rounded-full bg-[#B8973A] opacity-70" />
      </div>
    </div>
  );
}

/**
 * 404 Not Found page.
 * Full-page, centered layout. RTL Hebrew text.
 */
export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-16 animate-fade-in"
      style={{ backgroundColor: 'var(--bg-page)' }}
      dir="rtl"
    >
      {/* Scroll illustration */}
      <ScrollIllustration />

      {/* Large 404 */}
      <div
        className="font-bold leading-none mb-4 select-none"
        style={{
          fontSize: 'clamp(6rem, 18vw, 10rem)',
          color: '#1B2B5E',
          letterSpacing: '-0.04em',
          lineHeight: 1,
        }}
        aria-hidden="true"
      >
        404
      </div>

      {/* Gold divider */}
      <div
        className="w-16 h-1 rounded-full mb-6"
        style={{ backgroundColor: '#B8973A' }}
        aria-hidden="true"
      />

      {/* Main message */}
      <h1
        className="text-2xl font-bold text-center mb-3 font-heebo"
        style={{ color: 'var(--text-primary)' }}
      >
        הדף שחיפשת לא נמצא
      </h1>

      {/* Subtext */}
      <p
        className="text-base text-center mb-8 max-w-sm leading-relaxed font-heebo"
        style={{ color: 'var(--text-muted)' }}
      >
        ייתכן שהדף הועבר, נמחק, או שהכתובת שגויה.
        <br />
        אנא בדוק את הכתובת ונסה שוב.
      </p>

      {/* CTA button */}
      <Button
        variant="primary"
        size="lg"
        onClick={() => navigate('/')}
      >
        חזור לדף הבית
      </Button>

      {/* Decorative footer pattern */}
      <div className="mt-16 flex gap-2 items-center" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="rounded-full"
            style={{
              width: i === 3 ? 10 : i === 2 || i === 4 ? 7 : 5,
              height: i === 3 ? 10 : i === 2 || i === 4 ? 7 : 5,
              backgroundColor: '#B8973A',
              opacity: i === 3 ? 0.7 : i === 2 || i === 4 ? 0.45 : 0.25,
            }}
          />
        ))}
      </div>
    </div>
  );
}
