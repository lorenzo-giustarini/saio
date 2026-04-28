# SAIO Brand Kit

> **SAIO** = **S**mart **A**rtificial **I**ntelligence **O**ffice
>
> Logo direction scelta: **Proposal 1 — Neural Nexus** (generata con Ideogram V3 QUALITY, ridisegnata in vettoriale).
>
> Icona: 8 "bracci neurali" arrotondati in disposizione esagonale che convergono verso un core luminoso centrale. Metafora: rete neurale + hub operativo.
>
> Wordmark: `saio` lowercase in sans-serif geometrico rounded (peso 700).

## Colori ufficiali

| Token | Hex | Uso |
|-------|-----|-----|
| Violet 50 | `#f5f3ff` | highlight wordmark top |
| Violet 200 | `#ddd6fe` | anello orbitale, flash luminoso |
| Violet 300 | `#c4b5fd` | disc gradient start |
| **Violet 400** | **`#a78bfa`** | **primary brand color** |
| Violet 500 | `#8b5cf6` | secondary |
| Violet 600 | `#7c3aed` | disc gradient end, dark accent |
| Background | `#0a0a0a` | canvas nero puro |

## File

| File | Dimensioni | Uso |
|------|------------|-----|
| `saio-icon.svg` | 100×100 | Icon-only con gradient — avatar, app icon, hero |
| `saio-icon-mono.svg` | 100×100 | Icon-only single-color (currentColor) — print, monochrome UI, dark/light |
| `saio-wordmark.svg` | 200×60 | Solo wordmark "SAIO" — header slim |
| `saio-lockup-horizontal.svg` | 420×120 | Icon + wordmark + tagline orizzontale |
| `saio-lockup-vertical.svg` | 200×240 | Icon + wordmark stacked verticale |
| `saio-logo-raster-master.png` | 1792×1024 | PNG master originale (riferimento, non usare in UI) |
| `/favicon.svg` *(root)* | 64×64 | Favicon ottimizzato (tratti più spessi per 16px) |

## Come usare nel codice

**React component** (`src/components/brand/SaioLogo.tsx`):

```tsx
import { SaioIcon, SaioLogo } from '@/components/brand/SaioLogo'

// Solo icon (gradient)
<SaioIcon size={32} />

// Monochrome (eredita currentColor da className)
<SaioIcon size={24} variant="mono" className="text-violet-300" />

// Lockup completo con tagline
<SaioLogo iconSize={32} showTagline wordmarkSize="md" />
```

**HTML** (per pagine statiche):

```html
<img src="/brand/saio-lockup-horizontal.svg" alt="SAIO" width="420" height="120" />
```

## Regole (DO / DON'T)

### ✅ DO
- Usa sempre **su sfondo scuro** (`#0a0a0a` o gradient dark)
- Mantieni **margine minimo 16px** attorno al logo (spazio di rispetto)
- Per favicon/app-icon usa sempre `favicon.svg` (semplificato)
- Per monochrome usa solo i file `-mono.svg`

### ❌ DON'T
- ❌ Non cambiare i colori del gradient (fuori dalla violet scale ufficiale)
- ❌ Non ruotare il logo (l'anello è già a -22°)
- ❌ Non distorcere proporzioni (keep aspect ratio)
- ❌ Non mettere il logo su sfondi chiari senza la variante mono/invertita
- ❌ Non aggiungere effetti extra (shadow drop, bevel, ecc.)

## Storico generazione

| Step | Tool | Output |
|------|------|--------|
| 1. 3 proposte PNG | Ideogram V3 QUALITY + Recraft V4 (fal.ai) | `dashboard/data/saio-logo-proposals/proposal-{1,2,3}.png` |
| 2. Scelta user | **Proposal 1 — Neural Nexus** (concept cervello/rete neurale) | — |
| 3. Vettoriale | SVG redraw manuale 8-arms hexagonal pattern con core gradient + glow filter | `saio-icon.svg` + 4 varianti |
| 4. Integrazione UI | Sidebar + favicon + index.html meta | `src/components/brand/SaioLogo.tsx` |

**Data consegna:** 2026-04-23 (V10-04)

## Anatomia del disegno SVG

**Icona (viewBox 100×100):**
- **8 neural arms**: path `M start L mid Q corner bend L end`, stroke `url(#saio-nn-stroke)` (gradient violet 300→600), stroke-width 7, linecap round, arrangement hexagonale a 45° intervals
- **Core centrale**: `circle cx=50 cy=50 r=8 fill=url(#saio-nn-core)` (radial gradient white→violet) con `feGaussianBlur stdDeviation=2` per il glow
- **Highlight interno**: `circle r=3 fill=white` sopra il core

**Favicon (viewBox 64×64):**
- Stessa geometria scalata, stroke-width 4.5, BG rounded-rect nero `#0a0a0a` rx=12
- Ottimizzato per 16px → arms più spessi, core più grande relativo
