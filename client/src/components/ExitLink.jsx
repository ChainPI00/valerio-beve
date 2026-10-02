// "Esci" con conferma in due tempi (un doppio tocco non conferma). La stanza resta; il telefono torna alla home.
import { useState } from 'react';
import { leave } from '../lib/net.js';
import { sfx } from '../lib/audio.js';

export function ExitLink({ label = 'esci', confirm = 'Sicuro? Tocca di nuovo per uscire (la stanza resta)' }) {
  const [armedAt, setArmedAt] = useState(0);
  return (
    <button
      className={`link exit-link ${armedAt ? 'is-armed' : ''}`}
      onClick={() => {
        sfx.click();
        if (!armedAt) { setArmedAt(Date.now()); setTimeout(() => setArmedAt(0), 4000); return; }
        if (Date.now() - armedAt < 500) return;
        leave();
      }}
    >
      {armedAt ? confirm : label}
    </button>
  );
}
