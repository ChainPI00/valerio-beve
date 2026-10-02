import { createRoot } from 'react-dom/client';
import gsap from 'gsap';
import { App } from './App.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
// Font serviti dal nostro server (niente dipendenza da Google Fonts col Wi-Fi lento del locale)
import '@fontsource/bagel-fat-one/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-700.css';
import './styles.css';

// Le animazioni seguono il tempo reale, non i frame: se il telefono perde frame
// (o torna dal background) la timeline recupera invece di rallentare e perdere la sincronia.
gsap.ticker.lagSmoothing(0);
if (import.meta.env.DEV) window.__gsap = gsap;

// Niente StrictMode: il doppio mount in dev farebbe partire due volte suoni e timeline
createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
