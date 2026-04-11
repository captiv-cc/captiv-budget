/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Design system dark palette – Monday-inspired
        dm: {
          bg:        '#1c1d2e',   // main background
          sidebar:   '#14152a',   // sidebar
          surface:   '#252637',   // card / panel
          elevated:  '#2f3048',   // modal / elevated
          hover:     '#363855',   // hover state
          border:    '#3c3e5a',   // standard border
          bsub:      '#272840',   // subtle border
          text:      '#dde0f5',   // primary text
          text2:     '#9295b5',   // secondary text
          text3:     '#5d6082',   // muted text
          accent:    '#5f62d5',   // Monday blue-purple
          'accent-h':'#4e51bf',   // accent hover
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'dm-sm':  '0 1px 4px rgba(0,0,0,0.4)',
        'dm-md':  '0 4px 16px rgba(0,0,0,0.5)',
        'dm-lg':  '0 8px 32px rgba(0,0,0,0.6)',
        'dm-xl':  '0 16px 48px rgba(0,0,0,0.7)',
      }
    }
  },
  plugins: []
}
