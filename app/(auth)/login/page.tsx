'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, LogIn, Moon, Sun } from 'lucide-react';
import { useT, useLocale } from '@/lib/i18n/useT';
import { useTheme } from '@/lib/theme/useTheme';

/* ─────────────────────────────────────────────────────────────
   Café drift animation
   - Coffee beans + wheat grains gently drifting
   - Each slowly rotates as it moves
   - Occasional soft gold sparkle (steam / warm light)
   - Warm brown + sepia on cream palette
   - Low density, elegant — not busy
   ──────────────────────────────────────────────────────────── */
function CafeDriftCanvas({ isDark }: { isDark: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Theme-aware particle palette — dark mode uses lighter caramel/gold tones
    // that stay visible on the deep-brown background; light mode keeps the
    // original rich cocoa/amber that pops against the cream.
    const colors = isDark
      ? { bean: '#C19A6B', beanCrease: 'rgba(26, 20, 14, 0.55)', wheat: '#D4A563' }
      : { bean: '#6B4423', beanCrease: 'rgba(250, 247, 242, 0.5)', wheat: '#A06E2E' };

    const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
    let W = window.innerWidth;
    let H = window.innerHeight;

    type Kind = 'bean' | 'wheat' | 'sparkle';

    interface Particle {
      kind: Kind;
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      rotation: number;
      spin: number;
      alpha: number;
      alphaTarget: number;
      life: number; // for sparkle — 0..1
    }

    const particles: Particle[] = [];

    const spawnBean = (x?: number, y?: number): Particle => ({
      kind: 'bean',
      x: x ?? Math.random() * W,
      y: y ?? Math.random() * H,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25 + 0.04, // very slight downward drift
      size: 10 + Math.random() * 7,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.004,
      alpha: 0,
      alphaTarget: 0.18 + Math.random() * 0.14,
      life: 0,
    });

    const spawnWheat = (x?: number, y?: number): Particle => ({
      kind: 'wheat',
      x: x ?? Math.random() * W,
      y: y ?? Math.random() * H,
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2 + 0.02,
      size: 6 + Math.random() * 4,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.006,
      alpha: 0,
      alphaTarget: 0.14 + Math.random() * 0.1,
      life: 0,
    });

    const spawnSparkle = (): Particle => ({
      kind: 'sparkle',
      x: Math.random() * W,
      y: Math.random() * H,
      vx: 0,
      vy: 0,
      size: 2 + Math.random() * 2.5,
      rotation: 0,
      spin: 0,
      alpha: 0,
      alphaTarget: 0.55 + Math.random() * 0.25,
      life: 0,
    });

    const BEAN_COUNT = 18;
    const WHEAT_COUNT = 14;

    const seed = () => {
      particles.length = 0;
      for (let i = 0; i < BEAN_COUNT; i++) particles.push(spawnBean());
      for (let i = 0; i < WHEAT_COUNT; i++) particles.push(spawnWheat());
    };

    const resize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      seed();
    };
    resize();
    window.addEventListener('resize', resize);

    // Gold sparkle spawner (steam / warm-light accents)
    const sparkleInterval = window.setInterval(() => {
      if (particles.filter(p => p.kind === 'sparkle').length < 5) {
        particles.push(spawnSparkle());
      }
    }, 1400);

    // ------ Drawing primitives ------
    const drawBean = (p: Particle) => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.globalAlpha = p.alpha;

      // Bean outline — elongated oval
      ctx.fillStyle = colors.bean;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();

      // Bean crease — curved line through middle
      ctx.strokeStyle = colors.beanCrease;
      ctx.lineWidth = p.size * 0.09;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-p.size * 0.78, 0);
      ctx.bezierCurveTo(
        -p.size * 0.25, -p.size * 0.22,
        p.size * 0.25, p.size * 0.22,
        p.size * 0.78, 0
      );
      ctx.stroke();

      ctx.restore();
    };

    const drawWheat = (p: Particle) => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.globalAlpha = p.alpha;

      const grainColor = colors.wheat;

      // Center stem
      ctx.strokeStyle = grainColor;
      ctx.lineWidth = p.size * 0.14;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -p.size * 1.2);
      ctx.lineTo(0, p.size * 1.2);
      ctx.stroke();

      // Grain clusters — 3 pairs of angled ovals
      ctx.fillStyle = grainColor;
      for (let i = -1; i <= 1; i++) {
        const y = i * p.size * 0.55;
        for (const side of [-1, 1]) {
          ctx.save();
          ctx.translate(side * p.size * 0.35, y);
          ctx.rotate(side * 0.6);
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size * 0.45, p.size * 0.18, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      ctx.restore();
    };

    const drawSparkle = (p: Particle) => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.globalAlpha = p.alpha;

      // Soft radial glow
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size * 3);
      grad.addColorStop(0, 'rgba(184, 134, 11, 0.9)');
      grad.addColorStop(0.5, 'rgba(184, 134, 11, 0.25)');
      grad.addColorStop(1, 'rgba(184, 134, 11, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, p.size * 3, 0, Math.PI * 2);
      ctx.fill();

      // Bright core
      ctx.fillStyle = 'rgba(255, 220, 140, 1)';
      ctx.beginPath();
      ctx.arc(0, 0, p.size * 0.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    };

    let animId = 0;

    const draw = () => {
      ctx.clearRect(0, 0, W, H);

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];

        // Fade in/out behaviour
        if (p.kind === 'sparkle') {
          p.life += 0.012;
          // parabolic life curve: fade in, hold, fade out
          p.alpha = Math.sin(Math.min(Math.max(p.life, 0), 1) * Math.PI) * p.alphaTarget;
          if (p.life >= 1) {
            particles.splice(i, 1);
            continue;
          }
        } else {
          // drift + rotate
          p.x += p.vx;
          p.y += p.vy;
          p.rotation += p.spin;

          // ease to target alpha on spawn
          p.alpha += (p.alphaTarget - p.alpha) * 0.02;

          // wrap around edges with margin
          const m = 40;
          if (p.x < -m) p.x = W + m;
          else if (p.x > W + m) p.x = -m;
          if (p.y < -m) p.y = H + m;
          else if (p.y > H + m) p.y = -m;
        }

        if (p.kind === 'bean') drawBean(p);
        else if (p.kind === 'wheat') drawWheat(p);
        else drawSparkle(p);
      }

      animId = requestAnimationFrame(draw);
    };
    animId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animId);
      window.clearInterval(sparkleInterval);
      window.removeEventListener('resize', resize);
    };
  }, [isDark]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}
    />
  );
}

/* ─────────────────────────────────────────────────────────────
   Login Page
   ──────────────────────────────────────────────────────────── */
export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useT();
  const { locale, setLocale } = useLocale();
  const { resolvedTheme, toggle: toggleTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  // Theme-aware palette for the login surface. Brand tones stay warm (brown
  // in light, caramel in dark) so the café aesthetic carries across themes
  // instead of snapping to a generic grey "dark theme."
  const palette = isDark
    ? {
        gradient: 'linear-gradient(135deg, #1A140E 0%, #22190F 50%, #1E160C 100%)',
        textStrong: '#F5E8D4',
        warmHigh: 'rgba(245, 232, 212, 0.90)',
        warmMed:  'rgba(245, 232, 212, 0.60)',
        warmLow:  'rgba(245, 232, 212, 0.38)',
        warmFaint:'rgba(245, 232, 212, 0.22)',
        surfaceTrans: 'rgba(245, 232, 212, 0.06)',
        surfaceSolid: 'rgba(245, 232, 212, 0.10)',
        surfaceFocus: 'rgba(245, 232, 212, 0.14)',
        borderSubtle: 'rgba(245, 232, 212, 0.18)',
        borderStrong: 'rgba(245, 232, 212, 0.28)',
        focusBorder: 'rgba(212, 168, 67, 0.75)',
        focusRing:   'rgba(212, 168, 67, 0.20)',
        buttonShadow:'0 4px 14px rgba(0, 0, 0, 0.45)',
      }
    : {
        gradient: 'linear-gradient(135deg, #FAF7F2 0%, #F5EFE6 50%, #EDE3D1 100%)',
        textStrong: '#3C2A1F',
        warmHigh: 'rgba(107, 68, 35, 0.75)',
        warmMed:  'rgba(107, 68, 35, 0.55)',
        warmLow:  'rgba(107, 68, 35, 0.40)',
        warmFaint:'rgba(107, 68, 35, 0.20)',
        surfaceTrans: 'rgba(255, 255, 255, 0.50)',
        surfaceSolid: 'rgba(255, 255, 255, 0.85)',
        surfaceFocus: 'rgba(255, 255, 255, 0.85)',
        borderSubtle: 'rgba(107, 68, 35, 0.15)',
        borderStrong: 'rgba(107, 68, 35, 0.25)',
        focusBorder: 'rgba(184, 134, 11, 0.70)',
        focusRing:   'rgba(184, 134, 11, 0.12)',
        buttonShadow:'0 4px 14px rgba(107, 68, 35, 0.25)',
      };

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        const from = searchParams.get('from') ?? '/';
        router.push(from);
        router.refresh();
      } else if (res.status === 401 || res.status === 400) {
        // Only these two mean "your credentials didn't work"
        setError(t('auth.invalidCreds'));
      } else if (res.status === 503) {
        // Database unreachable — most common with Neon free-tier cold-start
        setError(t('auth.serviceDown'));
      } else {
        setError(t('auth.serverError'));
      }
    } catch {
      // Network error before we even got a response (offline, DNS fail, etc.)
      setError(t('auth.connectionError'));
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: CSSProperties = {
    width: '100%',
    padding: '14px 16px',
    background: palette.surfaceSolid,
    border: `1px solid ${palette.borderStrong}`,
    borderRadius: '10px',
    color: palette.textStrong,
    fontSize: '16px',
    fontWeight: 500,
    outline: 'none',
    fontFamily: 'inherit',
    transition: 'border-color 0.2s, background 0.2s, box-shadow 0.2s',
    backdropFilter: 'blur(4px)',
  };

  return (
    <div
      className="login-container"
      style={{
        background: palette.gradient,
        fontFamily: 'var(--font-ui), var(--font-myanmar), system-ui, sans-serif',
      }}
    >
      {/* Animated background — drifting coffee beans + wheat grains + gold sparkles */}
      <CafeDriftCanvas isDark={isDark} />

      {/* Top-right: theme + language toggles */}
      <div
        className="login-toggles"
        style={{ display: 'flex', gap: 8 }}
      >
        <button
          type="button"
          onClick={toggleTheme}
          style={{
            background: palette.surfaceTrans,
            border: `1px solid ${palette.borderSubtle}`,
            borderRadius: '9999px',
            padding: '6px 10px',
            color: palette.warmHigh,
            cursor: 'pointer',
            backdropFilter: 'blur(6px)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={isDark ? 'Light mode' : 'Dark mode'}
        >
          {isDark ? <Sun size={14} strokeWidth={2} /> : <Moon size={14} strokeWidth={2} />}
        </button>
        <button
          type="button"
          onClick={() => setLocale(locale === 'my' ? 'en' : 'my')}
          style={{
            background: palette.surfaceTrans,
            border: `1px solid ${palette.borderSubtle}`,
            borderRadius: '9999px',
            padding: '6px 14px',
            fontSize: '12px',
            fontWeight: 600,
            color: palette.warmHigh,
            cursor: 'pointer',
            backdropFilter: 'blur(6px)',
          }}
          aria-label="Toggle language"
        >
          {locale === 'my' ? 'MY' : 'EN'}
        </button>
      </div>

      <div className="login-content-wrapper">
        {/* ── Left: Welcome panel ── */}
        <div
          className="login-welcome-panel"
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px',
            position: 'relative',
            zIndex: 1,
          }}
        >
          <div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '3px',
                textTransform: 'uppercase',
                color: palette.warmMed,
                marginBottom: 20,
              }}
            >
              {t('auth.tagline')}
            </div>

            <h1
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'clamp(32px, 5vw, 46px)',
                fontWeight: 800,
                color: palette.textStrong,
                lineHeight: 1.2,
                letterSpacing: '-0.5px',
                marginBottom: 24,
              }}
            >
              {t('auth.welcome')}
              <br />
              <span style={{ color: 'var(--color-primary)', whiteSpace: 'nowrap' }}>
                Pae Ka Yauk
                <span
                  style={{
                    color: palette.warmLow,
                    margin: '0 0.35em',
                    fontWeight: 400,
                  }}
                >
                  -
                </span>
                <span
                  lang="my"
                  style={{
                    fontFamily: 'var(--font-myanmar)',
                    color: 'var(--color-accent)',
                  }}
                >
                  ပဲကရောက်
                </span>
              </span>
            </h1>

            <p
              style={{
                fontSize: '16px',
                fontWeight: 500,
                color: palette.warmHigh,
                marginBottom: 12,
                fontStyle: 'italic',
              }}
            >
              {t('auth.shopType')}
            </p>

            <p
              style={{
                fontSize: '12px',
                fontWeight: 600,
                letterSpacing: '4px',
                color: palette.warmMed,
                textTransform: 'uppercase',
              }}
            >
              {t('auth.since')}
            </p>
          </div>
        </div>

        {/* ── Vertical divider ── */}
        <div
          className="login-divider"
          style={{
            width: '1px',
            alignSelf: 'stretch',
            margin: '60px 0',
            background: `linear-gradient(to bottom, transparent 0%, ${palette.warmFaint} 50%, transparent 100%)`,
            position: 'relative',
            zIndex: 1,
            flexShrink: 0,
          }}
        />

        {/* ── Right: Form panel ── */}
        <div
          className="login-form-panel"
          style={{
            width: '460px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px 56px',
            marginRight: '64px',
            position: 'relative',
            zIndex: 1,
          }}
        >
          <div style={{ width: '100%', maxWidth: '340px' }}>
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '26px',
                fontWeight: 800,
                color: palette.textStrong,
                textAlign: 'center',
                marginBottom: 32,
                marginTop: 0,
                letterSpacing: '-0.3px',
              }}
            >
              {t('auth.signIn')}
            </h2>

            <form onSubmit={handleLogin}>
              {/* Email */}
              <div style={{ marginBottom: 12 }}>
                <input
                  type="email"
                  placeholder={t('auth.email')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  style={inputStyle}
                  onFocus={(e) => {
                    e.target.style.borderColor = palette.focusBorder;
                    e.target.style.background = palette.surfaceFocus;
                    e.target.style.boxShadow = `0 0 0 3px ${palette.focusRing}`;
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = palette.borderStrong;
                    e.target.style.background = palette.surfaceSolid;
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              {/* Password */}
              <div style={{ marginBottom: 20, position: 'relative' }}>
                <input
                  type={showPass ? 'text' : 'password'}
                  placeholder={t('auth.password')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  style={{ ...inputStyle, paddingRight: '44px' }}
                  onFocus={(e) => {
                    e.target.style.borderColor = palette.focusBorder;
                    e.target.style.background = palette.surfaceFocus;
                    e.target.style.boxShadow = `0 0 0 3px ${palette.focusRing}`;
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = palette.borderStrong;
                    e.target.style.background = palette.surfaceSolid;
                    e.target.style.boxShadow = 'none';
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  style={{
                    position: 'absolute',
                    right: 14,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--color-muted-fg)',
                    display: 'flex',
                    padding: 0,
                    minHeight: 'auto',
                  }}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                >
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              {/* Error */}
              {error && (
                <div
                  role="alert"
                  style={{
                    marginBottom: 16,
                    padding: '10px 14px',
                    background: 'rgba(139, 38, 53, 0.08)',
                    border: '1px solid rgba(139, 38, 53, 0.25)',
                    borderRadius: '10px',
                    color: 'var(--color-destructive)',
                    fontSize: '13px',
                    textAlign: 'center',
                  }}
                >
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: loading ? palette.warmMed : 'var(--color-primary)',
                  border: 'none',
                  borderRadius: '10px',
                  color: '#ffffff',
                  fontSize: '15px',
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  fontFamily: 'inherit',
                  transition: 'background 0.2s, transform 0.1s',
                  letterSpacing: '0.3px',
                  boxShadow: palette.buttonShadow,
                }}
                onMouseEnter={(e) => {
                  if (!loading) {
                    (e.currentTarget as HTMLButtonElement).style.background =
                      'var(--color-accent)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!loading) {
                    (e.currentTarget as HTMLButtonElement).style.background =
                      'var(--color-primary)';
                  }
                }}
              >
                {loading ? (
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      border: '2px solid rgba(255, 255, 255, 0.35)',
                      borderTopColor: '#ffffff',
                      borderRadius: '50%',
                      animation: 'spin 0.7s linear infinite',
                    }}
                  />
                ) : (
                  <LogIn size={18} />
                )}
                {loading ? t('auth.signingIn') : t('auth.signIn')}
              </button>
            </form>

            <p
              style={{
                marginTop: 28,
                textAlign: 'center',
                fontSize: '11.5px',
                color: palette.warmLow,
                letterSpacing: '0.3px',
              }}
            >
              &copy; Pae Ka Yauk · ပဲကရောက်
            </p>
          </div>
        </div>
      </div>

      {/* ── Bottom-left brand — hidden on mobile ── */}
      <div
        className="login-desktop-only"
        style={{ color: palette.warmLow }}
      >
        V.0.1.0 · POWERED BY MRROBOT
      </div>
    </div>
  );
}
