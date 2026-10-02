"use strict";

const DIRS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

function opposite(color) {
  return color === "w" ? "b" : "w";
}

function inBounds(r, c) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function cloneBoard(board) {
  return board.map((row) => row.map((cell) => (cell ? { color: cell.color, king: !!cell.king } : null)));
}

function initialBoard() {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 0) continue;
      if (r <= 2) board[r][c] = { color: "b", king: false };
      else if (r >= 5) board[r][c] = { color: "w", king: false };
    }
  }
  return board;
}

function newGameState() {
  return {
    board: initialBoard(),
    turn: "w",
    continueFrom: null,
    quietPlies: 0,
    turnHadCapture: false,
    lastMove: null,
    result: null,
    reason: null,
  };
}

function normSq(value) {
  if (value == null || value === "") return null;
  if (!Array.isArray(value) || value.length < 2) return null;
  const r = Number(value[0]);
  const c = Number(value[1]);
  if (!Number.isInteger(r) || !Number.isInteger(c) || !inBounds(r, c)) return null;
  return [r, c];
}

function sameSq(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a[0] === b[0] && a[1] === b[1];
}

function manCaptures(board, r, c, color) {
  const out = [];
  for (const [dr, dc] of DIRS) {
    const mr = r + dr;
    const mc = c + dc;
    const lr = r + 2 * dr;
    const lc = c + 2 * dc;
    if (!inBounds(lr, lc)) continue;
    const mid = board[mr][mc];
    if (mid && mid.color !== color && !board[lr][lc]) {
      out.push({ from: [r, c], to: [lr, lc], capture: [mr, mc] });
    }
  }
  return out;
}

function kingCaptures(board, r, c, color) {
  const out = [];
  for (const [dr, dc] of DIRS) {
    let seen = null;
    for (let i = 1; i < 8; i++) {
      const rr = r + dr * i;
      const cc = c + dc * i;
      if (!inBounds(rr, cc)) break;
      const cell = board[rr][cc];
      if (!seen) {
        if (!cell) continue;
        if (cell.color === color) break;
        seen = [rr, cc];
        continue;
      }
      if (cell) break;
      out.push({ from: [r, c], to: [rr, cc], capture: seen });
    }
  }
  return out;
}

function capturesFor(board, r, c) {
  const piece = board[r][c];
  if (!piece) return [];
  return piece.king ? kingCaptures(board, r, c, piece.color) : manCaptures(board, r, c, piece.color);
}

function quietMoves(board, r, c) {
  const piece = board[r][c];
  if (!piece) return [];
  const out = [];
  if (!piece.king) {
    const dr = piece.color === "w" ? -1 : 1;
    for (const dc of [-1, 1]) {
      const rr = r + dr;
      const cc = c + dc;
      if (inBounds(rr, cc) && !board[rr][cc]) out.push({ from: [r, c], to: [rr, cc], capture: null });
    }
    return out;
  }
  for (const [dr, dc] of DIRS) {
    for (let i = 1; i < 8; i++) {
      const rr = r + dr * i;
      const cc = c + dc * i;
      if (!inBounds(rr, cc) || board[rr][cc]) break;
      out.push({ from: [r, c], to: [rr, cc], capture: null });
    }
  }
  return out;
}

function allCaptures(board, color, onlyFrom) {
  const out = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (onlyFrom && (onlyFrom[0] !== r || onlyFrom[1] !== c)) continue;
      const piece = board[r][c];
      if (!piece || piece.color !== color) continue;
      out.push(...capturesFor(board, r, c));
    }
  }
  return out;
}

function legalMoves(state) {
  if (!state || state.result) return [];
  const color = state.turn;
  if (state.continueFrom) return allCaptures(state.board, color, state.continueFrom);
  const caps = allCaptures(state.board, color, null);
  if (caps.length) return caps;
  const out = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = state.board[r][c];
      if (piece && piece.color === color) out.push(...quietMoves(state.board, r, c));
    }
  }
  return out;
}

function emptyBoard() {
  return Array.from({ length: 8 }, () => Array(8).fill(null));
}

function applyMove(state, move) {
  const from = normSq(move && move.from);
  const to = normSq(move && move.to);
  const capture = normSq(move && move.capture);
  const matches = legalMoves(state).filter((item) => sameSq(item.from, from) && sameSq(item.to, to));
  const legal = capture
    ? matches.find((item) => sameSq(item.capture, capture))
    : matches.length === 1
      ? matches[0]
      : matches.find((item) => item.capture == null);
  if (!legal) return { ok: false, error: "illegal" };

  const next = {
    board: cloneBoard(state.board),
    turn: state.turn,
    continueFrom: null,
    quietPlies: state.quietPlies || 0,
    turnHadCapture: !!state.turnHadCapture,
    lastMove: { from: legal.from, to: legal.to, capture: legal.capture },
    result: null,
    reason: null,
  };
  const [fr, fc] = legal.from;
  const [tr, tc] = legal.to;
  const piece = { color: next.board[fr][fc].color, king: !!next.board[fr][fc].king };
  next.board[fr][fc] = null;
  if (legal.capture) {
    next.board[legal.capture[0]][legal.capture[1]] = null;
    next.turnHadCapture = true;
  }
  next.board[tr][tc] = piece;

  if (legal.capture && capturesFor(next.board, tr, tc).length) {
    next.continueFrom = [tr, tc];
    return { ok: true, state: next };
  }

  if (!piece.king && tr === (piece.color === "w" ? 0 : 7)) piece.king = true;
  next.quietPlies = next.turnHadCapture ? 0 : next.quietPlies + 1;
  next.turnHadCapture = false;
  next.continueFrom = null;
  next.turn = opposite(state.turn);

  if (next.quietPlies >= 80) {
    next.result = "draw";
    next.reason = "quiet";
    return { ok: true, state: next };
  }

  if (!legalMoves(next).length) {
    next.result = state.turn === "w" ? "white" : "black";
    next.reason = "no_moves";
  }
  return { ok: true, state: next };
}

module.exports = {
  opposite,
  cloneBoard,
  initialBoard,
  newGameState,
  emptyBoard,
  legalMoves,
  applyMove,
  normSq,
};
