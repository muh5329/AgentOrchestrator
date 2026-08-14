/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: {
          900: '#08090b',
          850: '#0b0d10',
          800: '#101318',
          750: '#141821',
          700: '#1a1f2a',
          650: '#222834',
          600: '#2c3340'
        },
        edge: {
          DEFAULT: '#232936',
          soft: '#1b2029',
          bright: '#333c4d'
        },
        ink: {
          DEFAULT: '#e6e9ef',
          dim: '#98a1b3',
          faint: '#5f6a7d'
        },
        accent: {
          DEFAULT: '#5b8cff',
          soft: '#2a3a63'
        },
        good: '#3fbf7f',
        warn: '#e0a33e',
        bad: '#e5484d',
        info: '#57b8d6',
        magic: '#a37bf0'
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
