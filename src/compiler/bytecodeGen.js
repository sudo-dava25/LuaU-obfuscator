const { randomInt } = require('../utils/nameGen');

const OPCODES = {
    LOAD_CONST:    0x01,
    LOAD_VAR:      0x02,
    STORE_VAR:     0x03,
    LOAD_GLOBAL:   0x04,
    STORE_GLOBAL:  0x05,
    CALL:          0x06,
    RETURN:        0x07,
    ADD:           0x08,
    SUB:           0x09,
    MUL:           0x0A,
    DIV:           0x0B,
    MOD:           0x0C,
    POW:           0x0D,
    CONCAT:        0x0E,
    EQ:            0x0F,
    NEQ:           0x10,
    LT:            0x11,
    LE:            0x12,
    GT:            0x13,
    GE:            0x14,
    AND:           0x15,
    OR:            0x16,
    NOT:           0x17,
    NEGATE:        0x18,
    JUMP:          0x19,
    JUMP_IF_FALSE: 0x1A,
    JUMP_IF_TRUE:  0x1B,
    GET_TABLE:     0x1C,
    SET_TABLE:     0x1D,
    NEW_TABLE:     0x1E,
    LENGTH:        0x1F,
    LOAD_NIL:      0x20,
    LOAD_BOOL:     0x21,
    CLOSE_UPVAL:   0x22,
    MAKE_CLOSURE:  0x23,
    LOAD_UPVAL:    0x24,
    STORE_UPVAL:   0x25,
    VARARG:        0x26,
    MULTI_RETURN:  0x27,
    PUSH_ARGS:     0x28,
    POP:           0x29,
    DUP:           0x2A,
    IDIV:          0x2B,
    BAND:          0x2C,
    BOR:           0x2D,
    BXOR:          0x2E,
    BNOT:          0x2F,
    SHL:           0x30,
    SHR:           0x31,
    HALT:          0xFF,
};

class BytecodeCompiler {
    constructor() {
        this.instructions = [];
        this.constants = [];
        this.constantMap = new Map();
        this.locals = [];
        this.upvalues = [];
        this.functions = [];
        this.labels = new Map();
        this.pendingJumps = [];
        this.pendingGotoJumps = [];
        this.scopeStack = [{ vars: new Map() }];
    }

    addConstant(value) {
        const key = typeof value + ':' + JSON.stringify(value);
        if (this.constantMap.has(key)) return this.constantMap.get(key);
        const idx = this.constants.length;
        this.constants.push(value);
        this.constantMap.set(key, idx);
        return idx;
    }

    emit(opcode, ...operands) {
        const pos = this.instructions.length;
        this.instructions.push({ opcode, operands, pos });
        return pos;
    }

    emitJump(opcode) {
        return this.emit(opcode, 0);
    }

    patchJump(jumpPos) {
        this.instructions[jumpPos].operands[0] = this.instructions.length;
    }

    currentScope() {
        return this.scopeStack[this.scopeStack.length - 1];
    }

    pushScope() {
        this.scopeStack.push({ vars: new Map() });
    }

    popScope() {
        this.scopeStack.pop();
    }

    resolveLocal(name) {
        for (let i = this.scopeStack.length - 1; i >= 0; i--) {
            if (this.scopeStack[i].vars.has(name)) {
                return { type: 'local', index: this.scopeStack[i].vars.get(name) };
            }
        }
        return null;
    }

    declareLocal(name) {
        const idx = this.locals.length;
        this.locals.push(name);
        this.currentScope().vars.set(name, idx);
        return idx;
    }

    compileNode(node) {
        if (!node) return;
        const handler = this.nodeHandlers[node.type];
        if (!handler) throw new Error(`Unsupported AST node: ${node.type}`);
        return handler.call(this, node);
    }

    get nodeHandlers() {
        return {
            Chunk: (node) => {
                for (const stmt of node.body) this.compileNode(stmt);
                this.emit(OPCODES.HALT);
            },

            LabelStatement: (node) => {
                const labelName = node.label && node.label.name ? node.label.name : String(node.label);
                const pos = this.instructions.length;
                this.labels.set(labelName, pos);
                for (const pending of this.pendingGotoJumps) {
                    if (pending.label === labelName) {
                        this.instructions[pending.pos].operands[0] = pos;
                    }
                }
                this.pendingGotoJumps = this.pendingGotoJumps.filter(p => p.label !== labelName);
            },

            GotoStatement: (node) => {
                const labelName = node.label && node.label.name ? node.label.name : String(node.label);
                if (this.labels.has(labelName)) {
                    this.emit(OPCODES.JUMP, this.labels.get(labelName));
                } else {
                    const pos = this.emitJump(OPCODES.JUMP);
                    this.pendingGotoJumps.push({ label: labelName, pos });
                }
            },

            LocalStatement: (node) => {
                const initCount = node.init.length;
                for (let i = 0; i < node.variables.length; i++) {
                    if (i < initCount) {
                        this.compileNode(node.init[i]);
                    } else {
                        this.emit(OPCODES.LOAD_NIL);
                    }
                    this.declareLocal(node.variables[i].name);
                    this.emit(OPCODES.STORE_VAR, this.locals.length - 1);
                }
            },

            AssignmentStatement: (node) => {
                for (let i = 0; i < node.variables.length; i++) {
                    if (i < node.init.length) {
                        this.compileNode(node.init[i]);
                    } else {
                        this.emit(OPCODES.LOAD_NIL);
                    }
                    const target = node.variables[i];
                    if (target.type === 'Identifier') {
                        const local = this.resolveLocal(target.name);
                        if (local) {
                            this.emit(OPCODES.STORE_VAR, local.index);
                        } else {
                            const cidx = this.addConstant(target.name);
                            this.emit(OPCODES.STORE_GLOBAL, cidx);
                        }
                    } else if (target.type === 'MemberExpression') {
                        this.compileNode(target.base);
                        if (target.indexer === '.') {
                            const cidx = this.addConstant(target.identifier.name);
                            this.emit(OPCODES.SET_TABLE, cidx);
                        } else {
                            this.compileNode(target.index);
                            this.emit(OPCODES.SET_TABLE, -1);
                        }
                    }
                }
            },

            CallStatement: (node) => {
                this.compileNode(node.expression);
                this.emit(OPCODES.POP);
            },

            CallExpression: (node) => {
                this.compileNode(node.base);
                for (const arg of node.arguments) this.compileNode(arg);
                this.emit(OPCODES.CALL, node.arguments.length);
            },

            StringCallExpression: (node) => {
                this.compileNode(node.base);
                const cidx = this.addConstant(node.argument.value || node.argument.raw);
                this.emit(OPCODES.LOAD_CONST, cidx);
                this.emit(OPCODES.CALL, 1);
            },

            TableCallExpression: (node) => {
                this.compileNode(node.base);
                this.compileNode(node.arguments);
                this.emit(OPCODES.CALL, 1);
            },

            MethodCallExpression: (node) => {
                this.compileNode(node.base);
                const mkey = this.addConstant(node.identifier.name);
                this.emit(OPCODES.GET_TABLE, mkey);
                this.compileNode(node.base);
                for (const arg of node.arguments) this.compileNode(arg);
                this.emit(OPCODES.CALL, node.arguments.length + 1);
            },

            IfStatement: (node) => {
                const exitJumps = [];
                for (const clause of node.clauses) {
                    if (clause.type === 'IfClause' || clause.type === 'ElseifClause') {
                        this.compileNode(clause.condition);
                        const jumpFalse = this.emitJump(OPCODES.JUMP_IF_FALSE);
                        this.pushScope();
                        for (const stmt of clause.body) this.compileNode(stmt);
                        this.popScope();
                        exitJumps.push(this.emitJump(OPCODES.JUMP));
                        this.patchJump(jumpFalse);
                    } else if (clause.type === 'ElseClause') {
                        this.pushScope();
                        for (const stmt of clause.body) this.compileNode(stmt);
                        this.popScope();
                    }
                }
                for (const j of exitJumps) this.patchJump(j);
            },

            WhileStatement: (node) => {
                const loopStart = this.instructions.length;
                this.labels.set('__continue__', loopStart);
                this.compileNode(node.condition);
                const exitJump = this.emitJump(OPCODES.JUMP_IF_FALSE);
                this.pushScope();
                for (const stmt of node.body) this.compileNode(stmt);
                this.popScope();
                this.emit(OPCODES.JUMP, loopStart);
                this.patchJump(exitJump);
            },

            RepeatStatement: (node) => {
                const loopStart = this.instructions.length;
                this.labels.set('__continue__', loopStart);
                this.pushScope();
                for (const stmt of node.body) this.compileNode(stmt);
                this.compileNode(node.condition);
                this.emit(OPCODES.JUMP_IF_FALSE, loopStart);
                this.popScope();
            },

            NumericForStatement: (node) => {
                this.compileNode(node.start);
                this.compileNode(node.limit);
                if (node.step) {
                    this.compileNode(node.step);
                } else {
                    this.emit(OPCODES.LOAD_CONST, this.addConstant(1));
                }
                const iterVar = this.declareLocal(node.variable.name);
                this.emit(OPCODES.STORE_VAR, iterVar);
                const loopStart = this.instructions.length;
                this.labels.set('__continue__', loopStart);
                this.emit(OPCODES.LOAD_VAR, iterVar);
                this.emit(OPCODES.LOAD_CONST, this.addConstant('__limit__'));
                this.emit(OPCODES.LE);
                const exitJump = this.emitJump(OPCODES.JUMP_IF_FALSE);
                this.pushScope();
                for (const stmt of node.body) this.compileNode(stmt);
                this.popScope();
                this.emit(OPCODES.LOAD_VAR, iterVar);
                this.emit(OPCODES.LOAD_CONST, this.addConstant(1));
                this.emit(OPCODES.ADD);
                this.emit(OPCODES.STORE_VAR, iterVar);
                this.emit(OPCODES.JUMP, loopStart);
                this.patchJump(exitJump);
            },

            GenericForStatement: (node) => {
                for (const iter of node.iterators) this.compileNode(iter);
                const iterFunc = this.declareLocal('__iterFunc__');
                this.emit(OPCODES.STORE_VAR, iterFunc);
                const loopStart = this.instructions.length;
                this.labels.set('__continue__', loopStart);
                this.emit(OPCODES.LOAD_VAR, iterFunc);
                this.emit(OPCODES.CALL, 0);
                const exitJump = this.emitJump(OPCODES.JUMP_IF_FALSE);
                this.pushScope();
                for (const v of node.variables) {
                    const idx = this.declareLocal(v.name);
                    this.emit(OPCODES.STORE_VAR, idx);
                }
                for (const stmt of node.body) this.compileNode(stmt);
                this.popScope();
                this.emit(OPCODES.JUMP, loopStart);
                this.patchJump(exitJump);
            },

            FunctionDeclaration: (node) => {
                const funcCompiler = new BytecodeCompiler();
                for (const param of node.parameters) {
                    funcCompiler.declareLocal(param.name || '...');
                }
                for (const stmt of node.body) funcCompiler.compileNode(stmt);
                funcCompiler.emit(OPCODES.LOAD_NIL);
                funcCompiler.emit(OPCODES.RETURN);
                const funcIdx = this.functions.length;
                this.functions.push(funcCompiler.serialize());
                this.emit(OPCODES.MAKE_CLOSURE, funcIdx);
                if (node.identifier) {
                    if (node.isLocal) {
                        const idx = this.declareLocal(node.identifier.name);
                        this.emit(OPCODES.STORE_VAR, idx);
                    } else {
                        const cidx = this.addConstant(node.identifier.name);
                        this.emit(OPCODES.STORE_GLOBAL, cidx);
                    }
                }
            },

            FunctionExpression: (node) => {
                const funcCompiler = new BytecodeCompiler();
                for (const param of node.parameters) {
                    if (param.type === 'Identifier') funcCompiler.declareLocal(param.name);
                }
                for (const stmt of node.body) funcCompiler.compileNode(stmt);
                funcCompiler.emit(OPCODES.LOAD_NIL);
                funcCompiler.emit(OPCODES.RETURN);
                const funcIdx = this.functions.length;
                this.functions.push(funcCompiler.serialize());
                this.emit(OPCODES.MAKE_CLOSURE, funcIdx);
            },

            ReturnStatement: (node) => {
                for (const arg of node.arguments) this.compileNode(arg);
                this.emit(OPCODES.RETURN, node.arguments.length);
            },

            Identifier: (node) => {
                if (node.name === '...') { this.emit(OPCODES.VARARG); return; }
                const local = this.resolveLocal(node.name);
                if (local) {
                    this.emit(OPCODES.LOAD_VAR, local.index);
                } else {
                    this.emit(OPCODES.LOAD_GLOBAL, this.addConstant(node.name));
                }
            },

            NumericLiteral: (node) => {
                this.emit(OPCODES.LOAD_CONST, this.addConstant(node.value));
            },

            StringLiteral: (node) => {
                this.emit(OPCODES.LOAD_CONST, this.addConstant(node.value));
            },

            BooleanLiteral: (node) => {
                this.emit(OPCODES.LOAD_BOOL, node.value ? 1 : 0);
            },

            NilLiteral: (_node) => {
                this.emit(OPCODES.LOAD_NIL);
            },

            VarargLiteral: (_node) => {
                this.emit(OPCODES.VARARG);
            },

            TableConstructorExpression: (node) => {
                this.emit(OPCODES.NEW_TABLE);
                for (const field of node.fields) {
                    if (field.type === 'TableKeyString') {
                        this.compileNode(field.value);
                        this.emit(OPCODES.SET_TABLE, this.addConstant(field.key.name));
                    } else if (field.type === 'TableKey') {
                        this.compileNode(field.key);
                        this.compileNode(field.value);
                        this.emit(OPCODES.SET_TABLE, -1);
                    } else if (field.type === 'TableValue') {
                        this.emit(OPCODES.LOAD_CONST, this.addConstant(node.fields.indexOf(field) + 1));
                        this.compileNode(field.value);
                        this.emit(OPCODES.SET_TABLE, -1);
                    }
                }
            },

            MemberExpression: (node) => {
                this.compileNode(node.base);
                if (node.indexer === '.') {
                    this.emit(OPCODES.GET_TABLE, this.addConstant(node.identifier.name));
                } else {
                    this.compileNode(node.index || node.identifier);
                    this.emit(OPCODES.GET_TABLE, -1);
                }
            },

            IndexExpression: (node) => {
                this.compileNode(node.base);
                this.compileNode(node.index);
                this.emit(OPCODES.GET_TABLE, -1);
            },

            UnaryExpression: (node) => {
                this.compileNode(node.argument);
                const opMap = {
                    '-':   OPCODES.NEGATE,
                    'not': OPCODES.NOT,
                    '#':   OPCODES.LENGTH,
                    '~':   OPCODES.BNOT,
                };
                const op = opMap[node.operator];
                if (!op) throw new Error(`Unsupported unary op: ${node.operator}`);
                this.emit(op);
            },

            BinaryExpression: (node) => {
                this.compileNode(node.left);
                this.compileNode(node.right);
                const opMap = {
                    '+':  OPCODES.ADD,   '-':  OPCODES.SUB,
                    '*':  OPCODES.MUL,   '/':  OPCODES.DIV,
                    '%':  OPCODES.MOD,   '^':  OPCODES.POW,
                    '..': OPCODES.CONCAT,
                    '==': OPCODES.EQ,    '~=': OPCODES.NEQ,
                    '<':  OPCODES.LT,    '<=': OPCODES.LE,
                    '>':  OPCODES.GT,    '>=': OPCODES.GE,
                    'and':OPCODES.AND,   'or': OPCODES.OR,
                    '//': OPCODES.IDIV,
                    '&':  OPCODES.BAND,  '|':  OPCODES.BOR,
                    '~':  OPCODES.BXOR,
                    '<<': OPCODES.SHL,   '>>': OPCODES.SHR,
                };
                const op = opMap[node.operator];
                if (!op) throw new Error(`Unsupported binary op: ${node.operator}`);
                this.emit(op);
            },

            LogicalExpression: (node) => {
                this.compileNode(node.left);
                this.compileNode(node.right);
                const opMap = { 'and': OPCODES.AND, 'or': OPCODES.OR };
                this.emit(opMap[node.operator]);
            },

            DoStatement: (node) => {
                this.pushScope();
                for (const stmt of node.body) this.compileNode(stmt);
                this.popScope();
            },

            BreakStatement: (_node) => {
                this.emit(OPCODES.JUMP, 0);
            },
        };
    }

    serialize() {
        return {
            instructions: this.instructions.map(i => ({ op: i.opcode, args: i.operands })),
            constants: this.constants,
            functions: this.functions,
        };
    }
}

module.exports = { BytecodeCompiler, OPCODES };
