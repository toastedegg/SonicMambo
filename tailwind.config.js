/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Nunito', 'system-ui', 'sans-serif'],
        sans: ['Nunito', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          green: '#58CC02',
          'green-dark': '#46A302',
          red: '#FF4B4B',
          'red-dark': '#E00000',
          blue: '#1CB0F6',
          'blue-dark': '#1899D6',
          white: '#FFFFFF',
          gray: '#F7F7F7',
          'gray-dark': '#E5E5E5',
        },
        sp: {
          black: '#121212',
          base: '#181818',
          elevated: '#282828',
          highlight: '#333333',
          green: '#1DB954',
          'green-dark': '#1AA34A',
          text: '#FFFFFF',
          'text-sub': '#B3B3B3',
          'text-muted': '#6A6A6A',
        },
      },
    },
  },
  plugins: [],
}
