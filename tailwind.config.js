/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // A warm dark palette: the surfaces carry a little red and yellow rather
      // than the usual blue, so long sessions read as lamplight instead of
      // moonlight, and amber can act as the accent without fighting the ground.
      colors: {
        base: {
          900: '#0d0b09',
          850: '#151210',
          800: '#1c1815',
          750: '#241f1a',
          700: '#2d2620',
          650: '#392f27',
          600: '#4a3d32'
        },
        edge: {
          DEFAULT: '#332b24',
          soft: '#241f1a',
          bright: '#4d4136'
        },
        ink: {
          DEFAULT: '#f0e9e1',
          dim: '#b3a595',
          faint: '#7c6d5e'
        },
        accent: {
          DEFAULT: '#e8913c',
          soft: '#4a2f16'
        },
        good: '#6fbf73',
        warn: '#e8b44c',
        bad: '#e06552',
        info: '#69b0b8',
        magic: '#b98ae0'
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'SF Mono', 'Menlo', 'Consolas', 'monospace'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif']
      },
      fontSize: {
        '2xs': ['10px', '14px'],
        xs: ['11px', '16px'],
        sm: ['12px', '18px'],
        base: ['13px', '20px'],
        md: ['14px', '21px']
      }
    }
  },
  plugins: []
}
