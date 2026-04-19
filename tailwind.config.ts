import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          green: '#1DB954',
          greenDark: '#169c46',
          bg: '#0e0e0e',
          panel: '#181818',
          card: '#212121',
          border: '#2a2a2a',
          text: '#e5e5e5',
          muted: '#9a9a9a',
          up: '#22c55e',
          down: '#ef4444',
          chart: '#1e222d',
          yellow: '#ffeb3b',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
