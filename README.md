# 🍺 Valerio Beve

Il gioco multiplayer della laurea di Valerio. Ognuno gioca dal proprio telefono, fino a ~25 persone. Si risponde a "Preferiresti X o Y?" e, se Valerio finisce in minoranza, perde: a turno fa una penitenza o beve.

- **Telefoni**: entrano con un codice di 4 lettere, votano X/Y e scommettono se Valerio perderà (solo punti, chi sbaglia non beve).
- **Reveal sincronizzato**: circa 9 secondi di show (barre, pendolo, sirena, coriandoli, vibrazione) che parte nello stesso istante su tutti i dispositivi e poi resta fermo sull'esito finché l'host non preme AVANTI.
- **Schermo grande** (opzionale): TV o proiettore su `/tv`, con codice gigante, QR code e lo show in versione lunga.
- **Pannello host**: per domande, penitenze, foto di Valerio per ogni espressione, meme interni e backup.

## Avvio in locale

```bash
npm install
npm run dev          # http://localhost:3000 (backend + frontend con hot reload)
```

Per provarlo da soli con una stanza piena di finti amici, crea una partita e poi lancia:

```bash
npm run bots -- ABCD 12            # ABCD = codice stanza, 12 bot (il primo si chiama "Valerio")
```

Per aprire il gioco dai telefoni sulla stessa rete Wi-Fi usa `http://<ip-del-mac>:3000`.

## Come si gioca alla festa

1. **L'host** apre il sito, preme *Crea partita* e mette il suo nome. Può anche solo fare regia, senza giocare.
2. **Tutti gli altri** premono *Entra* e inseriscono il codice, oppure inquadrano il QR sulla TV o aprono `sito/CODICE`.
3. **In lobby** l'host tocca il nome di Valerio per dargli la corona 👑 e poi preme **START**.
4. **Ogni round**: tutti votano. Chi non è Valerio poi scommette "Perde / Si salva". Il round si chiude quando hanno votato tutti oppure allo scadere del timer.
5. **Reveal**: lo show scorre da solo e si ferma sull'esito (penitenza o bevuta, esito delle scommesse). L'host preme **CLASSIFICA ▶** per la mini classifica ("Chi conosce meglio Valerio") e poi **PROSSIMA ▶**.
6. Si continua fino alla fine delle domande, oppure finché l'host non termina dalla regia 🎬. Alla fine ci sono il podio, il totale delle bevute e i 3 momenti in cui Valerio è rimasto più solo.

**TV / proiettore**: dal browser della TV apri `sito/tv/CODICE` e clicca "Accendi lo show". Il clic serve anche a sbloccare l'audio.

### Regole implementate

| Situazione | Esito |
|---|---|
| Valerio sceglie come la maggioranza degli altri | **Salvo** |
| Valerio in minoranza | **Perde** |
| Pareggio tra gli altri | **Perde comunque** |
| Tutti gli altri uniti contro di lui | **Perde** + "UNICO CONTRO TUTTI" e caos doppio |
| Valerio non vota entro il timer | **Perde** ("non ha scelto") |
| Quando perde | Si alterna: 1ª sconfitta **🎭 penitenza**, 2ª **🍺 beve**, 3ª penitenza… Le penitenze escono nell'ordine della lista |
| Scommessa indovinata | +1 punto. Chi sbaglia prende 0 e basta: niente bevute per chi scommette |
| 3 sconfitte di fila | badge 🔥 IN FIAMME |

L'esito lo decide il server, quindi tutti i telefoni e la TV vedono la stessa cosa nello stesso istante.

Il voto di Valerio non conta per la maggioranza e resta nascosto fino al reveal.

## Personalizzazione (prima della festa)

Dal pannello host, con il tasto **Domande & foto** in lobby o 🎬 durante la partita:

- **Penitenze**: una per riga, escono in quest'ordine. Ce ne sono 22 già pronte a tema laurea e Poli; se svuoti la lista Valerio beve sempre.
- **Domande**: incollale una per riga nel formato `X | Y`. Le parole tra `*asterischi*` vengono evidenziate. Puoi riordinare, mescolare ed eliminare le domande, e associare un meme a ciascuna.
- **Facce**: carica una foto per ogni espressione (neutra, felice, disperata, sorpresa, ubriaca, con l'alloro). Meglio PNG scontornati; se la foto ha lo sfondo viene ritagliata da sola a sticker. Se manca un'espressione si usa la neutra, e senza nessuna foto compare il Valerio disegnato.
- **Meme**: compaiono come sticker nel reveal della domanda a cui li associ.
- **Info**: corso di laurea e università, usati nei testi.
- **Backup**: *Scarica pack* salva domande, foto e meme in un unico JSON; *Importa pack* li ripristina su qualsiasi server.

Tutto questo è salvato su disco in `DATA_DIR` (default `./data`) e vale per tutte le partite.

## Deploy

### Fly.io (consigliato: server sempre acceso + disco persistente)

La prima volta:

```bash
fly launch --no-deploy --copy-config          # usa fly.toml già pronto (cambia il nome app se è preso)
fly volumes create valerio_data --size 1 --region fra
```

Poi, ogni volta, un solo comando:

```bash
fly deploy --ha=false
```

`--ha=false` è importante: la partita vive in memoria, quindi serve **una sola macchina**.

### Render (gratis, con due limiti)

Collega il repo e Render legge `render.yaml`. I limiti del piano free:
- dopo 15 minuti senza visite il server si addormenta: aprilo 5 minuti prima di giocare;
- il disco non è persistente: dopo un riavvio reimporta il **pack** dal pannello.

### Railway / qualsiasi host Node

Comando di build `npm ci && npm run build`, comando di avvio `npm start`. Serve Node 20+ e WebSocket abilitati. C'è anche un `Dockerfile` pronto.

### Variabili d'ambiente

| Variabile | Default | A cosa serve |
|---|---|---|
| `PORT` | `3000` | porta HTTP |
| `DATA_DIR` | `./data` | dove salvare libreria, foto e meme |
| `HOST_PIN` | vuoto | se impostato, serve questo PIN per creare una partita (così gli invitati non possono aprire stanze) |

## Test

```bash
npm test
```

Il test avvia un server vero e simula una serata con 20 client finti. Verifica:
- nomi doppi, voti, scommesse e punti;
- maggioranza, minoranza, pareggio e unanimità;
- voti arrivati in ritardo, streak, reveal programmato nel futuro;
- telefono bloccato che si riconnette a metà round;
- host che esce (pausa) e rientra (ripresa);
- ritardatari, espulsioni;
- una maratona di 30 round senza errori.

## Come funziona

- **Server** (`server/`): Node + Express + Socket.io. Lo stato della partita è autoritativo e sta in memoria (`game.js`). Il server decide fasi, timer e risultati; i client mostrano soltanto quello che ricevono. Gli invii sono raggruppati ogni 40 ms.
- **Sincronizzazione**: all'ingresso ogni client stima l'offset del proprio orologio rispetto al server (6 ping, tiene quello con RTT minore). Ogni fase arriva con il timestamp di inizio. Il reveal è programmato 500 ms nel futuro, così arriva a tutti prima di partire. Le animazioni sono una timeline GSAP agganciata a quel timestamp e i suoni sono schedulati sul clock Web Audio: chi si collega a metà salta al punto giusto.
- **Riconnessione**: un token in `localStorage` riporta il telefono nella stessa partita, con lo stesso nome e nella fase corrente. Se l'host sparisce per più di 3 secondi la partita va in pausa e riprende quando rientra.
- **Client** (`client/`): React + Vite + GSAP. I coriandoli sono disegnati su canvas (massimo 150 particelle) e le animazioni usano solo transform e opacity. Il Wake Lock tiene lo schermo acceso. Con `prefers-reduced-motion` le animazioni si riducono, senza sparire.
- **Audio**: tutto sintetizzato con Web Audio (pop, boing, tic-tac, rullo, sirena, clacson, coro, cha-ching, trombone triste, fanfara). Non ci sono file da scaricare né licenze da gestire. Il primo tocco sblocca l'audio e un tasto muto resta sempre visibile.

## Checklist pre-festa

- [ ] 6–10 foto di Valerio con espressioni diverse, possibilmente scontornate
- [ ] Meme interni
- [ ] Domande personalizzate (almeno metà su Valerio: funzionano meglio quelle che dividono il gruppo 50/50)
- [ ] Caricare tutto dal pannello e **scaricare il pack di backup**
- [ ] Verificare se c'è una TV o un proiettore
- [ ] Prova completa con almeno 5 telefoni veri, iPhone e Android
- [ ] Controllare Wi-Fi e copertura nel locale
- [ ] Impostare `HOST_PIN` sul server
