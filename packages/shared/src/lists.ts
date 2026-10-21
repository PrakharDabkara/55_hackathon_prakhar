/** Shopping-list limits (ADR-0055). Product rules, not env config. */

/** A list has 1 to this many distinct lines. */
export const LIST_MAX_LINES = 10;
/** A trimmed line may be this long (characters). */
export const LIST_LINE_MAX_CHARS = 80;
/** An ambiguous line offers at most this many options (plus "as I typed"). */
export const LIST_MAX_OPTIONS = 3;
/** The list stops listening once this many shops have answered. */
export const MAX_LIST_ANSWERS = 8;
/** ...or after this many minutes, whichever comes first. */
export const LIST_TTL_MIN = 15;
/** A customer may send this many lists an hour. */
export const LIST_HOURLY_LIMIT = 10;
