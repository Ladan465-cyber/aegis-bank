export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#0A0C24', 900: '#0E1130', 800: '#161A44', 700: '#222760', 600: '#343A7E', 400: '#7B80B8', 200: '#C9CCE8' },
        brand: { DEFAULT: '#3341E8', 600: '#2A36C9', 100: '#DDE1FF', 50: '#EEF0FF' },
        paper: '#F4F5FA',
        safe: '#0E9F6E', warn: '#D99200', alert: '#EA5A24', danger: '#D62B48',
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        sans: ['"Instrument Sans"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
