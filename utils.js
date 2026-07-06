// Took these from
// https://github.com/tree-sitter/tree-sitter-javascript/blob/master/grammar.js

const seperated = (rule, seperator) => seq(rule, repeat(seq(seperator, rule)));
const seperatedSkipLast = (rule, seperator) => repeat1(seq(rule, seperator));

// Haxe allows (and this codebase idiomatically uses) a trailing comma before
// the closing delimiter in array/object/call/param lists -- `[1, 2,]` is
// valid, unlike a trailing `.` in a dotted path. So comma-lists get their own
// trailing-separator-tolerant variant rather than changing `seperated` itself
// (which `dotSep`/`dotSep1` below also share, and a trailing dot is never
// valid there).
const seperatedTrailing = (rule, seperator) =>
  seq(rule, repeat(seq(seperator, rule)), optional(seperator));

const commaSep = (rule) => optional(seperatedTrailing(rule, ','));
const commaSep1 = (rule) => seperatedTrailing(rule, ',');

const dotSep = (rule) => optional(seperated(rule, '.'));
const dotSep1 = (rule) => seperated(rule, '.');

module.exports = {
  commaSep,
  commaSep1,
  dotSep1,
  seperated,
  seperatedSkipLast,
};
