'use strict';

const { Lexer, TK } = require('./lexer');

class ParseError extends Error {
    constructor(msg, line, col) {
        super(`Parse error at ${line}:${col}: ${msg}`);
        this.code = 'PARSE_ERROR'; this.line = line; this.col = col;
    }
}

class Parser {
    constructor(tokens) {
        this.tokens = tokens;
        this.pos = 0;
    }

    peek() { return this.tokens[this.pos]; }
    prev() { return this.tokens[this.pos - 1]; }
    adv() { const t = this.tokens[this.pos]; if (t.type !== TK.EOF) this.pos++; return t; }

    check(type) { return this.peek().type === type; }
    match(...types) { if (types.includes(this.peek().type)) { return this.adv(); } return null; }
    expect(type) {
        if (!this.check(type)) {
            const t = this.peek();
            throw new ParseError(`expected '${type}' got '${t.type}'`, t.line, t.col);
        }
        return this.adv();
    }

    skipTypeAnnotation() {
        if (!this.check(TK.Colon) && !this.check(TK.Arrow)) return;
        if (this.check(TK.Arrow)) { this.adv(); this.parseTypeExpr(); return; }
        this.adv();
        this.parseTypeExpr();
    }

    parseTypeExpr() {
        this.parseTypePrimary();
        while (this.check(TK.Pipe) || this.check(TK.Ampersand)) { this.adv(); this.parseTypePrimary(); }
        if (this.check(TK.Arrow)) { this.adv(); this.parseTypeExpr(); }
    }

    parseTypePrimary() {
        if (this.check(TK.LParen)) {
            this.adv();
            if (!this.check(TK.RParen)) {
                this.parseTypeExpr();
                while (this.match(TK.Comma) && !this.check(TK.RParen)) this.parseTypeExpr();
            }
            this.expect(TK.RParen);
            if (this.check(TK.Arrow)) { this.adv(); this.parseTypeExpr(); }
            return;
        }
        if (this.check(TK.LBrace)) {
            this.adv();
            while (!this.check(TK.RBrace) && !this.check(TK.EOF)) {
                if (this.check(TK.LBracket)) { this.adv(); this.parseTypeExpr(); this.expect(TK.RBracket); this.expect(TK.Colon); }
                else if (this.check(TK.Name)) { this.adv(); if (this.check(TK.Colon)) { this.adv(); } else { continue; } }
                this.parseTypeExpr();
                this.match(TK.Comma);
            }
            this.expect(TK.RBrace);
            return;
        }
        if (this.match(TK.KW_typeof)) {
            this.expect(TK.LParen); this.parseExpr(); this.expect(TK.RParen); return;
        }
        if (this.check(TK.Name) || this.check(TK.KW_nil) || this.check(TK.KW_true) || this.check(TK.KW_false)) {
            this.adv();
            if (this.check(TK.Dot)) { this.adv(); this.expect(TK.Name); }
            if (this.check(TK.Lt)) { this.adv(); this.parseTypeArgs(); }
        }
        while (this.check(TK.LBracket) && this.tokens[this.pos + 1] && this.tokens[this.pos + 1].type === TK.RBracket) {
            this.adv(); this.adv();
        }
        if (this.match(TK.Tilde)) {}
        this.match('?');
    }

    parseTypeArgs() {
        let depth = 1;
        while (!this.check(TK.EOF) && depth > 0) {
            if (this.check(TK.Lt)) depth++;
            if (this.check(TK.Gt)) { depth--; if (depth === 0) { this.adv(); return; } }
            this.adv();
        }
    }

    parseBlock() {
        const body = [];
        while (true) {
            const t = this.peek();
            if (t.type === TK.EOF || t.type === TK.KW_end || t.type === TK.KW_else ||
                t.type === TK.KW_elseif || t.type === TK.KW_until) break;
            const stmt = this.parseStatement();
            if (stmt) body.push(stmt);
            this.match(TK.Semicolon);
            if (stmt && stmt.type === 'ReturnStatement') break;
        }
        return body;
    }

    parseStatement() {
        const t = this.peek();
        switch (t.type) {
            case TK.KW_local: return this.parseLocal();
            case TK.KW_if: return this.parseIf();
            case TK.KW_while: return this.parseWhile();
            case TK.KW_repeat: return this.parseRepeat();
            case TK.KW_for: return this.parseFor();
            case TK.KW_do: return this.parseDo();
            case TK.KW_return: return this.parseReturn();
            case TK.KW_break: this.adv(); return { type: 'BreakStatement' };
            case TK.KW_continue: this.adv(); return { type: 'GotoStatement', label: { type: 'Identifier', name: '__continue__' } };
            case TK.KW_goto: return this.parseGoto();
            case TK.ColonColon: return this.parseLabel();
            case TK.KW_function: return this.parseFunctionDecl(false);
            case TK.KW_type: return this.parseTypeDecl();
            case TK.KW_export: {
                this.adv();
                if (this.check(TK.KW_type)) return this.parseTypeDecl();
                throw new ParseError(`expected 'type' after 'export'`, t.line, t.col);
            }
            case TK.Semicolon: this.adv(); return null;
            default: return this.parseExprStat();
        }
    }

    parseTypeDecl() {
        this.adv();
        this.expect(TK.Name);
        if (this.check(TK.Lt)) { this.adv(); this.parseTypeArgs(); }
        this.expect(TK.Assign);
        this.parseTypeExpr();
        return null;
    }

    parseLocal() {
        this.adv();
        if (this.check(TK.KW_function)) {
            this.adv();
            const name = this.expect(TK.Name);
            const fn = this.parseFuncBody();
            return { type: 'FunctionDeclaration', identifier: { type: 'Identifier', name: name.value }, isLocal: true, parameters: fn.parameters, body: fn.body };
        }
        const vars = [];
        vars.push(this.parseName());
        if (this.check(TK.Colon)) { this.adv(); this.parseTypeExpr(); }
        while (this.match(TK.Comma)) {
            vars.push(this.parseName());
            if (this.check(TK.Colon)) { this.adv(); this.parseTypeExpr(); }
        }
        const init = [];
        if (this.match(TK.Assign)) {
            init.push(this.parseExpr());
            while (this.match(TK.Comma)) init.push(this.parseExpr());
        }
        return { type: 'LocalStatement', variables: vars, init };
    }

    parseIf() {
        this.adv();
        const clauses = [];
        const cond = this.parseExpr();
        this.expect(TK.KW_then);
        const body = this.parseBlock();
        clauses.push({ type: 'IfClause', condition: cond, body });
        while (this.check(TK.KW_elseif)) {
            this.adv();
            const ec = this.parseExpr();
            this.expect(TK.KW_then);
            const eb = this.parseBlock();
            clauses.push({ type: 'ElseifClause', condition: ec, body: eb });
        }
        if (this.match(TK.KW_else)) {
            clauses.push({ type: 'ElseClause', body: this.parseBlock() });
        }
        this.expect(TK.KW_end);
        return { type: 'IfStatement', clauses };
    }

    parseWhile() {
        this.adv();
        const condition = this.parseExpr();
        this.expect(TK.KW_do);
        const body = this.parseBlock();
        this.expect(TK.KW_end);
        return { type: 'WhileStatement', condition, body };
    }

    parseRepeat() {
        this.adv();
        const body = this.parseBlock();
        this.expect(TK.KW_until);
        const condition = this.parseExpr();
        return { type: 'RepeatStatement', body, condition };
    }

    parseFor() {
        this.adv();
        const name = this.parseName();
        if (this.match(TK.Assign)) {
            const start = this.parseExpr();
            this.expect(TK.Comma);
            const limit = this.parseExpr();
            let step = null;
            if (this.match(TK.Comma)) step = this.parseExpr();
            this.expect(TK.KW_do);
            const body = this.parseBlock();
            this.expect(TK.KW_end);
            return { type: 'NumericForStatement', variable: name, start, limit, step, body };
        }
        const variables = [name];
        while (this.match(TK.Comma)) variables.push(this.parseName());
        this.expect(TK.KW_in);
        const iterators = [this.parseExpr()];
        while (this.match(TK.Comma)) iterators.push(this.parseExpr());
        this.expect(TK.KW_do);
        const body = this.parseBlock();
        this.expect(TK.KW_end);
        return { type: 'GenericForStatement', variables, iterators, body };
    }

    parseDo() {
        this.adv();
        const body = this.parseBlock();
        this.expect(TK.KW_end);
        return { type: 'DoStatement', body };
    }

    parseReturn() {
        this.adv();
        const args = [];
        const t = this.peek();
        if (t.type !== TK.KW_end && t.type !== TK.KW_else && t.type !== TK.KW_elseif &&
            t.type !== TK.KW_until && t.type !== TK.EOF && t.type !== TK.Semicolon) {
            args.push(this.parseExpr());
            while (this.match(TK.Comma)) args.push(this.parseExpr());
        }
        this.match(TK.Semicolon);
        return { type: 'ReturnStatement', arguments: args };
    }

    parseGoto() {
        this.adv();
        const name = this.expect(TK.Name);
        return { type: 'GotoStatement', label: { type: 'Identifier', name: name.value } };
    }

    parseLabel() {
        this.adv();
        const name = this.expect(TK.Name);
        this.expect(TK.ColonColon);
        return { type: 'LabelStatement', label: { type: 'Identifier', name: name.value } };
    }

    parseFunctionDecl(isLocal) {
        this.adv();
        let identifier = this.parseName();
        let base = identifier;
        while (this.check(TK.Dot)) {
            this.adv();
            const field = this.parseName();
            base = { type: 'MemberExpression', base, indexer: '.', identifier: field };
        }
        let isMethod = false;
        if (this.check(TK.Colon)) {
            this.adv();
            const method = this.parseName();
            base = { type: 'MemberExpression', base, indexer: ':', identifier: method };
            isMethod = true;
        }
        const fn = this.parseFuncBody(isMethod);
        return { type: 'FunctionDeclaration', identifier: base, isLocal: false, parameters: fn.parameters, body: fn.body };
    }

    parseFuncBody(isMethod = false) {
        if (this.check(TK.Lt)) { this.adv(); this.parseTypeArgs(); }
        this.expect(TK.LParen);
        const parameters = [];
        if (isMethod) parameters.push({ type: 'Identifier', name: 'self' });
        if (!this.check(TK.RParen)) {
            if (this.check(TK.DotDotDot)) { this.adv(); parameters.push({ type: 'VarargLiteral' }); }
            else {
                parameters.push(this.parseName());
                if (this.check(TK.Colon)) { this.adv(); this.parseTypeExpr(); }
                while (this.match(TK.Comma) && !this.check(TK.RParen)) {
                    if (this.check(TK.DotDotDot)) { this.adv(); parameters.push({ type: 'VarargLiteral' }); break; }
                    parameters.push(this.parseName());
                    if (this.check(TK.Colon)) { this.adv(); this.parseTypeExpr(); }
                }
            }
        }
        this.expect(TK.RParen);
        if (this.check(TK.Colon)) { this.adv(); this.parseTypeExpr(); }
        if (this.check(TK.Arrow)) { this.adv(); this.parseTypeExpr(); }
        const body = this.parseBlock();
        this.expect(TK.KW_end);
        return { parameters, body };
    }

    parseExprStat() {
        const expr = this.parseSuffixedExpr();
        const compoundMap = {
            [TK.PlusEq]: '+', [TK.MinusEq]: '-', [TK.StarEq]: '*', [TK.SlashEq]: '/',
            [TK.PercentEq]: '%', [TK.CaretEq]: '^', [TK.DotDotEq]: '..', [TK.SlashSlashEq]: '//',
        };
        if (compoundMap[this.peek().type]) {
            const op = compoundMap[this.adv().type];
            const rhs = this.parseExpr();
            const value = { type: 'BinaryExpression', operator: op, left: this.exprToLoad(expr), right: rhs };
            return { type: 'AssignmentStatement', variables: [expr], init: [value] };
        }
        if (this.check(TK.Assign) || this.check(TK.Comma)) {
            const vars = [expr];
            while (this.match(TK.Comma)) vars.push(this.parseSuffixedExpr());
            this.expect(TK.Assign);
            const init = [this.parseExpr()];
            while (this.match(TK.Comma)) init.push(this.parseExpr());
            return { type: 'AssignmentStatement', variables: vars, init };
        }
        if (expr.type === 'CallExpression' || expr.type === 'MethodCallExpression' ||
            expr.type === 'StringCallExpression' || expr.type === 'TableCallExpression') {
            return { type: 'CallStatement', expression: expr };
        }
        const t = this.peek();
        throw new ParseError(`syntax error near '${t.type}'`, t.line, t.col);
    }

    exprToLoad(expr) { return expr; }

    parseName() {
        const t = this.expect(TK.Name);
        return { type: 'Identifier', name: t.value };
    }

    parseExpr() { return this.parseOr(); }

    parseOr() {
        let left = this.parseAnd();
        while (this.check(TK.KW_or)) { this.adv(); const right = this.parseAnd(); left = { type: 'LogicalExpression', operator: 'or', left, right }; }
        return left;
    }

    parseAnd() {
        let left = this.parseComparison();
        while (this.check(TK.KW_and)) { this.adv(); const right = this.parseComparison(); left = { type: 'LogicalExpression', operator: 'and', left, right }; }
        return left;
    }

    parseComparison() {
        let left = this.parseBitOr();
        const ops = { [TK.Lt]:'<',[TK.Gt]:'>',[TK.LtEq]:'<=',[TK.GtEq]:'>=',[TK.Eq]:'==',[TK.NotEq]:'~=' };
        while (ops[this.peek().type]) { const op = ops[this.adv().type]; const right = this.parseBitOr(); left = { type: 'BinaryExpression', operator: op, left, right }; }
        return left;
    }

    parseBitOr() {
        let left = this.parseBitXor();
        while (this.check(TK.Pipe)) { this.adv(); const right = this.parseBitXor(); left = { type: 'BinaryExpression', operator: '|', left, right }; }
        return left;
    }

    parseBitXor() {
        let left = this.parseBitAnd();
        while (this.check(TK.Tilde)) { this.adv(); const right = this.parseBitAnd(); left = { type: 'BinaryExpression', operator: '~', left, right }; }
        return left;
    }

    parseBitAnd() {
        let left = this.parseBitShift();
        while (this.check(TK.Ampersand)) { this.adv(); const right = this.parseBitShift(); left = { type: 'BinaryExpression', operator: '&', left, right }; }
        return left;
    }

    parseBitShift() {
        let left = this.parseConcat();
        while (this.check(TK.ShiftL) || this.check(TK.ShiftR)) { const op = this.adv().type === TK.ShiftL ? '<<' : '>>'; const right = this.parseConcat(); left = { type: 'BinaryExpression', operator: op, left, right }; }
        return left;
    }

    parseConcat() {
        const left = this.parseAddSub();
        if (this.check(TK.DotDot)) { this.adv(); const right = this.parseConcat(); return { type: 'BinaryExpression', operator: '..', left, right }; }
        return left;
    }

    parseAddSub() {
        let left = this.parseMulDiv();
        while (this.check(TK.Plus) || this.check(TK.Minus)) { const op = this.adv().type === TK.Plus ? '+' : '-'; const right = this.parseMulDiv(); left = { type: 'BinaryExpression', operator: op, left, right }; }
        return left;
    }

    parseMulDiv() {
        let left = this.parseUnary();
        const ops = { [TK.Star]:'*',[TK.Slash]:'/',[TK.Percent]:'%',[TK.SlashSlash]:'//  ' };
        const opsFix = { [TK.Star]:'*',[TK.Slash]:'/',[TK.Percent]:'%',[TK.SlashSlash]:'//  ' };
        const omap = { [TK.Star]:'*',[TK.Slash]:'/',[TK.Percent]:'%',[TK.SlashSlash]:'//' };
        while (omap[this.peek().type]) { const op = omap[this.adv().type]; const right = this.parseUnary(); left = { type: 'BinaryExpression', operator: op, left, right }; }
        return left;
    }

    parseUnary() {
        if (this.check(TK.KW_not)) { this.adv(); return { type: 'UnaryExpression', operator: 'not', argument: this.parseUnary() }; }
        if (this.check(TK.Minus)) { this.adv(); return { type: 'UnaryExpression', operator: '-', argument: this.parseUnary() }; }
        if (this.check(TK.Hash)) { this.adv(); return { type: 'UnaryExpression', operator: '#', argument: this.parseUnary() }; }
        if (this.check(TK.Tilde)) { this.adv(); return { type: 'UnaryExpression', operator: '~', argument: this.parseUnary() }; }
        return this.parsePower();
    }

    parsePower() {
        const base = this.parseSuffixedExpr();
        if (this.check(TK.Caret)) { this.adv(); const exp = this.parseUnary(); return { type: 'BinaryExpression', operator: '^', left: base, right: exp }; }
        return base;
    }

    parseSuffixedExpr() {
        let base = this.parsePrimary();
        while (true) {
            if (this.check(TK.Dot)) {
                this.adv();
                const field = this.expect(TK.Name);
                base = { type: 'MemberExpression', base, indexer: '.', identifier: { type: 'Identifier', name: field.value } };
            } else if (this.check(TK.LBracket)) {
                this.adv();
                const idx = this.parseExpr();
                this.expect(TK.RBracket);
                base = { type: 'IndexExpression', base, index: idx };
            } else if (this.check(TK.Colon)) {
                this.adv();
                const method = this.expect(TK.Name);
                const args = this.parseCallArgs();
                base = { type: 'MethodCallExpression', base, identifier: { type: 'Identifier', name: method.value }, arguments: args };
            } else if (this.check(TK.LParen) || this.check(TK.LBrace) || this.check(TK.String)) {
                const args = this.parseCallArgs();
                if (typeof args === 'string') {
                    base = { type: 'StringCallExpression', base, argument: { type: 'StringLiteral', value: args } };
                } else if (!Array.isArray(args)) {
                    base = { type: 'TableCallExpression', base, arguments: args };
                } else {
                    base = { type: 'CallExpression', base, arguments: args };
                }
            } else break;
        }
        return base;
    }

    parseCallArgs() {
        if (this.check(TK.LParen)) {
            this.adv();
            const args = [];
            if (!this.check(TK.RParen)) {
                args.push(this.parseExpr());
                while (this.match(TK.Comma)) args.push(this.parseExpr());
            }
            this.expect(TK.RParen);
            return args;
        }
        if (this.check(TK.LBrace)) return this.parseTable();
        if (this.check(TK.String)) {
            const val = this.adv().value;
            return val;
        }
        throw new ParseError(`expected function arguments`, this.peek().line, this.peek().col);
    }

    parsePrimary() {
        const t = this.peek();
        if (t.type === TK.Name) { this.adv(); return { type: 'Identifier', name: t.value }; }
        if (t.type === TK.LParen) {
            this.adv();
            const expr = this.parseExpr();
            this.expect(TK.RParen);
            return expr;
        }
        return this.parseSimpleExpr();
    }

    parseSimpleExpr() {
        const t = this.peek();
        if (t.type === TK.Number) { this.adv(); return { type: 'NumericLiteral', value: t.value }; }
        if (t.type === TK.String) { this.adv(); return { type: 'StringLiteral', value: t.value }; }
        if (t.type === TK.KW_true) { this.adv(); return { type: 'BooleanLiteral', value: true }; }
        if (t.type === TK.KW_false) { this.adv(); return { type: 'BooleanLiteral', value: false }; }
        if (t.type === TK.KW_nil) { this.adv(); return { type: 'NilLiteral', value: null }; }
        if (t.type === TK.DotDotDot) { this.adv(); return { type: 'VarargLiteral' }; }
        if (t.type === TK.LBrace) return this.parseTable();
        if (t.type === TK.KW_function) { this.adv(); const fn = this.parseFuncBody(); return { type: 'FunctionExpression', parameters: fn.parameters, body: fn.body }; }
        if (t.type === TK.InterpString) { this.adv(); return this.interpStringToAST(t.value); }
        if (t.type === TK.KW_if) { return this.parseIfExpr(); }
        throw new ParseError(`unexpected token '${t.type}'`, t.line, t.col);
    }

    interpStringToAST(parts) {
        if (parts.length === 0) return { type: 'StringLiteral', value: '' };
        const nodes = parts.map(p => {
            if (p.type === 'str') return { type: 'StringLiteral', value: p.value };
            const subLexer = new Lexer(p.value);
            const subTokens = subLexer.tokenize();
            const subParser = new Parser(subTokens);
            return subParser.parseExpr();
        });
        const toStr = n => ({
            type: 'CallExpression',
            base: { type: 'Identifier', name: 'tostring' },
            arguments: [n],
        });
        let result = nodes[0].type === 'StringLiteral' ? nodes[0] : toStr(nodes[0]);
        for (let i = 1; i < nodes.length; i++) {
            const right = nodes[i].type === 'StringLiteral' ? nodes[i] : toStr(nodes[i]);
            result = { type: 'BinaryExpression', operator: '..', left: result, right };
        }
        return result;
    }

    parseIfExpr() {
        this.adv();
        const condition = this.parseExpr();
        this.expect(TK.KW_then);
        const consequent = this.parseExpr();
        this.expect(TK.KW_else);
        const alternate = this.parseExpr();
        return { type: 'IfExpression', condition, consequent, alternate };
    }

    parseTable() {
        this.expect(TK.LBrace);
        const fields = [];
        while (!this.check(TK.RBrace) && !this.check(TK.EOF)) {
            if (this.check(TK.LBracket)) {
                this.adv(); const key = this.parseExpr(); this.expect(TK.RBracket); this.expect(TK.Assign); const val = this.parseExpr();
                fields.push({ type: 'TableKey', key, value: val });
            } else if (this.check(TK.Name) && this.tokens[this.pos + 1] && this.tokens[this.pos + 1].type === TK.Assign) {
                const key = this.adv(); this.adv(); const val = this.parseExpr();
                fields.push({ type: 'TableKeyString', key: { type: 'Identifier', name: key.value }, value: val });
            } else {
                fields.push({ type: 'TableValue', value: this.parseExpr() });
            }
            if (!this.match(TK.Comma) && !this.match(TK.Semicolon)) break;
        }
        this.expect(TK.RBrace);
        return { type: 'TableConstructorExpression', fields };
    }

    parse() {
        const body = this.parseBlock();
        if (!this.check(TK.EOF)) {
            const t = this.peek();
            throw new ParseError(`unexpected token '${t.type}'`, t.line, t.col);
        }
        return { type: 'Chunk', body };
    }
}

function parseLuaU(source) {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    return parser.parse();
}

module.exports = { parseLuaU };
