/**
 * Everything: both halves, each registering its own elements. A page that needs only one half imports that entry
 * instead: `calendar-neo/single` (the calculator, one date) or `calendar-neo/multi` (the highlighter, many dates).
 */
export * from './multi';
export * from './single';
