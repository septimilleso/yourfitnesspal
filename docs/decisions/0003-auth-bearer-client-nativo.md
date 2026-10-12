# 0003. Autenticazione Bearer per il client nativo

- Data: 2026-10-12
- Stato: accettata
- Feature: [2026-10-12-app-ios-offline](../features/2026-10-12-app-ios-offline/)

## Contesto

La PWA usa un cookie `session` `SameSite=Lax` con API sullo stesso origin (nginx). L'IPA Capacitor serve la UI da `capacitor://localhost` e chiama l'API su un dominio pubblico HTTPS: cross-origin. Su iOS la WebView applica ITP e blocca i cookie di terze parti, anche con `SameSite=None`.

## Decisione

Il backend accetta la sessione da cookie oppure da `Authorization: Bearer <token>`. Il login resta password + TOTP, uguale all'online. Un client nativo (identificato da un header o parametro esplicito) riceve il token di sessione nella risposta e lo conserva sul dispositivo. Il token è lo stesso valore di sessione già revocabile server-side. Il CORS ammette solo l'origin dell'app.

## Alternative scartate

- Cookie `SameSite=None; Secure` + CORS + plugin HTTP nativo: dipende da ITP e dal comportamento interno del plugin.
- Caricare la PWA remota (`server.url`): same-origin, ma l'app non si apre offline.

## Conseguenze

- `get_current_user` legge anche l'header. Le sessioni Bearer vanno elencabili e revocabili da Account.
- Il token va salvato in modo sicuro (Keychain o storage Capacitor). Con cookie `HttpOnly` il token non era leggibile da JS; ora lo è: la superficie XSS cresce, quindi CSP e dipendenze restano da tenere pulite.
- Con Bearer il CSRF per quel percorso non si applica, ma `X-Requested-With` resta richiesto.
