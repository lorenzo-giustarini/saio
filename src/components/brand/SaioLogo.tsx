import { cn } from '@/lib/utils'

interface SaioIconProps {
  className?: string
  size?: number
  /** 'color' uses the real Neural Nexus PNG (cropped from Ideogram generation).
   *  'mono' is a simplified SVG silhouette for currentColor usage. */
  variant?: 'color' | 'mono'
}

/**
 * SAIO icon — Neural Nexus (Proposal 1, Ideogram V3 QUALITY).
 * Source: public/brand/saio-icon-transparent.png (512×512, BG alpha-keyed)
 * For print / single-color contexts use variant="mono" (SVG silhouette).
 */
export function SaioIcon({ className, size = 28, variant = 'color' }: SaioIconProps) {
  if (variant === 'mono') {
    // Simplified monochrome silhouette (approximate Neural Nexus pattern)
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 100 100"
        width={size}
        height={size}
        className={cn('shrink-0', className)}
        aria-label="SAIO"
        role="img"
      >
        <g fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M 30 14 L 30 30 Q 30 38 38 38 L 46 38" />
          <path d="M 70 14 L 70 30 Q 70 38 62 38 L 54 38" />
          <path d="M 88 34 L 72 34 Q 64 34 64 42 L 64 50" />
          <path d="M 88 66 L 72 66 Q 64 66 64 58 L 64 50" />
          <path d="M 70 86 L 70 70 Q 70 62 62 62 L 54 62" />
          <path d="M 30 86 L 30 70 Q 30 62 38 62 L 46 62" />
          <path d="M 12 66 L 28 66 Q 36 66 36 58 L 36 50" />
          <path d="M 12 34 L 28 34 Q 36 34 36 42 L 36 50" />
        </g>
        <circle cx="50" cy="50" r="6" fill="currentColor" />
      </svg>
    )
  }

  return (
    <img
      src="/brand/saio-icon-transparent.png"
      alt="SAIO"
      width={size}
      height={size}
      className={cn('shrink-0 select-none', className)}
      draggable={false}
      style={{ imageRendering: 'auto' }}
    />
  )
}

interface SaioLogoProps {
  className?: string
  iconSize?: number
  showTagline?: boolean
  wordmarkSize?: 'sm' | 'md' | 'lg'
}

/**
 * Full SAIO horizontal lockup: Neural Nexus icon + lowercase wordmark + optional tagline.
 */
export function SaioLogo({ className, iconSize = 36, showTagline = true, wordmarkSize = 'md' }: SaioLogoProps) {
  const wordmarkClasses = {
    sm: 'text-lg',
    md: 'text-xl',
    lg: 'text-2xl',
  }[wordmarkSize]

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <SaioIcon size={iconSize} />
      <div className="flex flex-col leading-none">
        <span
          className={cn('font-bold tracking-tight text-white', wordmarkClasses)}
          style={{ letterSpacing: '-0.05em' }}
        >
          saio
        </span>
        {showTagline && (
          <span className="text-[9px] text-violet-400 tracking-[0.15em] mt-0.5">Smart AI Office</span>
        )}
      </div>
    </div>
  )
}
