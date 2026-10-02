# 🎓 Guida per la serata

Sito: **https://valerio-beve-production.up.railway.app** · TV: `…/tv/CODICE`

## Il giorno prima

- [ ] Domande, penitenze (nell'ordine in cui volete farle uscire), foto e meme caricati dal pannello host
- [ ] **Pack di backup scaricato** (pannello host → Info → Scarica pack)
- [ ] Credito/piano Railway attivo (dashboard Railway → piano Hobby o credito residuo)
- [ ] Prova con 4–5 telefoni veri, almeno un iPhone e un Android
- [ ] Nessun aggiornamento del sito da qui in poi

## Alla festa, prima di iniziare

1. **Host**: apre il sito → *Crea partita* → nome + PIN. In alto compare **STANZA XXXX** (4 lettere).
2. **TV** (se c'è): dal browser della TV o di un portatile collegato via HDMI apri `…/tv/XXXX` e clicca una volta (sblocca l'audio).
3. **Tutti**: aprono il sito → *Entra* → le 4 lettere → nome. Oppure QR sulla TV, oppure il link che l'host copia toccando "STANZA".
4. Dite a tutti: **volume su, tasto silenzioso disattivato, telefono in verticale**.
5. Host: tocca **Valerio** (gli compare l'alloro) → **START**.

## Durante il gioco

- Ogni round: si vota → si scommette → lo show parte da solo e **si ferma sull'esito**.
- Host: **CLASSIFICA ▶** quando tutti hanno letto, poi **PROSSIMA ▶**.
- Regia (🎬 in basso a sinistra): pausa, salta domanda, espelli, termina, sposta la corona.
- Il round si chiude da solo quando hanno votato e scommesso tutti, o allo scadere del tempo.

## Se succede qualcosa

| Problema | Cosa fare |
|---|---|
| Un telefono non sente niente | Toccare lo schermo (compare "Tocca per riattivare l'audio"); controllare volume e tasto silenzioso |
| Un telefono si è bloccato / ha ricaricato | Riaprire il sito: rientra da solo nella partita |
| Qualcuno ha cambiato telefono o perso la sessione | *Entra* con il codice e **lo stesso nome** → alla domanda "Sei tu?" tocca **Sì, sono io**: riprende posto e punti. (Due persone con lo stesso nome: l'altro tocca "No, sono un altro" e diventa "Marco 2") |
| Il telefono di **Valerio** è morto | Valerio entra da un altro telefono (nome qualsiasi). Host: in classifica → 🎬 → 👑 accanto al suo nome |
| Il telefono dell'**host** è morto | Da un altro telefono: *Entra* → codice → **stesso nome** → PIN. Si riprende il controllo; intanto il gioco è in pausa (si può riprendere anche dalla regia: 🎬 → Riprendi) |
| Un voto "non è arrivato" | Compare l'avviso giallo e tornano i bottoni: basta rivotare |
| Qualcuno è entrato due volte / un nome strano | 🎬 → ✕ accanto al nome → *Espelli* |
| Banner "Connessione persa" | Rete del locale: aspettare qualche secondo, o passare da Wi-Fi a 4G |
| Il sito non si apre per niente | Controllare la connessione; se è Railway, vedi Piano B |
| Schermata "Ops!" | Si ricarica da sola e rientra in partita |

Il server salva la partita di continuo: anche se si riavvia, dopo qualche secondo tutti rientrano da soli dove erano.

## Piano B (se Railway non risponde)

Dal Mac, sulla stessa rete Wi-Fi degli invitati:

```bash
npm run build && HOST_PIN=1234 npm start
```

Tutti aprono `http://IP-DEL-MAC:3000` (l'IP si trova in Impostazioni → Wi-Fi). Poi pannello host → Info → **Importa pack** per ritrovare domande, penitenze e foto.
