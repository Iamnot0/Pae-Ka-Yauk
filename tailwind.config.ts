import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: 'var(--color-primary)',
        accent: 'var(--color-accent)',
        background: 'var(--color-background)',
        surface: 'var(--color-surface)',
        foreground: 'var(--color-foreground)',
        'muted-fg': 'var(--color-muted-fg)',
        border: 'var(--color-border)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        destructive: 'var(--color-destructive)',
      },
      fontFamily: {
        ui: ['var(--font-ui)'],
        display: ['var(--font-display)'],
        myanmar: ['var(--font-myanmar)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
      },
      spacing: {
        'safe-top': 'var(--safe-top)',
        'safe-right': 'var(--safe-right)',
        'safe-bottom': 'var(--safe-bottom)',
        'safe-left': 'var(--safe-left)',
      },
    },
  },
  plugins: [],
};

export default config;
