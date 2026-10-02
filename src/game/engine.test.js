const assert = require("assert");
const { newGameState, legalMoves, applyMove, emptyBoard } = require("./engine");

function state(board, extra = {}) {
  return {
    board,
    turn: "w",
    continueFrom: null,
    quietPlies: 0,
    turnHadCapture: false,
    lastMove: null,
    result: null,
    reason: null,
    ...extra,
  };
}

const opening = legalMoves(newGameState());
assert.strictEqual(opening.length, 7, "opening moves");
assert.ok(opening.every((move) => move.capture == null));

{
  const board = emptyBoard();
  board[4][1] = { color: "w", king: false };
  board[3][2] = { color: "b", king: false };
  board[5][4] = { color: "w", king: false };
  const moves = legalMoves(state(board));
  assert.strictEqual(moves.length, 1);
  assert.deepStrictEqual(moves[0].to, [2, 3]);
  const quiet = applyMove(state(board), { from: [5, 4], to: [4, 3] });
  assert.strictEqual(quiet.ok, false);
}

{
  const board = emptyBoard();
  board[2][1] = { color: "w", king: false };
  board[3][2] = { color: "b", king: false };
  const moves = legalMoves(state(board));
  assert.ok(moves.some((move) => move.to[0] === 4 && move.to[1] === 3));
}

{
  const board = emptyBoard();
  board[4][1] = { color: "w", king: false };
  board[3][2] = { color: "b", king: false };
  board[1][4] = { color: "b", king: false };
  const first = applyMove(state(board), { from: [4, 1], to: [2, 3], capture: [3, 2] });
  assert.strictEqual(first.ok, true);
  assert.deepStrictEqual(first.state.continueFrom, [2, 3]);
  assert.strictEqual(first.state.turn, "w");
  const second = applyMove(first.state, { from: [2, 3], to: [0, 5], capture: [1, 4] });
  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.state.board[0][5].king, true);
  assert.strictEqual(second.state.turn, "b");
}

{
  const board = emptyBoard();
  board[1][2] = { color: "w", king: false };
  const moved = applyMove(state(board), { from: [1, 2], to: [0, 1] });
  assert.strictEqual(moved.state.board[0][1].king, true);
}

{
  const board = emptyBoard();
  board[4][3] = { color: "w", king: true };
  const moves = legalMoves(state(board));
  assert.ok(moves.length > 4);
  assert.ok(moves.some((move) => move.to[0] === 1 && move.to[1] === 0));
}

{
  const board = emptyBoard();
  board[7][0] = { color: "w", king: true };
  board[5][2] = { color: "b", king: false };
  const moves = legalMoves(state(board));
  assert.ok(moves.some((move) => move.to[0] === 4 && move.to[1] === 3));
  assert.ok(moves.some((move) => move.to[0] === 2 && move.to[1] === 5));
}

{
  const board = emptyBoard();
  board[2][1] = { color: "w", king: false };
  board[1][2] = { color: "b", king: false };
  const moved = applyMove(state(board), { from: [2, 1], to: [0, 3], capture: [1, 2] });
  assert.strictEqual(moved.state.result, "white");
  assert.strictEqual(moved.state.reason, "no_moves");
}

{
  const board = emptyBoard();
  board[5][0] = { color: "w", king: false };
  board[2][1] = { color: "b", king: false };
  const moved = applyMove(state(board, { quietPlies: 79 }), { from: [5, 0], to: [4, 1] });
  assert.strictEqual(moved.state.result, "draw");
}

console.log("engine ok");
