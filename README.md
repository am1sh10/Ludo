# Ludo (family PWA)

A light, offline-capable Ludo for iPad and iPhone. 1 player (vs computer), 2, 3 or 4 players.
No frameworks, no build step, no accounts. Everything is in this folder.

## Try it on your computer
    cd ludo
    python3 -m http.server 8000
Open http://localhost:8000 in a browser.

## Put it on the iPad and iPhone
iOS only installs web apps served over HTTPS, so upload this folder to a free static host:
Netlify, Cloudflare Pages or GitHub Pages all work. Then on each device:
1. Open the link in Safari.
2. Tap Share, then Add to Home Screen.
3. Open Ludo from the Home Screen (it runs full screen and works offline after the first load).

## Publishing a change
Edit the files, change `CACHE = 'ludo-v1'` in `sw.js` to `ludo-v2` (and so on), and upload again.
Installed copies show an "Update" banner the next time they open online.

## House rules (all in engine.js)
- A 6 brings a token out. A 6, a capture, or a token reaching home gives another roll.
- Three 6s in a row lose the turn.
- 8 safe squares: each start square and the star 8 steps after it. Tokens share safe squares.
- Landing on an unsafe square captures every opponent token there. No blockades.
- Exact roll to finish. First to bring all 4 tokens home wins.
- At the start, everyone rolls in turn until someone gets a 6. That player goes first and the 6 counts.

## Tests
    node tests/engine.test.js
Checks the board geometry, each rule, and plays thousands of complete games.
