# Ludo (family PWA), revision 2

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
Edit the files, bump `CACHE = 'ludo-v2'` in `sw.js` to `ludo-v3` (and so on), and upload again.
Revision 1 copies show an "Update" banner; tap it once and the new version loads.
Installed copies show an "Update" banner the next time they open online.

## House rules (all in engine.js)
- A 6 brings a token out. A 6, a capture, or a token reaching home gives another roll.
- Three 6s in a row lose the turn.
- 8 safe squares: each start square and the star 8 steps after it. Tokens share safe squares.
- Landing on an unsafe square captures every opponent token there. No blockades.
- Exact roll to finish. First to bring all 4 tokens home wins.
- At the start, everyone rolls in turn until someone gets a 6. That player goes first and the 6 counts.

## What's new in revision 2
- Difficulty: Easy (random moves), Medium (best move half the time), Hard (always the best move). Medium is the default.
  The dice are identical at every level; only the choice of which token to move differs.
- Dice come from the browser's cryptographic random generator. Menu > Dice stats shows how often each face has come up.
- End of game: confetti and fireworks for the winner (the card turns to face the winner's seat), soft falling stars and a
  "Good game" card with a recap for the losing side. Reduced-motion devices skip the animation.
- Menu > Test sound. The game respects the device's silent switch, so if there is no sound, flip the ringer switch on.

## Tests
    node tests/engine.test.js
Checks the board geometry, each rule, and plays thousands of complete games.
