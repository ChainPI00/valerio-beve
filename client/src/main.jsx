import { createRoot } from 'react-dom/client';
import gsap from 'gsap';
import { App } from './App.jsx';
import './styles.css';

// Le animazioni seguono il tempo reale, non i frame: se il telefono perde frame
// (o torna dal background) la timeline recupera invece di rallentare e perdere la sincronia.
gsap.ticker.lagSmoothing(0);
if (import.meta.env.DEV) window.__gsap = gsap;

// Niente StrictMode: il doppio mount in dev farebbe partire due volte suoni e timeline
createRoot(document.getElementById('root')).render(<App />);
