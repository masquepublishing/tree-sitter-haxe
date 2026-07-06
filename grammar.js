// const types = require("./grammar-types");
const operators = require('./grammar-operators.js');
const literals = require('./grammar-literals.js');
const declarations = require('./grammar-declarations');
const builtins = require('./grammar-builtins');

const { commaSep, commaSep1 } = require('./utils');

const preprocessor_statement_start_tokens = ['if', 'elseif'];
const preprocessor_statement_end_tokens = ['else', 'end'];

const haxe_grammar = {
  name: 'haxe',
  externals: ($) => [$._lookback_semicolon, $._closing_brace_marker, $._closing_brace_unmarker],
  word: ($) => $.identifier,
  inline: ($) => [$.statement, $.expression],
  extras: ($) => [$.comment, /[\s\uFEFF\u2060\u200B\u00A0]/, $._closing_brace_unmarker],
  supertypes: ($) => [$.declaration],
  conflicts: ($) => [
    [$.block, $.object],
    [$.typedef_declaration, $.type],
    [$._rhs_expression, $.pair],
    [$._literal, $.pair],
    [$.pair, $.pair],
    [$.function_declaration],
    [$.function_type, $.variable_declaration],
    [$.type, $.function_type, $.variable_declaration],
    [$.type, $._function_type_args],
    [$.structure_type_pair, $._function_type_args],
    [$.function_declaration, $.variable_declaration],
    [$._prefixUnaryOperator, $._arithmeticOperator],
    [$._prefixUnaryOperator, $._postfixUnaryOperator],
    [$.enum_abstract_declaration, $.enum_declaration],
    [$.typedef_declaration, $.structure_type],
    [$.member_expression, $._lhs_expression],
    [$._rhs_expression, $._lhs_expression],
    [$._rhs_expression, $.subscript_expression],
    [$._lhs_expression, $.pair],
    [$._ternary_condition, $.pair],
    [$._unaryExpression, $._ternary_condition, $.pair],
    [$._chain_term, $._ternary_condition],
    [$._rhs_expression, $.member_expression],
    [$.conditional_statement],
  ],
  rules: {
    module: ($) => seq(repeat($.statement)),

    // Statements
    statement: ($) =>
      // Use prec.left to favor rules that end SOONER
      // this means a semicolon ends the statement.
      prec.left(
        choice(
          $.preprocessor_statement,
          $.import_statement,
          $.using_statement,
          $.package_statement,
          $.declaration,
          $.switch_expression,
          seq($.expression, $._lookback_semicolon),
          $.conditional_statement,
          $.while_statement,
          $.do_while_statement,
          $.for_statement,
          $.try_statement,
          $.throw_statement,
          $.block,
          $.reserved_keyword,
        ),
      ),

    preprocessor_statement: ($) =>
      prec.right(
        seq(
          '#',
          choice(
            seq(token.immediate(choice(...preprocessor_statement_start_tokens)), $.expression),
            token.immediate(choice(...preprocessor_statement_end_tokens)),
          ),
        ),
      ),

    package_statement: ($) =>
      seq(
        'package',
        optional(field('name', seq(repeat(seq($.package_name, '.')), $.package_name))),
        $._semicolon,
      ),

    package_name: ($) => $._camelCaseIdentifier,
    type_name: ($) => $._pascalCaseIdentifier,
    _type_path: ($) => seq(repeat(seq($.package_name, '.')), repeat(seq($.type_name, '.')), $.type_name),

    import_statement: ($) =>
      seq(
        'import',
        seq(
          repeat(seq($.package_name, '.')),
          repeat(seq($.type_name, '.')),
          choice(
            seq('*'),
            seq($.type_name, optional(seq('.', alias($._camelCaseIdentifier, $.identifier)))),
          )
        ),
        optional(seq(choice('as', 'in'), choice($.type_name, alias($._camelCaseIdentifier, $.identifier)))),
        $._semicolon,
      ),

    using_statement: ($) =>
      seq(
        'using',
        seq(repeat(seq($.package_name, '.')), repeat(seq($.type_name, '.')), $.type_name),
        $._semicolon,
      ),

    throw_statement: ($) => prec.right(seq('throw', $.expression, $._lookback_semicolon)),

    _rhs_expression: ($) =>
      prec(1, choice($._literal, $.identifier, $.member_expression, $.call_expression)),

    // Restricted to the actual unary operator sets (_prefixUnaryOperator/
    // _postfixUnaryOperator), not the fully generic $.operator (which also
    // includes every binary operator). The generic version let e.g. `width <`
    // match here treating '<' as a bogus "postfix unary" operator -- almost
    // never an issue on its own since it's semantically nonsensical, but it
    // created a second, equally error-free reading for comparison-conditioned
    // ternaries inside parens (`(width < height ? width : height)`, matching
    // real code in this depot): _unaryExpression could swallow "width <" as
    // one expression, leaving a second, separate ternary_expression for just
    // "height ? width : height" -- silently misparsing `a < b ? c : d` as
    // `a < (b ? c : d)` with no ERROR node to catch it. This was a
    // pre-existing latent bug, not introduced by the < vs. type_params fix
    // above; it surfaced now because it happened to share a state with the
    // newly-added ternary_expression.
    _unaryExpression: ($) =>
      prec.left(
        2,
        choice(
          // unary on LHS
          seq(alias($._prefixUnaryOperator, $.operator), $._rhs_expression),
          // unary on RHS
          seq($._rhs_expression, alias($._postfixUnaryOperator, $.operator)),
        ),
      ),

    runtime_type_check_expression: ($) =>
      prec(20, seq('(', alias($.structure_type_pair, 'type_check'), ')')),
    //     runtime_type_check_expression: ($) => prec.left(10, seq('(', $.pair, ')')),

    switch_expression: ($) =>
      prec.right(
        seq(
          'switch',
          choice($.identifier, $._parenthesized_expression),
          alias($.switch_block, $.block),
        ),
      ),

    _closing_brace: ($) => seq($._closing_brace_marker, '}'),

    switch_block: ($) => seq('{', repeat($.case_statement), $._closing_brace),

    case_statement: ($) =>
      prec.right(
        choice(
          seq('case', choice($._rhs_expression, alias('_', $._rhs_expression)), ':', $.statement),
          seq('default', ':', $.statement),
        ),
      ),

    cast_expression: ($) =>
      choice(
        seq('cast', $._rhs_expression),
        seq('cast', '(', $._rhs_expression, optional(seq(',', field('type', $.type))), ')'),
      ),

    type_trace_expression: ($) => seq('$type', '(', $._rhs_expression, ')'),

    _parenthesized_expression: ($) => seq('(', repeat1(prec.left($.expression)), ')'),

    // Previously baked `identifier 'in' ...` directly into this rule --
    // a workaround from when `for` itself was an unimplemented placeholder
    // keyword, using range_expression to soak up a for-loop's `(i in
    // 0...10)` content via accidental juxtaposition. Now that $.for_statement
    // provides its own real binding + 'in' + iterable structure, a dedicated
    // range_expression node turned out to be unnecessary: `$._rangeOperator`
    // is already one of `$.operator`'s choices, so the plain chain
    // alternative in `expression` below (`_rhs_expression (operator
    // _chain_term)*`) already parses `0...10`, `arr.length - 1 ...
    // arr.length + 5`, etc. correctly on its own, with no ERROR and no
    // separate rule needed -- confirmed empirically: a dedicated
    // range_expression rule (built the same way, with a narrowed operand
    // operator set to avoid it swallowing its own '...' separator) never
    // once got chosen over the plain chain in testing, for either a bare
    // `0...10` or a for-loop's iterable. Removed rather than left in as
    // unreachable dead code.

    // A chain term that may optionally carry a leading prefix-unary operator
    // (`!y`, `-y`, etc.), used only in a chain's TAIL positions (never as a
    // chain's head -- using this in head position reintroduces an extra
    // reduce step that collides with the head's own shift/reduce decision
    // and silently breaks even plain chains like `1 + 2`; confirmed by
    // testing, not just theorized). Restricted to tail positions, it lets
    // `a && !b`, `!a && !b`, etc. parse -- not just `!a && b`, which the
    // leading-unary `expression` alternative below already covers.
    // $.subscript_expression is included alongside $._rhs_expression here
    // so it can appear as a chain's TAIL term too (`null != m_cache[id]`) --
    // not just as a chain's HEAD, which the dedicated
    // `seq($.subscript_expression, repeat1(...))` alternative in
    // `expression` below already covers. Found via a depot-wide sweep, not
    // assumed: `while (null != m_timer[id]) { ... }` is real code in this
    // depot.
    _chain_term: ($) =>
      seq(optional(alias($._prefixUnaryOperator, $.operator)), choice($._rhs_expression, $.subscript_expression)),

    // Deliberately excludes $.ternary_expression itself (and the statement-
    // like forms below) so a bare, unparenthesized ternary can't be used as
    // another ternary's condition -- `a ? b : c` must be wrapped in parens
    // to serve as a condition. This keeps the grammar's only self-recursion
    // on this rule in the `alternative` field, which is what gives
    // `a ? b : c ? d : e` its right-associative ("else if" chain) reading
    // instead of an ambiguous choice between two equally-valid nestings.
    // prec(1, ...) on the whole choice, not just one branch: `pair`'s value
    // slot is `$.expression`, which reaches every alternative below via
    // ternary_expression's condition field, so any of them can be mid-parse
    // when a '?' shows up. Higher precedence than `pair`'s default (0) means
    // the parser shifts (keeps parsing toward the ternary) instead of
    // reducing the pair immediately, so `x : y ? c : d` reads as
    // `x : (y ? c : d)` rather than leaving `? c : d` dangling after a
    // prematurely-closed pair.
    _ternary_condition: ($) =>
      prec(
        2,
        choice(
          $._unaryExpression,
          $.subscript_expression,
          $.cast_expression,
          $._parenthesized_expression,
          seq($._rhs_expression, repeat(seq($.operator, $._rhs_expression))),
        ),
      ),

    // https://haxe.org/manual/expression-ternary.html
    ternary_expression: ($) =>
      prec.right(
        3,
        seq(
          field('condition', $._ternary_condition),
          '?',
          field('consequence', $.expression),
          ':',
          field('alternative', $.expression),
        ),
      ),

    expression: ($) =>
      choice(
        $._unaryExpression,
        $.subscript_expression,
        $.runtime_type_check_expression,
        $.cast_expression,
        $.type_trace_expression,
        $._parenthesized_expression,
        $.switch_expression,
        $.ternary_expression,
        // simple expression, or chained.
        seq($._rhs_expression, repeat(seq($.operator, $._chain_term))),
        // Same chain, but with a leading prefix-unary term (`!x && y`,
        // `-x + y`, etc.) -- requires repeat1 (at least one more operator/
        // term after the head) so this alternative is never reachable for a
        // solo unary term like `!x` alone; that continues to go exclusively
        // through $._unaryExpression above. Without that exclusivity this
        // would create a second, ambiguous derivation for every solo unary
        // expression. $._unaryExpression's prefix-only reach (never chained)
        // meant `!x && y` and similar always failed outright, even though
        // it's extremely common real-world code (818 files in this depot
        // use this shape).
        seq(
          alias($._prefixUnaryOperator, $.operator),
          $._rhs_expression,
          repeat1(seq($.operator, $._chain_term)),
        ),
        // $.subscript_expression as a chain HEAD -- `x[i] = y;`,
        // `x[i] * y`, etc. $.subscript_expression was only ever a complete,
        // standalone `expression` on its own (e.g. `x[i];` alone), never
        // one term of a longer chain, so any assignment or arithmetic
        // involving an array/map element on the left failed outright.
        // Extremely common (e.g. `mPieces[idx] = null;`,
        // `sPeerMap[arg] = sharedName;`, `kBonusWinCredits[i] * mult`).
        // repeat1-gated for the same reason as the leading-unary
        // alternative above: a solo `x[i]` alone must still go through
        // the plain $.subscript_expression choice, not this one.
        seq($.subscript_expression, repeat1(seq($.operator, $._chain_term))),
        // A postfix-unary term (`i--`, `i++`) as a chain HEAD -- `i-- > 0`,
        // common in `while (i-- > 0)` loops. The leading-unary alternative
        // above only covers a PREFIX unary head (`!x && y`); postfix was
        // still only reachable as the entire standalone $._unaryExpression,
        // never chained with a further operator. Same repeat1 gating and
        // same rationale as the leading-unary alternative.
        seq(
          $._rhs_expression,
          alias($._postfixUnaryOperator, $.operator),
          repeat1(seq($.operator, $._chain_term)),
        ),
        // `return`/`untyped` previously only took a single bare
        // $._rhs_expression, not a chain -- so `return a == b;` or
        // `return a = b;` (assign-and-return, common in this depot's
        // property setters, e.g. `return mKenoCardModel = kenoCardModel;`)
        // had no valid derivation covering the whole span, and would
        // hard-error. This was actually a PRE-EXISTING gap masked by a
        // separate bug: before the _unaryExpression operator-set fix
        // elsewhere in this fork's history, `a ==`/`a =` could silently
        // (and incorrectly) match as _unaryExpression's postfix form
        // (generic $.operator misread as a bogus postfix unary op),
        // giving `return` an _rhs_expression-shaped path to latch onto by
        // accident. Fixing that bug correctly closed off the accidental
        // path here too, surfacing this as a hard ERROR instead of a
        // silent misparse -- found via a depot-wide sweep combining this
        // fork's fixes, not caught by any single fix's own testing.
        // Broadened to accept the same chain shapes -- plain and
        // leading-unary -- that a bare (non-`return`) expression already
        // supports, plus a bare subscript return value (`return arr[i];`,
        // also common) which $._rhs_expression doesn't cover either.
        seq(
          'return',
          optional(
            choice(
              seq($._rhs_expression, repeat(seq($.operator, $._chain_term))),
              seq(
                alias($._prefixUnaryOperator, $.operator),
                $._rhs_expression,
                repeat(seq($.operator, $._chain_term)),
              ),
              $.subscript_expression,
            ),
          ),
        ),
        seq(
          'untyped',
          choice(
            seq($._rhs_expression, repeat(seq($.operator, $._chain_term))),
            $.subscript_expression,
            seq(
              alias($._prefixUnaryOperator, $.operator),
              $._rhs_expression,
              repeat(seq($.operator, $._chain_term)),
            ),
          ),
        ),
        'break',
        'continue',
      ),

    subscript_expression: ($) =>
      prec.left(
        1,
        seq(
          choice($.identifier, $._parenthesized_expression, $.member_expression),
          '[',
          field('index', $.expression),
          ']',
        ),
        //           seq($._parenthesized_expression, '[', field('index', $.expression), ']'),
      ),

    // Left-associative (issue #52: `a.b.c` parses as `(a.b).c`, not
    // `a.(b.c)`) via recursion on the object side -- $.member_expression is
    // itself a valid `object`, and `member` is a single non-recursive
    // $.identifier. The '?.' tokenization stays atomic (one token, no
    // space allowed) rather than '?' and '.' as two separate tokens: with
    // them separate, `identifier '?'` is ambiguous between "start of
    // safe-nav" and "start of a ternary_expression" -- resolving that
    // needs to see whether '.' follows, i.e. 2 tokens of lookahead, more
    // than LALR(1) has. Making '?.' atomic pushes that decision into the
    // lexer instead of the parser -- needed for ternary support.
    member_expression: ($) =>
      prec.left(1,
        seq(
          field('object', choice('this', $.identifier, $.member_expression, $._literal)),
          choice(token('.'), alias(token(seq('?', '.')), $.operator)),
          field('member', $.identifier),
        ),
      ),

    _lhs_expression: ($) => prec(1, choice($.identifier, $.member_expression)),

    builtin_type: ($) => prec.right(choice(...builtins)),

    _function_type_args: ($) => commaSep1(seq(optional(seq($.identifier, ':')), $.type)),

    function_type: ($) =>
      prec.right(
        choice(
          seq('(', ')', '->', $.type),
          seq($.type, '->', field('return_type', $.type)),
          seq('(', $._function_type_args, ')', '->', $.type),
        ),
      ),

    type: ($) =>
      prec.right(
        choice(
          seq(
            choice(
              field('type_name', $._lhs_expression),
              field('built_in', alias($.builtin_type, $.identifier)),
            ),
            optional($.type_params),
          ),
          $.function_type,
          seq('(', alias($.type, 'type'), ')'),
        ),
      ),

    // Known limitation: a genuinely EMPTY `{}` used as a control-flow body
    // (`if (cond) {}`, `while (cond) {}`, etc. -- 42 files in this depot)
    // resolves to an empty $.object (an object-literal expression
    // statement), not $.block. $.block is not even reachable from
    // $.expression's own choice list, so this is really "empty $.object
    // (reached via $.statement's `seq($.expression, ';')` alternative) vs.
    // $.block (a sibling alternative of that same $.statement choice) for
    // identical input" -- and empirically, this resolves independent of
    // every lever tried: declaring `[$.block, $.object]` in `conflicts`
    // gets flagged as unnecessary (tree-sitter's own analysis says this
    // isn't a real, GLR-forkable ambiguity), `prec`/`prec.dynamic` on
    // either rule (even prec(1000)) has zero effect, an explicit
    // `choice($.block, $.statement)` at the body field doesn't change it,
    // and neither does reordering which rule is declared first in this
    // file. This suggests tree-sitter's table construction is merging the
    // two empty-content states before precedence would ever be consulted,
    // which isn't fixable by anything expressible in grammar.js alone.
    // Non-empty bodies (`if (cond) { a(); }`) are entirely unaffected --
    // $.object's content is $.pair-shaped, which can never be confused
    // with $.block's $.statement-shaped content once there's real content
    // to look at.
    block: ($) => seq('{', repeat($.statement), $._closing_brace),

    metadata: ($) =>
      seq(
        choice(token('@'), token('@:')),
        field('name', $._lhs_expression),
        optional(seq('(', $.expression, ')')),
      ),

    // arg list is () with any amount of expressions followed by commas
    _arg_list: ($) => seq('(', commaSep($.expression), ')'),

    // Bodies are $.statement, not $.block -- Haxe's `if (cond) expr;` (no
    // braces) is standard, idiomatic syntax (~660 files in this depot use
    // it), and was completely broken here (forcing braces on every branch).
    // $.statement already covers both shapes (`{ ... }` via its own
    // $.block alternative, or a bare `expr;` via its
    // `seq($.expression, $._lookback_semicolon)` alternative), so reusing
    // it gets braceless bodies "for free" without a separate rule.
    conditional_statement: ($) =>
      prec.right(
        1,
        seq(
          field('name', 'if'),
          field('arguments_list', $._arg_list),
          field('body', $.statement),
          repeat(seq('else', 'if', field('arguments_list', $._arg_list), field('body', $.statement))),
          optional(seq('else', field('body', $.statement))),
        ),
      ),

    // https://haxe.org/manual/expression-while.html
    while_statement: ($) =>
      prec.right(
        1,
        seq('while', '(', field('condition', $.expression), ')', field('body', $.statement)),
      ),

    // https://haxe.org/manual/expression-do-while.html
    do_while_statement: ($) =>
      prec.right(
        1,
        seq(
          'do',
          field('body', $.statement),
          'while',
          '(',
          field('condition', $.expression),
          ')',
          $._lookback_semicolon,
        ),
      ),

    // https://haxe.org/manual/expression-for.html -- `binding` is either a
    // plain identifier (`for (v in arr)`) or a key/value pair (`for (k => v
    // in map)`, Haxe 4.0+); reuses $.pair rather than a dedicated rule so
    // the `=>` shape doesn't need re-deriving, even though `v` there is a
    // newly-bound loop variable, not a value expression referencing
    // something else.
    for_statement: ($) =>
      prec.right(
        1,
        seq(
          'for',
          '(',
          field('binding', choice($.identifier, $.pair)),
          'in',
          field('iterable', $.expression),
          ')',
          field('body', $.statement),
        ),
      ),

    // https://haxe.org/manual/expression-try-catch.html -- `type` is
    // optional (wildcard catch, Haxe 4.1+: `catch (e) { ... }`, defaults to
    // haxe.Exception).
    try_statement: ($) =>
      prec.right(1, seq('try', field('body', $.statement), repeat1($.catch_clause))),

    catch_clause: ($) =>
      seq(
        'catch',
        '(',
        field('name', $.identifier),
        optional(seq(':', field('type', $.type))),
        ')',
        field('body', $.statement),
      ),

    // https://haxe.org/manual/lf-array-comprehension.html -- `[for (...) e]`
    // / `[while (...) e]`, combining array declaration with a loop. Kept
    // separate from $.for_statement/$.while_statement (not reused directly)
    // because a comprehension's body is a bare $.expression with no
    // trailing semicolon (`[for (i in 0...10) i]`, not `i;`), whereas the
    // statement forms' body is $.statement specifically to get semicolon
    // handling for the common (non-comprehension) case -- unifying the two
    // would need $.statement and $.expression as competing choices for the
    // same body field, which is the same kind of GLR-fork-doesn't-reliably-
    // recover ambiguity documented on `_chain_term` above. The body can
    // recurse into another comprehension_for/while/if, matching real code
    // like nested `for (a in 1...11) for (b in 2...4) if (a % b == 0) ...`.
    _comprehension_body: ($) =>
      choice($.comprehension_for, $.comprehension_while, $.comprehension_if, $.expression),

    comprehension_for: ($) =>
      prec.right(
        seq(
          'for',
          '(',
          field('binding', choice($.identifier, $.pair)),
          'in',
          field('iterable', $.expression),
          ')',
          field('body', $._comprehension_body),
        ),
      ),

    comprehension_while: ($) =>
      prec.right(
        seq(
          'while',
          '(',
          field('condition', $.expression),
          ')',
          field('body', $._comprehension_body),
        ),
      ),

    // A bodyless-filter `if` inside a comprehension (`if (a % b == 0) ...`)
    // -- no `else`, since a filter either includes or skips an iteration.
    comprehension_if: ($) =>
      prec.right(
        seq('if', '(', field('condition', $.expression), ')', field('body', $._comprehension_body)),
      ),

    _call: ($) =>
      prec(
        1,
        seq(
          field('object', $._lhs_expression),
          optional($.type_params),
          field('arguments_list', $._arg_list),
        ),
      ),

    _constructor_call: ($) =>
      seq(
        'new',
        seq(
          repeat(seq($.package_name, '.')),
          repeat(seq($.type_name, '.')),
          field('constructor', $.type_name),
          optional($.type_params),
          field('arguments_list', $._arg_list),
        ),
      ),

    call_expression: ($) => choice($._call, $._constructor_call),

    ...operators,
    ...declarations,
    ...literals,

    comment: ($) => token(choice(seq('//', /.*/), seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/, '/'))),
    // keywords reserved by the haxe compiler that are not currently used
    reserved_keyword: ($) => choice('operator'),
    identifier: ($) => /[a-zA-Z_]+[a-zA-Z0-9]*/,
    // Hidden Nodes in tree.
    _camelCaseIdentifier: ($) => /[a-z_]+[a-zA-Z0-9_]*/,
    _pascalCaseIdentifier: ($) => /[A-Z_]+[a-zA-Z0-9_]*/,
    _semicolon: ($) => $._lookback_semicolon,
  },
};

module.exports = grammar(haxe_grammar);
