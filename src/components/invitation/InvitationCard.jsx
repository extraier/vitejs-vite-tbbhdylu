import { Heart } from 'lucide-react';
import { getTemplate } from './templates';

// Default sizes match the existing PersonalGuestPortal card (max-w-md ≈ 448px).
// QR is generated client-side via api.qrserver.com — no Cloud Function needed for preview.
const QR_SIZE = 180;

export function InvitationCard({
  templateId = 'plain',
  bgUrl = null,
  event,
  guest,
  ownerMessage = '',
  shareUrl,
  className = '',
}) {
  const t = getTemplate(templateId);

  // Build the layered card: bg image (if any) → palette wash → text → QR
  const cardStyle = {
    backgroundColor: t.palette.bg,
    backgroundImage: bgUrl ? `url(${bgUrl})` : undefined,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    color: t.palette.text,
  };

  return (
    <div
      className={`relative w-full rounded-[2rem] overflow-hidden shadow-xl border border-black/5 ${className}`}
      style={cardStyle}
      data-testid="invitation-card"
    >
      {/* Dark overlay on top of bg image for text legibility */}
      {bgUrl && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.15) 40%, rgba(0,0,0,0.55) 100%)',
          }}
        />
      )}

      {/* Decorative top rule — different per layout */}
      {t.layout === 'ornate' && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 z-10">
          <span className="w-12 h-px" style={{ backgroundColor: t.palette.accent }} />
          <Heart className="w-4 h-4 fill-current" style={{ color: t.palette.accent }} />
          <span className="w-12 h-px" style={{ backgroundColor: t.palette.accent }} />
        </div>
      )}

      <div className="relative z-10 p-8 text-center">
        {/* Header */}
        <p
          className="text-xs font-black tracking-[0.3em] mb-2"
          style={{ color: bgUrl ? '#fff' : t.palette.accent }}
        >
          ELECTRONIC INVITATION
        </p>
        <h2
          className="text-2xl font-black mb-1 leading-tight"
          style={{ color: bgUrl ? '#fff' : t.palette.text }}
        >
          {event?.name || '婚禮晚宴'}
        </h2>
        {event?.date && (
          <p
            className="text-sm font-bold mb-6"
            style={{ color: bgUrl ? '#fff' : t.palette.muted }}
          >
            {event.date} {event.time && `· ${event.time}`}
          </p>
        )}

        {/* Divider */}
        <div className="flex items-center gap-3 my-4">
          <span className="flex-1 h-px" style={{ backgroundColor: t.palette.accent, opacity: 0.4 }} />
          <Heart className="w-4 h-4 fill-current" style={{ color: t.palette.accent }} />
          <span className="flex-1 h-px" style={{ backgroundColor: t.palette.accent, opacity: 0.4 }} />
        </div>

        {/* Guest greeting */}
        {guest?.name && (
          <p
            className="text-sm mb-1"
            style={{ color: bgUrl ? '#fff' : t.palette.muted }}
          >
            親愛的
          </p>
        )}
        {guest?.name && (
          <h3
            className="text-3xl font-black mb-4"
            style={{ color: bgUrl ? '#fff' : t.palette.text }}
          >
            {guest.name}
          </h3>
        )}

        {/* Owner message */}
        {ownerMessage && (
          <p
            className="text-sm italic mb-6 px-2 leading-relaxed"
            style={{ color: bgUrl ? '#fff' : t.palette.muted }}
          >
            "{ownerMessage}"
          </p>
        )}

        {/* Wedding info — only show fields that exist */}
        <div className="space-y-2 my-6 text-sm">
          {event?.venue && (
            <div className="flex items-center justify-center gap-2">
              <span className="font-bold" style={{ color: t.palette.accent }}>場地：</span>
              <span style={{ color: bgUrl ? '#fff' : t.palette.text }}>{event.venue}</span>
            </div>
          )}
          {event?.address && (
            <p className="text-xs" style={{ color: bgUrl ? 'rgba(255,255,255,0.8)' : t.palette.muted }}>
              {event.address}
            </p>
          )}
        </div>

        {/* QR */}
        {shareUrl && (
          <div
            className="inline-block bg-white/95 p-3 rounded-2xl mt-4"
            style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}
          >
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=${QR_SIZE}x${QR_SIZE}&data=${encodeURIComponent(shareUrl)}&color=312e81&bgcolor=ffffff`}
              alt="QR code"
              className="rounded-lg"
              style={{ width: QR_SIZE, height: QR_SIZE }}
            />
            <p className="text-[10px] text-slate-500 mt-2 font-mono">
              入場請出示此 QR Code
            </p>
          </div>
        )}

        {/* Footer */}
        <p
          className="text-[10px] mt-6 font-mono"
          style={{ color: bgUrl ? 'rgba(255,255,255,0.6)' : t.palette.muted }}
        >
          Save The Day · 囍程
        </p>
      </div>
    </div>
  );
}