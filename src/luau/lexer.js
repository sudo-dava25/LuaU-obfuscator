'use strict';

const TK = {
    Name: 'Name', Number: 'Number', String: 'String',
    InterpString: 'InterpString',
    Plus: '+', Minus: '-', Star: '*', Slash: '/', Percent: '%',
    Caret: '^', Hash: '#', Ampersand: '&', Tilde: '~', Pipe: '|',
    ShiftL: '<<', ShiftR: '>>', SlashSlash: '//',
    Eq: '==', NotEq: '~=', LtEq: '<=', GtEq: '>=', Lt: '<', Gt: '>',
    Assign: '=', LParen: '(', RParen: ')', LBrace: '{', RBrace: '}',
    LBracket: '[', RBracket: ']', Semicolon: ';', Colon: ':',
    ColonColon: '::', Comma: ',', Dot: '.', DotDot: '..', DotDotDot: '...',
    Arrow: '->', PlusEq: '+=', MinusEq: '-=', StarEq: '*=', SlashEq: '/=',
    PercentEq: '%=', CaretEq: '^=', DotDotEq: '..=', SlashSlashEq: '//=',
    EOF: 'EOF',
    KW_and: 'KW_and', KW_break: 'KW_break', KW_do: 'KW_do', KW_else: 'KW_else',
    KW_elseif: 'KW_elseif', KW_end: 'KW_end', KW_false: 'KW_false', KW_for: 'KW_for',
    KW_function: 'KW_function', KW_goto: 'KW_goto', KW_if: 'KW_if', KW_in: 'KW_in',
    KW_local: 'KW_local', KW_nil: 'KW_nil', KW_not: 'KW_not', KW_or: 'KW_or',
    KW_repeat: 'KW_repeat', KW_return: 'KW_return', KW_then: 'KW_then', KW_true: 'KW_true',
    KW_until: 'KW_until', KW_while: 'KW_while', KW_continue: 'KW_continue',
    KW_type: 'KW_type', KW_export: 'KW_export', KW_typeof: 'KW_typeof',
};

const KEYWORDS = new Set([
    'and','break','do','else','elseif','end','false','for','function',
    'goto','if','in','local','nil','not','or','repeat','return','then',
    'true','until','while','continue','type','export','typeof',
]);

class LexError extends Error {
    constructor(msg, line, col) {
        super(`Lex error at ${line}:${col}: ${msg}`);
        this.line = line; this.col = col;
    }
}

class Lexer {
    constructor(src) {
        this.src = src;
        this.pos = 0;
        this.line = 1;
        this.col = 1;
        this.tokens = [];
        this.ti = 0;
    }

    err(msg) { throw new LexError(msg, this.line, this.col); }

    peek(off = 0) { return this.src[this.pos + off]; }
    adv() {
        const ch = this.src[this.pos++];
        if (ch === '\n') { this.line++; this.col = 1; } else { this.col++; }
        return ch;
    }
    match(ch) { if (this.src[this.pos] === ch) { this.adv(); return true; } return false; }

    skipWhitespaceAndComments() {
        while (this.pos < this.src.length) {
            const ch = this.src[this.pos];
            if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { this.adv(); continue; }
            if (ch === '-' && this.src[this.pos + 1] === '-') {
                this.pos += 2; this.col += 2;
                if (this.src[this.pos] === '[') {
                    const level = this.countLongBracket();
                    if (level >= 0) { this.readLongString(level); continue; }
                }
                while (this.pos < this.src.length && this.src[this.pos] !== '\n') this.adv();
                continue;
            }
            break;
        }
    }

    countLongBracket() {
        let i = this.pos + 1; let level = 0;
        while (i < this.src.length && this.src[i] === '=') { level++; i++; }
        if (i < this.src.length && this.src[i] === '[') return level;
        return -1;
    }

    readLongString(level) {
        this.pos++; this.col++;
        for (let k = 0; k < level; k++) { this.pos++; this.col++; }
        this.pos++; this.col++;
        if (this.src[this.pos] === '\n') this.adv();
        const close = ']' + '='.repeat(level) + ']';
        let result = '';
        while (this.pos < this.src.length) {
            const idx = this.src.indexOf(close, this.pos);
            if (idx === -1) this.err('unfinished long string');
            const segment = this.src.slice(this.pos, idx);
            for (const ch of segment) {
                if (ch === '\n') { this.line++; this.col = 1; } else { this.col++; }
            }
            result += segment;
            this.pos = idx + close.length;
            this.col += close.length;
            return result;
        }
        this.err('unfinished long string');
    }

    readString(quote) {
        this.adv();
        let result = '';
        while (this.pos < this.src.length) {
            const ch = this.src[this.pos];
            if (ch === quote) { this.adv(); return result; }
            if (ch === '\n') this.err('unfinished string');
            if (ch === '\\') {
                this.adv();
                const esc = this.adv();
                const map = { 'n':'\n','t':'\t','r':'\r','\\':'\\','"':'"',"'":'\'','a':'\x07','b':'\x08','f':'\x0C','v':'\x0B','0':'\0' };
                if (map[esc] !== undefined) { result += map[esc]; continue; }
                if (esc === 'x') {
                    const h1 = this.adv(); const h2 = this.adv();
                    result += String.fromCharCode(parseInt(h1 + h2, 16));
                    continue;
                }
                if (esc === 'u') {
                    if (this.adv() !== '{') this.err('expected {');
                    let hex = '';
                    while (this.src[this.pos] !== '}') hex += this.adv();
                    this.adv();
                    result += String.fromCodePoint(parseInt(hex, 16));
                    continue;
                }
                if (esc >= '0' && esc <= '9') {
                    let num = esc;
                    if (this.src[this.pos] >= '0' && this.src[this.pos] <= '9') num += this.adv();
                    if (this.src[this.pos] >= '0' && this.src[this.pos] <= '9') num += this.adv();
                    result += String.fromCharCode(parseInt(num, 10));
                    continue;
                }
                result += esc;
            } else {
                result += this.adv();
            }
        }
        this.err('unfinished string');
    }

    readInterpString() {
        this.adv();
        const parts = [];
        let current = '';
        while (this.pos < this.src.length) {
            const ch = this.src[this.pos];
            if (ch === '`') { this.adv(); parts.push({ type: 'str', value: current }); return parts; }
            if (ch === '{') {
                parts.push({ type: 'str', value: current }); current = '';
                this.adv();
                let depth = 1; let exprSrc = '';
                while (this.pos < this.src.length && depth > 0) {
                    const c = this.src[this.pos];
                    if (c === '{') depth++;
                    if (c === '}') { depth--; if (depth === 0) { this.adv(); break; } }
                    exprSrc += this.adv();
                }
                parts.push({ type: 'expr', value: exprSrc });
            } else if (ch === '\\') {
                this.adv();
                const esc = this.adv();
                const map = { 'n':'\n','t':'\t','r':'\r','\\':'\\','`':'`','{':'{' };
                current += map[esc] !== undefined ? map[esc] : esc;
            } else {
                current += this.adv();
            }
        }
        this.err('unfinished interpolated string');
    }

    readNumber() {
        let num = '';
        if (this.src[this.pos] === '0' && (this.src[this.pos + 1] === 'x' || this.src[this.pos + 1] === 'X')) {
            num += this.adv() + this.adv();
            while (/[0-9a-fA-F_]/.test(this.src[this.pos])) {
                const c = this.adv(); if (c !== '_') num += c;
            }
        } else {
            while (/[0-9_]/.test(this.src[this.pos])) { const c = this.adv(); if (c !== '_') num += c; }
            if (this.src[this.pos] === '.') {
                num += this.adv();
                while (/[0-9_]/.test(this.src[this.pos])) { const c = this.adv(); if (c !== '_') num += c; }
            }
            if (this.src[this.pos] === 'e' || this.src[this.pos] === 'E') {
                num += this.adv();
                if (this.src[this.pos] === '+' || this.src[this.pos] === '-') num += this.adv();
                while (/[0-9]/.test(this.src[this.pos])) num += this.adv();
            }
        }
        return parseFloat(num);
    }

    tokenize() {
        while (true) {
            this.skipWhitespaceAndComments();
            if (this.pos >= this.src.length) { this.tokens.push({ type: TK.EOF, line: this.line, col: this.col }); break; }
            const line = this.line; const col = this.col;
            const ch = this.src[this.pos];

            if (ch === '`') {
                const parts = this.readInterpString();
                this.tokens.push({ type: TK.InterpString, value: parts, line, col }); continue;
            }
            if (ch === '"' || ch === "'") {
                const val = this.readString(ch);
                this.tokens.push({ type: TK.String, value: val, line, col }); continue;
            }
            if (ch === '[') {
                const level = this.countLongBracket();
                if (level >= 0) {
                    const val = this.readLongString(level);
                    this.tokens.push({ type: TK.String, value: val, line, col }); continue;
                }
            }
            if (ch >= '0' && ch <= '9') {
                const val = this.readNumber();
                this.tokens.push({ type: TK.Number, value: val, line, col }); continue;
            }
            if (ch === '.' && this.src[this.pos + 1] >= '0' && this.src[this.pos + 1] <= '9') {
                const val = this.readNumber();
                this.tokens.push({ type: TK.Number, value: val, line, col }); continue;
            }
            if (/[a-zA-Z_]/.test(ch)) {
                let name = '';
                while (this.pos < this.src.length && /[a-zA-Z0-9_]/.test(this.src[this.pos])) name += this.adv();
                const type = KEYWORDS.has(name) ? `KW_${name}` : TK.Name;
                this.tokens.push({ type, value: name, line, col }); continue;
            }

            this.adv();
            switch (ch) {
                case '+': this.tokens.push({ type: this.match('=') ? TK.PlusEq : TK.Plus, line, col }); break;
                case '*': this.tokens.push({ type: this.match('=') ? TK.StarEq : TK.Star, line, col }); break;
                case '%': this.tokens.push({ type: this.match('=') ? TK.PercentEq : TK.Percent, line, col }); break;
                case '^': this.tokens.push({ type: this.match('=') ? TK.CaretEq : TK.Caret, line, col }); break;
                case '&': this.tokens.push({ type: TK.Ampersand, line, col }); break;
                case '|': this.tokens.push({ type: TK.Pipe, line, col }); break;
                case '(': this.tokens.push({ type: TK.LParen, line, col }); break;
                case ')': this.tokens.push({ type: TK.RParen, line, col }); break;
                case '{': this.tokens.push({ type: TK.LBrace, line, col }); break;
                case '}': this.tokens.push({ type: TK.RBrace, line, col }); break;
                case ']': this.tokens.push({ type: TK.RBracket, line, col }); break;
                case '[': this.tokens.push({ type: TK.LBracket, line, col }); break;
                case ';': this.tokens.push({ type: TK.Semicolon, line, col }); break;
                case ',': this.tokens.push({ type: TK.Comma, line, col }); break;
                case '#': this.tokens.push({ type: TK.Hash, line, col }); break;
                case '~': this.tokens.push({ type: this.match('=') ? TK.NotEq : TK.Tilde, line, col }); break;
                case '=': this.tokens.push({ type: this.match('=') ? TK.Eq : TK.Assign, line, col }); break;
                case '<': {
                    if (this.match('<')) this.tokens.push({ type: TK.ShiftL, line, col });
                    else if (this.match('=')) this.tokens.push({ type: TK.LtEq, line, col });
                    else this.tokens.push({ type: TK.Lt, line, col });
                    break;
                }
                case '>': {
                    if (this.match('>')) this.tokens.push({ type: TK.ShiftR, line, col });
                    else if (this.match('=')) this.tokens.push({ type: TK.GtEq, line, col });
                    else this.tokens.push({ type: TK.Gt, line, col });
                    break;
                }
                case ':': this.tokens.push({ type: this.match(':') ? TK.ColonColon : TK.Colon, line, col }); break;
                case '-': {
                    if (this.match('>')) this.tokens.push({ type: TK.Arrow, line, col });
                    else if (this.match('=')) this.tokens.push({ type: TK.MinusEq, line, col });
                    else this.tokens.push({ type: TK.Minus, line, col });
                    break;
                }
                case '/': {
                    if (this.match('/')) {
                        if (this.match('=')) this.tokens.push({ type: TK.SlashSlashEq, line, col });
                        else this.tokens.push({ type: TK.SlashSlash, line, col });
                    } else if (this.match('=')) this.tokens.push({ type: TK.SlashEq, line, col });
                    else this.tokens.push({ type: TK.Slash, line, col });
                    break;
                }
                case '.': {
                    if (this.match('.')) {
                        if (this.match('.')) this.tokens.push({ type: TK.DotDotDot, line, col });
                        else if (this.match('=')) this.tokens.push({ type: TK.DotDotEq, line, col });
                        else this.tokens.push({ type: TK.DotDot, line, col });
                    } else this.tokens.push({ type: TK.Dot, line, col });
                    break;
                }
                default: this.err(`unexpected character '${ch}'`);
            }
        }
        return this.tokens;
    }
}

module.exports = { Lexer, TK, KEYWORDS };
