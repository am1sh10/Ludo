/* Ludo rules engine: pure game logic, no DOM. Works in the browser (window.LudoEngine) and Node (require).
 *
 * Seats: 0 Red (bottom), 1 Green (left), 2 Yellow (top), 3 Blue (right), clockwise.
 * Token progress: -1 = in base, 0..50 = main track (0 = own start square),
 *                 51..55 = home column, 56 = home (finished).
 * Main track: 52 squares, index increases clockwise.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LudoEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BASE = -1, LAST_TRACK = 50, FINISH = 56, TRACK_LEN = 52;
  var START = [40, 1, 14, 27];
  var SAFE = {};
  START.forEach(function (s) { SAFE[s] = true; SAFE[(s + 8) % TRACK_LEN] = true; });
  var NAMES = ['Red', 'Green', 'Yellow', 'Blue'];

  /* ---------- Geometry (15x15 grid, cell (c,r) has centre (c+.5, r+.5)) ---------- */
  var TRACK = [], c, r;
  for (c = 0; c <= 5; c++) TRACK.push([c, 6]);          // 0-5
  for (r = 5; r >= 0; r--) TRACK.push([6, r]);          // 6-11
  TRACK.push([7, 0]);                                   // 12
  for (r = 0; r <= 5; r++) TRACK.push([8, r]);          // 13-18
  for (c = 9; c <= 14; c++) TRACK.push([c, 6]);         // 19-24
  TRACK.push([14, 7]);                                  // 25
  for (c = 14; c >= 9; c--) TRACK.push([c, 8]);         // 26-31
  for (r = 9; r <= 14; r++) TRACK.push([8, r]);         // 32-37
  TRACK.push([7, 14]);                                  // 38
  for (r = 14; r >= 9; r--) TRACK.push([6, r]);         // 39-44
  for (c = 5; c >= 0; c--) TRACK.push([c, 8]);          // 45-50
  TRACK.push([0, 7]);                                   // 51

  var LANE = [
    [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],       // Red (bottom arm)
    [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],           // Green (left arm)
    [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],           // Yellow (top arm)
    [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]]        // Blue (right arm)
  ];
  var BASE_CENTRE = [[3, 12], [3, 3], [12, 3], [12, 12]];
  var BASE_SPOT = 1.35;
  var CENTRE_DIR = [[0, 1], [-1, 0], [0, -1], [1, 0]];  // direction from board centre toward each seat

  function abs(seat, p) { return (START[seat] + p) % TRACK_LEN; }
  function onTrack(p) { return p >= 0 && p <= LAST_TRACK; }

  /** Position (in cell units, centre of the spot) for a token. */
  function position(seat, progress, tokenIndex) {
    var bc, dx, dy;
    if (progress === BASE) {
      bc = BASE_CENTRE[seat];
      dx = (tokenIndex % 2 === 0) ? -BASE_SPOT : BASE_SPOT;
      dy = (tokenIndex < 2) ? -BASE_SPOT : BASE_SPOT;
      return [bc[0] + dx, bc[1] + dy];
    }
    if (onTrack(progress)) {
      var t = TRACK[abs(seat, progress)];
      return [t[0] + 0.5, t[1] + 0.5];
    }
    if (progress >= 51 && progress <= 55) {
      var l = LANE[seat][progress - 51];
      return [l[0] + 0.5, l[1] + 0.5];
    }
    // finished: cluster inside the seat's centre triangle
    var d = CENTRE_DIR[seat], lat = [-d[1], d[0]];
    var along = tokenIndex < 2 ? 0.8 : 1.2, side = (tokenIndex % 2 === 0) ? -0.42 : 0.42;
    return [7.5 + d[0] * along + lat[0] * side, 7.5 + d[1] * along + lat[1] * side];
  }

  /* ---------- State ---------- */
  function newGame(seats, cpuSeats, opts) {
    var s = seats.slice().sort(function (a, b) { return a - b; });
    var state = {
      v: 1,
      seats: s,
      cpu: (cpuSeats || []).slice(),
      level: (opts && opts.level) || 'normal',
      tokens: {},
      shown: {},          // last rolled value per seat (for display)
      turn: s[0],
      phase: 'opening',   // opening | roll | move | over
      dice: null,
      sixes: 0,
      winner: null
    };
    s.forEach(function (seat) { state.tokens[seat] = [BASE, BASE, BASE, BASE]; state.shown[seat] = null; });
    return state;
  }

  function cloneState(state) { return JSON.parse(JSON.stringify(state)); }
  function nextSeat(state, seat) { return state.seats[(state.seats.indexOf(seat) + 1) % state.seats.length]; }
  function isCpu(state, seat) { return state.cpu.indexOf(seat) !== -1; }

  /** One token index per distinct legal move (tokens at the same progress are interchangeable). */
  function legalMoves(state) {
    var out = [];
    if (state.phase !== 'move') return out;
    var seat = state.turn, d = state.dice, seen = {};
    state.tokens[seat].forEach(function (p, i) {
      if (p === FINISH) return;
      if (p === BASE) { if (d !== 6) return; }
      else if (p + d > FINISH) return;
      if (seen[p]) return;
      seen[p] = true;
      out.push(i);
    });
    return out;
  }

  /** What would happen if token i moved with the current dice. */
  function preview(state, i) {
    var seat = state.turn, p = state.tokens[seat][i];
    var np = p === BASE ? 0 : p + state.dice;
    var captures = [];
    if (onTrack(np)) {
      var a = abs(seat, np);
      if (!SAFE[a]) {
        state.seats.forEach(function (o) {
          if (o === seat) return;
          state.tokens[o].forEach(function (q, j) {
            if (onTrack(q) && abs(o, q) === a) captures.push({ seat: o, token: j, progress: q });
          });
        });
      }
    }
    return { from: p, to: np, captures: captures, home: np === FINISH };
  }

  function endTurn(state) {
    state.turn = nextSeat(state, state.turn);
    state.phase = 'roll';
    state.dice = null;
    state.sixes = 0;
  }

  /** Apply a dice roll for the current seat. Returns an array of events. */
  function applyRoll(state, value) {
    var ev = [], seat = state.turn;
    if (value < 1 || value > 6) throw new Error('bad dice value');
    if (state.phase === 'opening') {
      ev.push({ type: 'roll', seat: seat, value: value });
      state.shown[seat] = value;
      if (value === 6) { state.phase = 'move'; state.dice = 6; state.sixes = 1; ev.push({ type: 'opening-winner', seat: seat }); }
      else state.turn = nextSeat(state, seat);
      return ev;
    }
    if (state.phase !== 'roll') throw new Error('cannot roll now');
    ev.push({ type: 'roll', seat: seat, value: value });
    state.shown[seat] = value;
    state.sixes = value === 6 ? state.sixes + 1 : 0;
    if (state.sixes === 3) { ev.push({ type: 'triple-six', seat: seat }); endTurn(state); return ev; }
    state.dice = value;
    state.phase = 'move';
    if (legalMoves(state).length === 0) { ev.push({ type: 'no-move', seat: seat }); endTurn(state); }
    return ev;
  }

  /** Move a token (any index whose progress matches a legal move). Returns events. */
  function applyMove(state, i) {
    if (state.phase !== 'move') throw new Error('cannot move now');
    var seat = state.turn, p = state.tokens[seat][i];
    var rep = -1;
    legalMoves(state).forEach(function (k) { if (state.tokens[seat][k] === p) rep = k; });
    if (rep < 0) throw new Error('illegal move');
    var info = preview(state, rep), ev = [];
    state.tokens[seat][rep] = info.to;
    ev.push({ type: 'move', seat: seat, token: rep, from: info.from, to: info.to });
    info.captures.forEach(function (cap) {
      state.tokens[cap.seat][cap.token] = BASE;
      ev.push({ type: 'capture', seat: seat, victim: cap.seat, token: cap.token, from: cap.progress });
    });
    var bonus = state.dice === 6 || info.captures.length > 0;
    if (info.home) { ev.push({ type: 'home', seat: seat, token: rep }); bonus = true; }
    if (state.tokens[seat].every(function (q) { return q === FINISH; })) {
      state.phase = 'over'; state.winner = seat; state.dice = null;
      ev.push({ type: 'win', seat: seat });
      return ev;
    }
    state.dice = null;
    if (bonus) { state.phase = 'roll'; ev.push({ type: 'bonus', seat: seat }); }
    else endTurn(state);
    return ev;
  }

  /* ---------- Computer player ---------- */
  function threatenedAt(state, seat, square) {
    var hit = false;
    state.seats.forEach(function (o) {
      if (o === seat) return;
      state.tokens[o].forEach(function (q) {
        if (!onTrack(q)) return;
        var d = (square - abs(o, q) + TRACK_LEN) % TRACK_LEN;
        if (d >= 1 && d <= 6) hit = true;
      });
    });
    return hit;
  }

  function scoreMove(state, i, rng) {
    var seat = state.turn, info = preview(state, i), p = info.from, np = info.to, s = 0;
    var newAbs = onTrack(np) ? abs(seat, np) : null;
    var oldAbs = onTrack(p) ? abs(seat, p) : null;
    if (info.home) s += 1000;
    if (info.captures.length) {
      s += 500;
      info.captures.forEach(function (cp) { s += cp.progress; });
    }
    if (p === BASE) s += 300;
    if (newAbs !== null && SAFE[newAbs] && !(oldAbs !== null && SAFE[oldAbs])) s += 200;
    if (oldAbs !== null && !SAFE[oldAbs] && threatenedAt(state, seat, oldAbs)) {
      if (newAbs === null || SAFE[newAbs] || !threatenedAt(state, seat, newAbs)) s += 150;
    }
    if (np >= 51 && np <= 55) s += 80;
    if (newAbs !== null && !SAFE[newAbs] && !info.captures.length && threatenedAt(state, seat, newAbs)) s -= 60;
    s += np;
    return s + (rng() * 0.5);
  }

  /** Pick a token index for the current seat (state.phase must be 'move'). */
  function chooseMove(state, rng) {
    rng = rng || Math.random;
    var moves = legalMoves(state);
    if (moves.length <= 1) return moves[0];
    if (state.level === 'easy') return moves[Math.floor(rng() * moves.length)];
    var best = moves[0], bestScore = -Infinity;
    moves.forEach(function (i) {
      var sc = scoreMove(state, i, rng);
      if (sc > bestScore) { bestScore = sc; best = i; }
    });
    return best;
  }

  function rollDie(rng) { return 1 + Math.floor((rng || Math.random)() * 6); }

  return {
    BASE: BASE, FINISH: FINISH, LAST_TRACK: LAST_TRACK, TRACK_LEN: TRACK_LEN,
    START: START, SAFE: SAFE, NAMES: NAMES, TRACK: TRACK, LANE: LANE,
    BASE_CENTRE: BASE_CENTRE, CENTRE_DIR: CENTRE_DIR,
    abs: abs, onTrack: onTrack, position: position,
    newGame: newGame, cloneState: cloneState, nextSeat: nextSeat, isCpu: isCpu,
    legalMoves: legalMoves, preview: preview, applyRoll: applyRoll, applyMove: applyMove,
    chooseMove: chooseMove, rollDie: rollDie
  };
});
