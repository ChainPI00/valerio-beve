// Rete di sicurezza: se una schermata va in errore niente pagina bianca.
// Mostriamo un messaggio e ricarichiamo: la sessione salvata riporta il telefono in partita.
import { Component } from 'react';
import { reportError } from '../lib/net.js';

const KEY = 'vb:crashReloads';

export class ErrorBoundary extends Component {
  state = { failed: false, loop: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    reportError(error?.message || error, (info?.componentStack || '').split('\n').slice(0, 3).join(' '));
    let recent = [];
    try { recent = JSON.parse(sessionStorage.getItem(KEY) || '[]').filter((t) => Date.now() - t < 60000); } catch {}
    if (recent.length >= 2) { this.setState({ loop: true }); return; } // evitiamo un ciclo di ricariche
    try { sessionStorage.setItem(KEY, JSON.stringify([...recent, Date.now()])); } catch {}
    setTimeout(() => location.reload(), 2200);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="crash">
        <div className="crash-emoji">🍺💥</div>
        <h1>Ops!</h1>
        <p>{this.state.loop ? 'Qualcosa non va su questo telefono.' : 'Il telefono ha bevuto troppo. Ti riportiamo in partita…'}</p>
        <button onClick={() => location.reload()}>Ricarica</button>
      </div>
    );
  }
}
