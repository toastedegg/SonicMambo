/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        syne: ['"Syne"', 'system-ui', 'sans-serif'],
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        sans: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        mono: ['"Space Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        zine: {
          paper: '#FFFBF0',
          cream: '#FFF4D8',
          sand: '#F5E9CE',
          ink: '#121212',
          muted: '#57534A',
        },
        neo: {
          lime: '#D8FF2E',
          'lime-dark': '#B4DB0A',
          cobalt: '#2B59FF',
          'cobalt-dark': '#1B3FCC',
          magenta: '#FF3B7F',
          'magenta-dark': '#D61E5F',
          amber: '#FF8A00',
          'amber-dark': '#CC6B00',
          mint: '#1CE088',
          'mint-dark': '#0EB56A',
          violet: '#8B5CF6',
        },
        brand: {
          green: '#1CE088',
          'green-dark': '#0EB56A',
          red: '#FF3B7F',
          'red-dark': '#D61E5F',
          blue: '#2B59FF',
          'blue-dark': '#1B3FCC',
          white: '#FFFFFF',
          gray: '#FFF4D8',
          'gray-dark': '#E6DAC0',
        },
        sp: {
          black: '#FFFBF0',
          base: '#FFFFFF',
          elevated: '#FFF4D8',
          highlight: '#D8FF2E',
          green: '#1CE088',
          'green-dark': '#0EB56A',
          text: '#121212',
          'text-sub': '#423E37',
          'text-muted': '#6E695F',
        },
      },
      boxShadow: {
        'brutal-xs': '2px 2px 0px #121212',
        'brutal-sm': '3px 3px 0px #121212',
        brutal: '4px 4px 0px #121212',
        'brutal-lg': '6px 6px 0px #121212',
        'brutal-xl': '8px 8px 0px #121212',
      },
      borderWidth: {
        '2.5': '2.5px',
      },
    },
  },
  plugins: [],
};
