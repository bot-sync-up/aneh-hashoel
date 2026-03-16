/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Spec-defined shorthand tokens
        navy: {
          DEFAULT: '#1B2B5E',
          dark: '#0F1A3A',
          light: '#2a3f7e',
        },
        gold: {
          DEFAULT: '#B8973A',
          light: '#C9A84C',
          pale: '#f0e4b8',
        },
        cream: {
          DEFAULT: '#F8F6F1',
          dark: '#ede8df',
        },
        // Extended brand tokens (legacy — kept for existing components)
        brand: {
          navy: '#1B2B5E',
          'navy-light': '#2A3F7E',
          'navy-dark': '#111D42',
          gold: '#B8973A',
          'gold-light': '#D4AF57',
          'gold-dark': '#9A7C2E',
          bg: '#F8F6F1',
          'bg-muted': '#EDE9E0',
        },
        dark: {
          bg: '#0F1A3A',
          surface: '#1A2F5E',
          'surface-raised': '#223570',
          border: '#2A3F7E',
          accent: '#C9A84C',
          'accent-light': '#DFC070',
          text: '#E8E0CC',
          'text-muted': '#9BA8C4',
        },
        status: {
          pending: '#F59E0B',
          'pending-bg': '#FEF3C7',
          in_process: '#3B82F6',
          'in_process-bg': '#EFF6FF',
          answered: '#10B981',
          'answered-bg': '#ECFDF5',
          hidden: '#6B7280',
          'hidden-bg': '#F3F4F6',
          urgent: '#EF4444',
          'urgent-bg': '#FEF2F2',
          hot: '#F97316',
          'hot-bg': '#FFF7ED',
        },
      },
      fontFamily: {
        heebo: ['Heebo', 'Assistant', 'Arial', 'sans-serif'],
        sans: ['Heebo', 'Assistant', 'Arial', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '8px',
        card: '12px',
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
      },
      boxShadow: {
        soft: '0 2px 8px rgba(27, 43, 94, 0.08)',
        card: '0 4px 16px rgba(27, 43, 94, 0.10)',
        'card-hover': '0 8px 24px rgba(27, 43, 94, 0.14)',
        'dark-soft': '0 2px 8px rgba(0, 0, 0, 0.25)',
        'dark-card': '0 4px 16px rgba(0, 0, 0, 0.35)',
      },
      spacing: {
        sidebar: '256px',
        'sidebar-collapsed': '72px',
      },
      transitionDuration: {
        DEFAULT: '200ms',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'fade-in-up': 'fadeInUp 0.25s ease-out',
        'slide-in-right': 'slideInRight 0.25s ease-out',
        'slide-in-left': 'slideInLeft 0.25s ease-out',
        'scale-in': 'scaleIn 0.15s ease-out',
        'spin-slow': 'spin 1.5s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        slideInLeft: {
          '0%': { opacity: '0', transform: 'translateX(-20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
