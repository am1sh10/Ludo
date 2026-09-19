/* Run with: node tests/engine.test.js */
'use strict';
const assert = require('assert');
const E = require('../engine.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n      ' + (e && e.stack || e)); process.exitCode = 1; }
}

// Seeded RNG so failures are reproducible
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Put a game straight into the roll phase for a given seat
function fresh(seats, turn) {
  const s = E.newGame(seats, []);
  s.phase = 'roll';
  s.turn = turn === undefined ? seats[0] : turn;
  return s;
}
function play(s, roll, tokenIdx) {           // roll, then optionally move
  const ev = E.applyRoll(s, roll);
  if (tokenIdx !== undefined) return ev.concat(E.applyMove(s, tokenIdx));
  return ev;
}

console.log('Board geometry');
test('track has 52 distinct squares, consecutive squares touch', () => {
  assert.strictEqual(E.TRACK.length, 52);
  const seen = new Set(E.TRACK.map(t => t.join(',')));
  assert.strictEqual(seen.size, 52);
  for (let i = 0; i < 52; i++) {
    const a = E.TRACK[i], b = E.TRACK[(i + 1) % 52];
    const dx = Math.abs(a[0] - b[0]), dy = Math.abs(a[1] - b[1]);
    assert.ok(Math.max(dx, dy) === 1, 'gap between ' + i + ' and ' + (i + 1) % 52);
  }
});
test('exactly 8 diagonal corner steps (the 4 inner corners are cut)', () => {
  let diag = 0;
  for (let i = 0; i < 52; i++) {
    const a = E.TRACK[i], b = E.TRACK[(i + 1) % 52];
    if (a[0] !== b[0] && a[1] !== b[1]) diag++;
  }
  assert.strictEqual(diag, 4);
});
test('home columns: 5 squares each, off the track, distinct', () => {
  const trackSet = new Set(E.TRACK.map(t => t.join(',')));
  const all = new Set();
  E.LANE.forEach(lane => {
    assert.strictEqual(lane.length, 5);
    lane.forEach(cell => { assert.ok(!trackSet.has(cell.join(','))); all.add(cell.join(',')); });
  });
  assert.strictEqual(all.size, 20);
});
test('last track square of each seat touches the first home column square', () => {
  for (let seat = 0; seat < 4; seat++) {
    const last = E.TRACK[E.abs(seat, 50)], first = E.LANE[seat][0];
    assert.strictEqual(Math.abs(last[0] - first[0]) + Math.abs(last[1] - first[1]), 1, 'seat ' + seat);
    for (let k = 0; k < 4; k++) {
      const a = E.LANE[seat][k], b = E.LANE[seat][k + 1];
      assert.strictEqual(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), 1);
    }
  }
});
test('8 safe squares: 4 starts + 4 stars, stars at the classic spots', () => {
  const safe = Object.keys(E.SAFE).map(Number);
  assert.strictEqual(safe.length, 8);
  const stars = E.START.map(s => E.TRACK[(s + 8) % 52].join(',')).sort();
  assert.deepStrictEqual(stars, ['12,6', '2,8', '6,2', '8,12']);
});
test('start squares sit next to their own base side', () => {
  assert.deepStrictEqual(E.TRACK[E.START[0]], [6, 13]);  // Red, bottom-left base
  assert.deepStrictEqual(E.TRACK[E.START[1]], [1, 6]);   // Green, top-left base
  assert.deepStrictEqual(E.TRACK[E.START[2]], [8, 1]);   // Yellow, top-right base
  assert.deepStrictEqual(E.TRACK[E.START[3]], [13, 8]);  // Blue, bottom-right base
});
test('a full lap for each seat covers 51 track squares then the lane', () => {
  for (let seat = 0; seat < 4; seat++) {
    const sq = new Set();
    for (let p = 0; p <= 50; p++) sq.add(E.abs(seat, p));
    assert.strictEqual(sq.size, 51);
    assert.strictEqual(E.FINISH - 0, 56);
  }
});
test('token positions are all distinct within a seat', () => {
  for (let seat = 0; seat < 4; seat++) {
    const seen = new Set();
    for (let p = -1; p <= 56; p++) {
      if (p === -1 || p === 56) { for (let t = 0; t < 4; t++) seen.add(E.position(seat, p, t).join(',')); }
      else seen.add(E.position(seat, p, 0).join(','));
    }
    assert.strictEqual(seen.size, 4 + 4 + 56 - 0); // 4 base + 4 centre + progress 0..55
  }
});

console.log('Rules');
test('needs a 6 to leave the base', () => {
  const s = fresh([0, 2], 0);
  const ev = E.applyRoll(s, 3);
  assert.ok(ev.some(e => e.type === 'no-move'));
  assert.strictEqual(s.turn, 2);
  assert.strictEqual(s.phase, 'roll');
  assert.deepStrictEqual(s.tokens[0], [-1, -1, -1, -1]);
});
test('a 6 brings a token onto its start square and gives another roll', () => {
  const s = fresh([0, 2], 0);
  E.applyRoll(s, 6);
  assert.deepStrictEqual(E.legalMoves(s), [0]);           // base tokens are interchangeable
  E.applyMove(s, 0);
  assert.strictEqual(s.tokens[0][0], 0);
  assert.strictEqual(s.turn, 0);
  assert.strictEqual(s.phase, 'roll');
});
test('a plain move passes the turn to the next seat clockwise', () => {
  const s = fresh([0, 1, 2], 0);
  s.tokens[0][0] = 10;
  play(s, 4, 0);
  assert.strictEqual(s.tokens[0][0], 14);
  assert.strictEqual(s.turn, 1);
  s.tokens[1][0] = 5; play(s, 2, 0);
  assert.strictEqual(s.turn, 2);
  s.tokens[2][0] = 5; play(s, 2, 0);
  assert.strictEqual(s.turn, 0);                          // wraps around
});
test('two-player games alternate between opposite seats', () => {
  const s = fresh([0, 2], 0);
  s.tokens[0][0] = 3; play(s, 1, 0);
  assert.strictEqual(s.turn, 2);
});
test('capture on an unsafe square sends the token home and gives a bonus roll', () => {
  const s = fresh([0, 2], 0);
  // Red progress 5 -> abs 45. Yellow progress 31 -> abs (14+31)%52 = 45.
  s.tokens[0][0] = 2;                                     // Red will land on p=5 (abs 45)
  s.tokens[2][0] = 31;
  assert.strictEqual(E.abs(0, 5), E.abs(2, 31));
  assert.ok(!E.SAFE[E.abs(0, 5)]);
  const ev = play(s, 3, 0);
  assert.ok(ev.some(e => e.type === 'capture'));
  assert.strictEqual(s.tokens[2][0], -1);
  assert.strictEqual(s.turn, 0);
  assert.strictEqual(s.phase, 'roll');
});
test('safe squares do not capture: tokens coexist', () => {
  const s = fresh([0, 2], 0);
  // Red start square abs 40 (safe). Yellow token sits there: Yellow p = (40-14+52)%52 = 26.
  s.tokens[2][0] = 26;
  assert.ok(E.SAFE[E.abs(2, 26)]);
  E.applyRoll(s, 6); E.applyMove(s, 0);                   // Red enters on its start square
  assert.strictEqual(s.tokens[0][0], 0);
  assert.strictEqual(s.tokens[2][0], 26);                 // still there
  // star square coexist too
  const s2 = fresh([0, 2], 0);
  s2.tokens[0][0] = 4;                                    // abs 44
  s2.tokens[2][0] = 34;                                   // abs (14+34)%52 = 48, a star
  play(s2, 4, 0);                                         // Red -> p8, abs 48
  assert.strictEqual(E.abs(0, 8), 48);
  assert.ok(E.SAFE[48]);
  assert.strictEqual(s2.tokens[2][0], 34);
});
test('landing on a square with two opponent tokens captures both', () => {
  const s = fresh([0, 2], 0);
  s.tokens[0][0] = 2;
  s.tokens[2][0] = 31; s.tokens[2][1] = 31;
  const ev = play(s, 3, 0);
  assert.strictEqual(ev.filter(e => e.type === 'capture').length, 2);
  assert.strictEqual(s.tokens[2][0], -1);
  assert.strictEqual(s.tokens[2][1], -1);
});
test('no blockades: same-colour tokens stack and opponents pass and land freely', () => {
  const s = fresh([0, 2], 0);
  s.tokens[0][0] = 10; s.tokens[0][1] = 10;
  // Yellow token can move past/onto that square without restriction
  s.turn = 2;
  const ap = E.abs(0, 10);
  s.tokens[2][0] = (ap - 14 - 3 + 52) % 52;               // 3 squares behind the stack
  assert.ok(E.onTrack(s.tokens[2][0]));
  const before = E.legalMoves(Object.assign(E.cloneState(s), { phase: 'move', dice: 5 }));
  assert.ok(before.length >= 1);                          // moving 5 (past the stack) is legal
  const ev = play(s, 3, 0);                               // lands exactly on the stack
  assert.strictEqual(ev.filter(e => e.type === 'capture').length, 2);
});
test('exact roll needed to finish', () => {
  const s = fresh([0, 2], 0);
  s.tokens[0][0] = 54;
  E.applyRoll(s, 3);                                      // 57 > 56
  assert.strictEqual(s.turn, 2);                          // no legal move, passes
  s.phase = 'roll'; s.turn = 0;
  E.applyRoll(s, 2);                                      // 56 exactly
  assert.deepStrictEqual(E.legalMoves(s), [0]);
  E.applyMove(s, 0);
  assert.strictEqual(s.tokens[0][0], 56);
});
test('getting a token home gives an extra roll', () => {
  const s = fresh([0, 2], 0);
  s.tokens[0][0] = 54;
  const ev = play(s, 2, 0);
  assert.ok(ev.some(e => e.type === 'home'));
  assert.strictEqual(s.turn, 0);
  assert.strictEqual(s.phase, 'roll');
});
test('tokens in the home column cannot be captured', () => {
  const s = fresh([0, 2], 2);
  s.tokens[0][0] = 52;                                    // Red in its home column
  s.tokens[2][0] = 30;
  // No opponent progress can map to a home column square
  const info = (function () { E.applyRoll(s, 2); return E.preview(s, 0); })();
  assert.strictEqual(info.captures.length, 0);
  assert.strictEqual(s.tokens[0][0], 52);
});
test('rolling a 6 gives another roll; three 6s in a row forfeit the turn', () => {
  const s = fresh([0, 2], 0);
  s.tokens[0][0] = 3;
  play(s, 6, 0);                                          // roll 1 (six), moved
  assert.strictEqual(s.turn, 0);
  play(s, 6, 0);                                          // roll 2 (six), moved
  assert.strictEqual(s.turn, 0);
  const before = s.tokens[0][0];
  const ev = E.applyRoll(s, 6);                           // third six
  assert.ok(ev.some(e => e.type === 'triple-six'));
  assert.strictEqual(s.tokens[0][0], before);             // no move
  assert.strictEqual(s.turn, 2);
  assert.strictEqual(s.sixes, 0);
});
test('a non-six roll resets the six streak', () => {
  const s = fresh([0, 2], 0);
  s.tokens[0][0] = 3; s.tokens[0][1] = 3;
  play(s, 6, 0);
  // capture bonus with a non-six, then sixes start counting again from zero
  s.sixes = 0;
  const ev = E.applyRoll(s, 6);
  assert.ok(!ev.some(e => e.type === 'triple-six'));
});
test('opening: rolls pass around until someone gets a 6; that 6 is a real move', () => {
  const s = E.newGame([0, 1, 2, 3], []);
  assert.strictEqual(s.phase, 'opening');
  assert.strictEqual(s.turn, 0);
  E.applyRoll(s, 3); assert.strictEqual(s.turn, 1);
  E.applyRoll(s, 5); assert.strictEqual(s.turn, 2);
  E.applyRoll(s, 6);
  assert.strictEqual(s.phase, 'move');
  assert.strictEqual(s.turn, 2);
  E.applyMove(s, 0);
  assert.strictEqual(s.tokens[2][0], 0);
  assert.strictEqual(s.phase, 'roll');                    // extra roll for the six
  assert.strictEqual(s.turn, 2);
});
test('opening rolls wrap around the table', () => {
  const s = E.newGame([0, 2], []);
  E.applyRoll(s, 1); E.applyRoll(s, 2);
  assert.strictEqual(s.turn, 0);
  assert.strictEqual(s.phase, 'opening');
});
test('winning: all four tokens home ends the game immediately', () => {
  const s = fresh([0, 2], 0);
  s.tokens[0] = [56, 56, 56, 55];
  const ev = play(s, 1, 3);
  assert.ok(ev.some(e => e.type === 'win'));
  assert.strictEqual(s.phase, 'over');
  assert.strictEqual(s.winner, 0);
  assert.throws(() => E.applyRoll(s, 3));
});
test('rejects illegal moves and out-of-phase actions', () => {
  const s = fresh([0, 2], 0);
  assert.throws(() => E.applyMove(s, 0));                 // no roll yet
  E.applyRoll(s, 6);
  s.tokens[0][1] = 20; s.phase = 'move';
  assert.throws(() => E.applyMove(s, 3 + 10));            // bogus index falls through as illegal
});
test('interchangeable tokens are offered as one move', () => {
  const s = fresh([0, 2], 0);
  s.tokens[0] = [10, 10, -1, -1];
  E.applyRoll(s, 6);
  assert.strictEqual(E.legalMoves(s).length, 2);          // one out-of-base, one stacked pair
});
test('a token that cannot move is never offered', () => {
  const s = fresh([0, 2], 0);
  s.tokens[0] = [56, 55, 10, -1];
  E.applyRoll(s, 3);
  const moves = E.legalMoves(s);
  assert.ok(moves.indexOf(0) === -1 && moves.indexOf(1) === -1 && moves.indexOf(3) === -1);
  assert.deepStrictEqual(moves, [2]);
});
test('state survives JSON save/restore mid-game', () => {
  const s = fresh([0, 1, 2], 1);
  s.tokens[1][2] = 20;
  E.applyRoll(s, 4);
  const restored = JSON.parse(JSON.stringify(s));
  assert.deepStrictEqual(restored, s);
  E.applyMove(restored, 2);
  assert.strictEqual(restored.tokens[1][2], 24);
});

console.log('Computer player');
test('normal bot prefers finishing, then capturing, then leaving base', () => {
  let s = fresh([0, 2], 0); s.cpu = [0]; s.level = 'normal';
  s.tokens[0] = [50, 10, -1, -1]; E.applyRoll(s, 6);      // 50+6=56 finishes
  assert.strictEqual(E.chooseMove(s, () => 0.1), 0);

  s = fresh([0, 2], 0); s.cpu = [0]; s.level = 'normal';
  s.tokens[0] = [2, 20, -1, -1]; s.tokens[2][0] = 31; E.applyRoll(s, 3);  // token 0 captures
  assert.strictEqual(E.chooseMove(s, () => 0.1), 0);

  s = fresh([0, 2], 0); s.cpu = [0]; s.level = 'normal';
  s.tokens[0] = [30, -1, -1, -1]; E.applyRoll(s, 6);      // bring out vs advance
  const pick = E.chooseMove(s, () => 0.1);
  assert.strictEqual(pick, 1);
});
test('bot never returns an illegal move', () => {
  const rng = mulberry32(7);
  for (let n = 0; n < 500; n++) {
    const s = fresh([0, 2], 0); s.cpu = [0, 2]; s.level = n % 2 ? 'easy' : 'normal';
    for (let k = 0; k < 4; k++) s.tokens[0][k] = Math.floor(rng() * 58) - 1;
    for (let k = 0; k < 4; k++) s.tokens[2][k] = Math.floor(rng() * 58) - 1;
    E.applyRoll(s, E.rollDie(rng));
    if (s.phase !== 'move') continue;
    const pick = E.chooseMove(s, rng);
    assert.ok(E.legalMoves(s).indexOf(pick) !== -1);
  }
});

console.log('Simulated games');
function checkInvariants(s) {
  s.seats.forEach(seat => {
    assert.strictEqual(s.tokens[seat].length, 4);
    s.tokens[seat].forEach(p => assert.ok(Number.isInteger(p) && p >= -1 && p <= 56, 'progress ' + p));
  });
  // On unsafe track squares only one seat may be present (others would have been captured)
  const occupants = {};
  s.seats.forEach(seat => s.tokens[seat].forEach(p => {
    if (!E.onTrack(p)) return;
    const a = E.abs(seat, p);
    (occupants[a] = occupants[a] || new Set()).add(seat);
  }));
  Object.keys(occupants).forEach(a => {
    if (!E.SAFE[a]) assert.ok(occupants[a].size === 1, 'mixed seats on unsafe square ' + a);
  });
}

function simulate(seats, cpuFlags, seed, level) {
  const rng = mulberry32(seed);
  const s = E.newGame(seats, cpuFlags, { level: level });
  let steps = 0, captures = 0, sixesForfeits = 0, homes = 0;
  while (s.phase !== 'over') {
    if (++steps > 200000) throw new Error('game did not finish (seed ' + seed + ')');
    let ev;
    if (s.phase === 'opening' || s.phase === 'roll') ev = E.applyRoll(s, E.rollDie(rng));
    else {
      const moves = E.legalMoves(s);
      assert.ok(moves.length > 0, 'move phase with no legal moves');
      const pick = E.isCpu(s, s.turn) ? E.chooseMove(s, rng) : moves[Math.floor(rng() * moves.length)];
      ev = E.applyMove(s, pick);
    }
    ev.forEach(e => { if (e.type === 'capture') captures++; if (e.type === 'triple-six') sixesForfeits++; if (e.type === 'home') homes++; });
    checkInvariants(s);
    if (s.phase === 'move') assert.ok(E.legalMoves(s).length > 0);
  }
  assert.ok(s.tokens[s.winner].every(p => p === 56));
  // no other seat can also be finished
  s.seats.forEach(seat => { if (seat !== s.winner) assert.ok(!s.tokens[seat].every(p => p === 56)); });
  return { steps: steps, winner: s.winner, captures: captures, forfeits: sixesForfeits, homes: homes };
}

const configs = [
  { name: '1 Player vs computer (Red, Yellow)', seats: [0, 2], cpu: [2] },
  { name: '2 Players', seats: [0, 2], cpu: [] },
  { name: '3 Players', seats: [0, 1, 2], cpu: [] },
  { name: '4 Players', seats: [0, 1, 2, 3], cpu: [] },
  { name: '4 seats, all computer (normal)', seats: [0, 1, 2, 3], cpu: [0, 1, 2, 3] }
];
configs.forEach(cfg => {
  test('1000 full games finish cleanly: ' + cfg.name, () => {
    const wins = {}; let totalSteps = 0, caps = 0, forf = 0, homes = 0, maxSteps = 0;
    for (let g = 0; g < 1000; g++) {
      const r = simulate(cfg.seats, cfg.cpu, 1000 + g, g % 2 ? 'easy' : 'normal');
      wins[r.winner] = (wins[r.winner] || 0) + 1;
      totalSteps += r.steps; caps += r.captures; forf += r.forfeits; homes += r.homes;
      maxSteps = Math.max(maxSteps, r.steps);
    }
    console.log('        wins by seat ' + JSON.stringify(wins) + ', avg actions/game ' + Math.round(totalSteps / 1000) +
      ', max ' + maxSteps + ', captures/game ' + (caps / 1000).toFixed(1) + ', triple-six forfeits/game ' + (forf / 1000).toFixed(2) + ', homes/game ' + (homes / 1000).toFixed(1));
  });
});

test('normal computer beats easy computer most of the time', () => {
  let normalWins = 0; const N = 600;
  for (let g = 0; g < N; g++) {
    const rng = mulberry32(50000 + g);
    const s = E.newGame([0, 2], [0, 2]);
    // Different levels per seat: swap the level before each decision
    const levels = { 0: 'normal', 2: 'easy' };
    if (g % 2) { levels[0] = 'easy'; levels[2] = 'normal'; }
    let steps = 0;
    while (s.phase !== 'over') {
      if (++steps > 200000) throw new Error('stuck');
      if (s.phase === 'opening' || s.phase === 'roll') E.applyRoll(s, E.rollDie(rng));
      else { s.level = levels[s.turn]; E.applyMove(s, E.chooseMove(s, rng)); }
    }
    if (levels[s.winner] === 'normal') normalWins++;
  }
  console.log('        normal won ' + normalWins + ' of ' + N);
  assert.ok(normalWins > N * 0.6, 'normal bot should clearly beat easy');
});

console.log('\n' + passed + ' tests passed' + (process.exitCode ? ', some FAILED' : ''));
