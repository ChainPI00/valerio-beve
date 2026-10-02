import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Target ampio: anche iPhone fermi a iOS 15 e browser più vecchi devono vedere il gioco
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 900, target: ['es2019', 'safari14', 'chrome87', 'firefox78', 'edge88'] },
});
