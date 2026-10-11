import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths work in both the browser preview and Capacitor's Android WebView.
  base: './',
});
