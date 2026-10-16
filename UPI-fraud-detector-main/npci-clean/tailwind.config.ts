import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  // BUG FIX: safelist ensures animate-slide-up is never purged in production build
  safelist: ['animate-slide-up'],
  theme: { extend: {} },
  plugins: [],
}
export default config
