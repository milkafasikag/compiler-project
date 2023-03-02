function init() {
  const sourceElement = document.getElementById("source-cont");
  const resultElement = document.getElementById("result-cont");
  const runElement = document.getElementById("run");

  runElement.addEventListener("click", () => {
    const sourceText = sourceElement.value;

    resultElement.value = `
.data
  newline: .asciiz "\\n"
    
.text
`;
    let ast = parser.parseStringToCompletion(sourceText);
    Label.counter = 0;
    ast.emit(new Environment());
    let exit = `
  li $v0, 10
  syscall
`;
    emit(exit);
  });

  var resultConcat = (str) => {
    resultElement.value += str;
  };
  var emit = resultConcat;
  // var emit = console.log;

  var ParseResult = (function () {
    function ParseResult(value, source) {
      this.value = value;
      this.source = source;
    }
    return ParseResult;
  })();
  var Source = (function () {
    function Source(string, index) {
      this.string = string;
      this.index = index;
    }
    Source.prototype.match = function (regexp) {
      console.assert(regexp["sticky"]);
      regexp.lastIndex = this.index;
      var match = this.string.match(regexp);
      //console.log('matching', regexp, 'at index', this.index,
      //            'gave', match && JSON.stringify(match[0]));
      if (match) {
        var value = match[0];
        var source = new Source(this.string, this.index + value.length);
        return new ParseResult(value, source);
      }
      return null;
    };
    return Source;
  })();
  var Parser = (function () {
    function Parser(parse) {
      this.parse = parse;
    }
    /* Primitive combinators */
    Parser.regexp = function (regexp) {
      return new Parser(function (source) {
        return source.match(regexp);
      });
    };
    Parser.constant = function (value) {
      return new Parser(function (source) {
        return new ParseResult(value, source);
      });
    };
    Parser.error = function (message) {
      return new Parser(function (source) {
        throw Error(message);
      });
    };
    Parser.prototype.or = function (parser) {
      var _this = this;
      return new Parser(function (source) {
        var result = _this.parse(source);
        if (result) return result;
        else return parser.parse(source);
      });
    };
    Parser.zeroOrMore = function (parser) {
      return new Parser(function (source) {
        var results = [];
        var item;
        while ((item = parser.parse(source))) {
          source = item.source;
          results.push(item.value);
        }
        return new ParseResult(results, source);
      });
    };
    Parser.prototype.bind = function (callback) {
      var _this = this;
      return new Parser(function (source) {
        var result = _this.parse(source);
        if (result) return callback(result.value).parse(result.source);
        else return null;
      });
    };
    /* Non-primitive, composite combinators */
    Parser.prototype.and = function (parser) {
      return this.bind(function (_) {
        return parser;
      });
    };
    Parser.prototype.map = function (callback) {
      return this.bind(function (value) {
        return constant(callback(value));
      });
    };
    Parser.maybe = function (parser) {
      return parser.or(constant(null));
    };
    Parser.prototype.parseStringToCompletion = function (string) {
      var source = new Source(string, 0);
      var result = this.parse(source);
      if (!result) throw Error("Parse error: could not parse anything at all");
      var index = result.source.index;
      if (index != result.source.string.length)
        throw Error("Parse error at index " + index);
      return result.value;
    };
    return Parser;
  })();
  var regexp = Parser.regexp,
    constant = Parser.constant,
    maybe = Parser.maybe,
    zeroOrMore = Parser.zeroOrMore,
    error = Parser.error;
  var whitespace = regexp(/[ \n\r\t]+/y);
  var comments = regexp(/[/][/].*/y).or(regexp(/[/][*].*[*][/]/sy));
  var ignored = zeroOrMore(whitespace.or(comments));
  var token = function (pattern) {
    return Parser.regexp(pattern).bind(function (value) {
      return ignored.and(constant(value));
    });
  };
  // Keywords
  var FUNCTION = token(/function\b/y);
  var CONSOLE_LOG = token(/console.log\b/y);
  var IF = token(/if\b/y);
  var WHILE = token(/while\b/y);
  var DO_WHILE = token(/do\b/y);
  var ELSE = token(/else\b/y);
  var RETURN = token(/return\b/y);
  var VAR = token(/var\b/y);
  var COMMA = token(/[,]/y);
  var SEMICOLON = token(/;/y);
  var LEFT_PAREN = token(/[(]/y);
  var RIGHT_PAREN = token(/[)]/y);
  var LEFT_BRACE = token(/[{]/y);
  var RIGHT_BRACE = token(/[}]/y);
  var NUMBER = token(/[0-9]+/y).map(function (digits) {
    return new Num(parseInt(digits, 10));
  });
  var ID = token(/[a-zA-Z_][a-zA-Z0-9_]*/y);
  var id = ID.map(function (x) {
    return new Id(x);
  });
  // Operators
  var NOT = token(/!/y).map(function (_) {
    return Not;
  });
  var EQUAL = token(/==/y).map(function (_) {
    return Equal;
  });
  var NOT_EQUAL = token(/!=/y).map(function (_) {
    return NotEqual;
  });
  var PLUS = token(/[+]/y).map(function (_) {
    return Add;
  });
  var MINUS = token(/[-]/y).map(function (_) {
    return Subtract;
  });
  var STAR = token(/[*]/y).map(function (_) {
    return Multiply;
  });
  var SLASH = token(/[\/]/y).map(function (_) {
    return Divide;
  });
  var ASSIGN = token(/=/y).map(function (_) {
    return Assign;
  });
  var expression = Parser.error("expression parser used before definition");
  // atom <-   ID / NUMBER / LEFT_PAREN expression RIGHT_PAREN
  var atom = id.or(NUMBER).or(
    LEFT_PAREN.and(expression).bind(function (e) {
      return RIGHT_PAREN.and(constant(e));
    })
  );
  // unary <- NOT? atom
  var unary = maybe(NOT).bind(function (not) {
    return atom.map(function (term) {
      return not ? new Not(term) : term;
    });
  });
  var infix = function (operatorParser, termParser) {
    return termParser.bind(function (term) {
      return zeroOrMore(
        operatorParser.bind(function (operator) {
          return termParser.bind(function (term) {
            return constant({ operator: operator, term: term });
          });
        })
      ).map(function (operatorTerms) {
        return operatorTerms.reduce(function (left, _a) {
          var operator = _a.operator,
            term = _a.term;
          return new operator(left, term);
        }, term);
      });
    });
  };
  // product <- unary ((STAR / SLASH) unary)*
  var product = infix(STAR.or(SLASH), unary);
  // sum <- product ((PLUS / MINUS) product)*
  var sum = infix(PLUS.or(MINUS), product);
  // comparison <- sum ((EQUAL / NOT_EQUAL) sum)*
  var comparison = infix(EQUAL.or(NOT_EQUAL), sum);
  // expression <- comparison
  expression.parse = comparison.parse;
  var statement = Parser.error("statement parser used before definition");
  // expressionStatement <- expression SEMICOLON
  var expressionStatement = expression.bind(function (term) {
    return SEMICOLON.and(constant(term));
  });
  // ifStatement <-
  //   IF LEFT_PAREN expression RIGHT_PAREN statement ELSE statement
  var ifStatement = IF.and(LEFT_PAREN)
    .and(expression)
    .bind(function (conditional) {
      return RIGHT_PAREN.and(statement).bind(function (consequence) {
        return ELSE.and(statement).bind(function (alternative) {
          return constant(new If(conditional, consequence, alternative));
        });
      });
    });
  // ifOnlyStatement <-
  //   IF LEFT_PAREN expression RIGHT_PAREN statement
  var ifOnlyStatement = IF.and(LEFT_PAREN)
    .and(expression)
    .bind(function (conditional) {
      return RIGHT_PAREN.and(statement).bind(function (consequence) {
        return constant(new IfOnly(conditional, consequence));
      });
    });
  // consoleLogStatement
  //  CONSOLE_LOG LEFT_PAREN expression RIGHT_PAREN SEMICOLON
  var consoleLogStatement = CONSOLE_LOG.and(LEFT_PAREN)
    .and(expression)
    .bind(function (exp) {
      return RIGHT_PAREN.and(SEMICOLON).and(constant(new Console(exp)));
    });
  // whileStatement <-
  //   WHILE LEFT_PAREN expression RIGHT_PAREN statement
  var whileStatement = WHILE.and(LEFT_PAREN)
    .and(expression)
    .bind(function (conditional) {
      return RIGHT_PAREN.and(statement).bind(function (body) {
        return constant(new While(conditional, body));
      });
    });
  // doWhileStatement <-
  //   DO_WHILE statement WHILE LEFT_PAREN expression RIGHT_PAREN
  var doWhileStatement = DO_WHILE.and(statement).bind(function (body) {
    return WHILE.and(LEFT_PAREN)
      .and(expression)
      .bind(function (conditional) {
        return RIGHT_PAREN.and(constant(new DoWhile(conditional, body)));
      });
  });
  // varStatement <-
  //   VAR ID ASSIGN expression SEMICOLON
  var varStatement = VAR.and(ID).bind(function (name) {
    return ASSIGN.and(expression).bind(function (value) {
      return SEMICOLON.and(constant(new Var(name, value)));
    });
  });
  // assignmentStatement <- ID ASSIGN expression SEMICOLON
  var assignmentStatement = ID.bind(function (name) {
    return ASSIGN.and(expression).bind(function (value) {
      return SEMICOLON.and(constant(new Assign(name, value)));
    });
  });
  // blockStatement <- LEFT_BRACE statement* RIGHT_BRACE
  var blockStatement = LEFT_BRACE.and(zeroOrMore(statement)).bind(function (
    statements
  ) {
    return RIGHT_BRACE.and(constant(new Block(statements)));
  });
  var statementParser = ifStatement
    .or(ifOnlyStatement)
    .or(consoleLogStatement)
    .or(doWhileStatement)
    .or(whileStatement)
    .or(varStatement)
    .or(assignmentStatement)
    .or(expressionStatement)
    .or(blockStatement);
  statement.parse = statementParser.parse;
  var parser = ignored.and(zeroOrMore(statement)).map(function (statements) {
    return new Block(statements);
  });
  var Label = (function () {
    function Label() {
      this.value = Label.counter++;
    }
    Label.prototype.toString = function () {
      return "Label".concat(this.value);
    };
    Label.counter = 0;
    return Label;
  })();
  var Environment = (function () {
    function Environment(locals, nextLocalOffset) {
      if (locals === void 0) {
        locals = new Map();
      }
      if (nextLocalOffset === void 0) {
        nextLocalOffset = 0;
      }
      this.locals = locals;
      this.nextLocalOffset = nextLocalOffset;
    }
    return Environment;
  })();
  var Main = (function () {
    function Main(statements) {
      this.statements = statements;
    }
    Main.prototype.emit = function (env) {
      emit(".global main\n");
      emit("main:\n");
      this.statements.forEach(function (statement) {
        return statement.emit(env);
      });
      emit("  mov $v0, 10\n");
      emit("  syscall\n");
    };
    return Main;
  })();
//for assigning number
  var Num = (function () {
    function Num(value) {
      this.value = value;
    }
    Num.prototype.emit = function (env) {
      emit(`  addi $a0, $zero, ${this.value} \n`);
    };
    return Num;
  })();


  var Not = (function () {
    function Not(term) {
      this.term = term;
    }
    Not.prototype.emit = function (env) {
      this.term.emit(env);
      emit("  seq $a0, $a0, $zero\n");
    };
    return Not;
  })();
  var Equal = (function () {
    function Equal(left, right) {
      this.left = left;
      this.right = right;
    }
    Equal.prototype.emit = function (env) {
      this.left.emit(env);
      emit("  addi $t1, $a0, 0\n");
      this.right.emit(env);
      emit("  seq $a0, $t1, $a0\n");
    };
    return Equal;
  })();
  var NotEqual = (function () {
    function NotEqual(left, right) {
      this.left = left;
      this.right = right;
    }
    NotEqual.prototype.emit = function (env) {
      this.left.emit(env);
      emit("  addi $t1, $a0, 0\n");
      this.right.emit(env);
      emit("  sne $a0, $t1, $a0\n");
    };
    return NotEqual;
  })();
  var Add = (function () {
    function Add(left, right) {
      this.left = left;
      this.right = right;

    // for addition we use
    }
    Add.prototype.emit = function (env) {
      this.left.emit(env);
      emit("  addi $t1, $a0, 0\n");
      this.right.emit(env);
      emit("  add $a0, $t1, $a0\n");
    };
    return Add;
  })();
  var Subtract = (function () {
    function Subtract(left, right) {
      this.left = left;
      this.right = right;
    }
    Subtract.prototype.emit = function (env) {
      this.left.emit(env);
      emit("  addi $t1, $a0, 0\n");
      this.right.emit(env);
      emit("  sub $a0, $t1, $a0\n");
    };
    return Subtract;
  })();
  var Multiply = (function () {
    function Multiply(left, right) {
      this.left = left;
      this.right = right;
    }
    Multiply.prototype.emit = function (env) {
      this.left.emit(env);
      emit("  addi $t1, $a0, 0\n");
      this.right.emit(env);
      emit("  mul $a0, $t1, $a0\n");
    };
    return Multiply;
  })();
  var Divide = (function () {
    function Divide(left, right) {
      this.left = left;
      this.right = right;
    }
    Divide.prototype.emit = function (env) {
      this.left.emit(env);
      emit("  addi $t1, $a0, 0\n");
      this.right.emit(env);
      emit("  div $a0, $t1, $a0\n");
    };
    return Divide;
  })();
  var Block = (function () {
    function Block(statements) {
      this.statements = statements;
    }
    Block.prototype.emit = function (env) {
      this.statements.forEach(function (statement) {
        return statement.emit(env);
      });
    };
    return Block;
  })();
  var If = (function () {
    function If(conditional, consequence, alternative) {
      this.conditional = conditional;
      this.consequence = consequence;
      this.alternative = alternative;
    }
    If.prototype.emit = function (env) {
      var ifFalseLabel = new Label();
      var endIfLabel = new Label();
      this.conditional.emit(env);
      emit("  beq $a0, 0, ".concat(ifFalseLabel, "\n"));
      this.consequence.emit(env);
      emit("  j ".concat(endIfLabel, "\n"));
      emit("".concat(ifFalseLabel, ":\n"));
      this.alternative.emit(env);
      emit("".concat(endIfLabel, ":\n"));
    };
    return If;
  })();
  var IfOnly = (function () {
    function IfOnly(conditional, consequence) {
      this.conditional = conditional;
      this.consequence = consequence;
    }
    IfOnly.prototype.emit = function (env) {
      var ifFalseLabel = new Label();
      this.conditional.emit(env);
      emit("  beq $a0, 0, ".concat(ifFalseLabel, "\n"));
      this.consequence.emit(env);
      emit("".concat(ifFalseLabel, ":\n"));
    };
    return IfOnly;
  })();
  var Console = (function () {
    function Console(value) {
      this.value = value;
    }
    Console.prototype.emit = function (env) {
      this.value.emit(env);
      emit("  li $v0, 1\n");
      emit("  syscall\n");
      emit("  li $v0, 4\n");
      emit("  la $a0, newline\n");
      emit("  syscall\n");
    };
    return Console;
  })();
  var Id = (function () {
    function Id(value) {
      this.value = value;
    }
    Id.prototype.emit = function (env) {
      var offset = env.locals.get(this.value);
      if (!(offset == undefined)) {
        emit(
          "  lw $a0, ".concat((env.nextLocalOffset - 1 - offset) * 4, "($sp)\n")
        );
      } else {
        throw Error("Undefined variable: ".concat(this.value, "\n"));
      }
    };
    return Id;
  })();
  var While = (function () {
    function While(conditional, body) {
      this.conditional = conditional;
      this.body = body;
    }
    While.prototype.emit = function (env) {
      var loopStart = new Label();
      var loopEnd = new Label();
      emit("".concat(loopStart, ":\n"));
      this.conditional.emit(env);
      emit("  beq $a0, $zero, ".concat(loopEnd, "\n"));
      this.body.emit(env);
      emit("  j ".concat(loopStart, "\n"));
      emit("".concat(loopEnd, ":\n"));
    };
    return While;
  })();
  var DoWhile = (function () {
    function DoWhile(conditional, body) {
      this.conditional = conditional;
      this.body = body;
    }
    DoWhile.prototype.emit = function (env) {
      var loopStart = new Label();
      var loopEnd = new Label();
      emit("".concat(loopStart, ":\n"));
      this.body.emit(env);
      this.conditional.emit(env);
      emit("  bne $a0, $zero, ".concat(loopStart, "\n"));
      emit("".concat(loopEnd, ":\n"));
    };
    return DoWhile;
  })();
  var Assign = (function () {
    function Assign(name, value) {
      this.name = name;
      this.value = value;
    }
    Assign.prototype.emit = function (env) {
      this.value.emit(env);
      var offset = env.locals.get(this.name);
      if (!(offset == undefined)) {
        emit(
          "  sw $a0,  ".concat(
            (env.nextLocalOffset - 1 - offset) * 4,
            "($sp)\n"
          )
        );
      } else {
        throw Error("Undefined variable: ".concat(this.name, "\n"));
      }
    };
    return Assign;
  })();
  var Var = (function () {
    function Var(name, value) {
      this.name = name;
      this.value = value;
    }
    Var.prototype.emit = function (env) {
      this.value.emit(env);
      emit("  addi $sp, $sp, -4\n");
      emit("  sw $a0, 0($sp)\n");
      env.locals.set(this.name, env.nextLocalOffset);
      env.nextLocalOffset += 1;
    };
    return Var;
  })();
}

document.addEventListener("DOMContentLoaded", init);
