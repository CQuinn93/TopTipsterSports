/**
 * Clear copy when a join/access code fails in a game-mode screen.
 * Same wording whether the code is unknown or belongs to a different mode —
 * users often open Tipster20 / LMS / Racing by mistake.
 */
export type JoinGameMode = 'lms' | 'f2t' | 'racing';

export function joinGameModeLabel(mode: JoinGameMode): string {
  switch (mode) {
    case 'lms':
      return 'Last Man Standing';
    case 'f2t':
      return 'Tipster20';
    case 'racing':
      return 'Top Tipster Racing';
    default:
      return 'this mode';
  }
}

export function invalidJoinCodeMessage(mode: JoinGameMode): string {
  const gameType = joinGameModeLabel(mode);
  return (
    `This code is an invalid ${gameType} code. You are currently in ${gameType}. ` +
    `If this is correct, please contact the creator to get the correct code. ` +
    `If you are looking to join another competition, please return to Home and go to your desired mode.`
  );
}

export const INVALID_JOIN_CODE_TITLE = 'Invalid code';
