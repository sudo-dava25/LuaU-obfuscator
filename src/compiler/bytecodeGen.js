'use strict';

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
    MAKE_CLOSURE:  0x23,
    LOAD_UPVAL:    0x24,
    STORE_UPVAL:   0x25,
    VARARG:        0x26,
    POP:           0x29,
    DUP:           0x2A,
    IDIV:          0x2B,
    BAND:          0x2C,
    BOR:           0x2D,
    BXOR:          0x2E,
    BNOT:          0x2F,
    SHL:           0x30,
    SHR:           0x31,
    GENERIC_FOR:   0x32,
    NUMERIC_FOR:   0x33,
    SET_LIST:      0x34,
    HALT:          0xFF,
};

class BytecodeCompiler {
    constructor(parent = null) {
        this.parent = parent;
        this.instructions = [];
        this.constants = [];
        this.constantMap = new Map();
        this.locals = [];
        this.upvalues = [];
        this.upvalueMap = new Map();
        this.functions = [];
        this.labels = new Map();
        this.pendingGotoJumps = [];
        this.scopeStack = [{ vars: new Map() }];
        this.loopStack = [];
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

    emitJump(opcode) { return this.emit(opcode, 0); }

    patchJump(jumpPos) {
        this.instructions[jumpPos].operands[0] = this.instructions.length;
    }

    patchJumpTo(jumpPos, target) {
        this.instructions[jumpPos].operands[0] = target;
    }

    currentScope() { return this.scopeStack[this.scopeStack.length - 1]; }
    pushScope() { this.scopeStack.push({ vars: new Map() }); }
    popScope() { this.scopeStack.pop(); }

    resolveLocal(name) {
        for (let i = this.scopeStack.length - 1; i >= 0; i--) {
            if (this.scopeStack[i].vars.has(name)) {
                return { type: 'local', index: this.scopeStack[i].vars.get(name) };
            }
        }
        return null;
    }

    resolveUpvalue(name) {
        if (this.upvalueMap.has(name)) return { type: 'upvalue', index: this.upvalueMap.get(name) };
        if (!this.parent) return null;
        const parentLocal = this.parent.resolveLocal(name);
        if (parentLocal) {
            const idx = this.upvalues.length;
            this.upvalues.push({ source: 'local', index: parentLocal.index, name });
            this.upvalueMap.set(name, idx);
            return { type: 'upvalue', index: idx };
        }
        const parentUpval = this.parent.resolveUpvalue(name);
        if (parentUpval) {
            const idx = this.upvalues.length;
            this.upvalues.push({ source: 'upvalue', index: parentUpval.index, name });
            this.upvalueMap.set(name, idx);
            return { type: 'upvalue', index: idx };
        }
        return null;
    }

    resolve(name) {
        const local = this.resolveLocal(name);
        if (local) return local;
        const upval = this.resolveUpvalue(name);
        if (upval) return upval;
        return { type: 'global', name };
    }

    declareLocal(name) {
        const idx = this.locals.length;
        this.locals.push(name);
        this.currentScope().vars.set(name, idx);
        return idx;
    }

    pushLoop(breakJumps, continueTarget) {
        this.loopStack.push({ breakJumps, continueTarget });
    }

    popLoop() { return this.loopStack.pop(); }

    currentLoop() { return this.loopStack[this.loopStack.length - 1]; }

    emitLoad(name) {
        const r = this.resolve(name);
        if (r.type === 'local') this.emit(OPCODES.LOAD_VAR, r.index);
        else if (r.type === 'upvalue') this.emit(OPCODES.LOAD_UPVAL, r.index);
        else this.emit(OPCODES.LOAD_GLOBAL, this.addConstant(r.name));
    }

    emitStore(name) {
        const r = this.resolve(name);
        if (r.type === 'local') this.emit(OPCODES.STORE_VAR, r.index);
        else if (r.type === 'upvalue') this.emit(OPCODES.STORE_UPVAL, r.index);
        else this.emit(OPCODES.STORE_GLOBAL, this.addConstant(name));
    }

    compileNode(node) {
        if (!node) return;
        const handler = this['compile_' + node.type];
        if (!handler) throw new Error(`Unsupported AST node: ${node.type}`);
        return handler.call(this, node);
    }

    compile_Chunk(node) {
        for (const stmt of node.body) this.compileNode(stmt);
        this.emit(OPCODES.HALT);
    }

    compile_LabelStatement(node) {
        const name = node.label.name;
        const pos = this.instructions.length;
        this.labels.set(name, pos);
        for (const p of this.pendingGotoJumps) {
            if (p.label === name) this.patchJumpTo(p.pos, pos);
        }
        this.pendingGotoJumps = this.pendingGotoJumps.filter(p => p.label !== name);
    }

    compile_GotoStatement(node) {
        const name = node.label.name;
        if (this.labels.has(name)) {
            this.emit(OPCODES.JUMP, this.labels.get(name));
        } else {
            const pos = this.emitJump(OPCODES.JUMP);
            this.pendingGotoJumps.push({ label: name, pos });
        }
    }

    compile_LocalStatement(node) {
        const initCount = node.init.length;
        for (let i = 0; i < node.variables.length; i++) {
            if (i < initCount) this.compileNode(node.init[i]);
            else this.emit(OPCODES.LOAD_NIL);
            const idx = this.declareLocal(node.variables[i].name);
            this.emit(OPCODES.STORE_VAR, idx);
        }
    }

    compile_AssignmentStatement(node) {
        for (let i = 0; i < node.variables.length; i++) {
            if (i < node.init.length) this.compileNode(node.init[i]);
            else this.emit(OPCODES.LOAD_NIL);
            this.compileAssignTarget(node.variables[i]);
        }
    }

    compileAssignTarget(target) {
        if (target.type === 'Identifier') {
            this.emitStore(target.name);
        } else if (target.type === 'MemberExpression') {
            this.compileNode(target.base);
            if (target.indexer === '.') {
                const cidx = this.addConstant(target.identifier.name);
                this.emit(OPCODES.SET_TABLE, cidx);
            } else {
                this.compileNode(target.identifier);
                this.emit(OPCODES.SET_TABLE, -1);
            }
        } else if (target.type === 'IndexExpression') {
            this.compileNode(target.base);
            this.compileNode(target.index);
            this.emit(OPCODES.SET_TABLE, -1);
        }
    }

    compile_CallStatement(node) {
        this.compileNode(node.expression);
        this.emit(OPCODES.POP);
    }

    compile_CallExpression(node) {
        this.compileNode(node.base);
        for (const arg of node.arguments) this.compileNode(arg);
        this.emit(OPCODES.CALL, node.arguments.length);
    }

    compile_StringCallExpression(node) {
        this.compileNode(node.base);
        const cidx = this.addConstant(node.argument.value);
        this.emit(OPCODES.LOAD_CONST, cidx);
        this.emit(OPCODES.CALL, 1);
    }

    compile_TableCallExpression(node) {
        this.compileNode(node.base);
        this.compileNode(node.arguments);
        this.emit(OPCODES.CALL, 1);
    }

    compile_MethodCallExpression(node) {
        this.compileNode(node.base);
        this.emit(OPCODES.DUP);
        const mkey = this.addConstant(node.identifier.name);
        this.emit(OPCODES.GET_TABLE, mkey);
        for (const arg of node.arguments) this.compileNode(arg);
        this.emit(OPCODES.CALL, node.arguments.length + 1);
    }

    compile_IfStatement(node) {
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
    }

    compile_IfExpression(node) {
        this.compileNode(node.condition);
        const jumpFalse = this.emitJump(OPCODES.JUMP_IF_FALSE);
        this.compileNode(node.consequent);
        const jumpEnd = this.emitJump(OPCODES.JUMP);
        this.patchJump(jumpFalse);
        this.compileNode(node.alternate);
        this.patchJump(jumpEnd);
    }

    compile_WhileStatement(node) {
        const loopStart = this.instructions.length;
        const breakJumps = [];
        this.pushLoop(breakJumps, loopStart);
        this.labels.set('__continue__', loopStart);
        this.compileNode(node.condition);
        const exitJump = this.emitJump(OPCODES.JUMP_IF_FALSE);
        breakJumps.push(exitJump);
        this.pushScope();
        for (const stmt of node.body) this.compileNode(stmt);
        this.popScope();
        this.emit(OPCODES.JUMP, loopStart);
        for (const j of breakJumps) this.patchJump(j);
        this.popLoop();
    }

    compile_RepeatStatement(node) {
        const loopStart = this.instructions.length;
        const breakJumps = [];
        this.pushLoop(breakJumps, loopStart);
        this.labels.set('__continue__', loopStart);
        this.pushScope();
        for (const stmt of node.body) this.compileNode(stmt);
        this.compileNode(node.condition);
        this.emit(OPCODES.JUMP_IF_FALSE, loopStart);
        this.popScope();
        for (const j of breakJumps) this.patchJump(j);
        this.popLoop();
    }

    compile_NumericForStatement(node) {
        this.compileNode(node.start);
        this.compileNode(node.limit);
        if (node.step) this.compileNode(node.step);
        else this.emit(OPCODES.LOAD_CONST, this.addConstant(1));

        const stepIdx = this.declareLocal('__step__');
        this.emit(OPCODES.STORE_VAR, stepIdx);
        const limitIdx = this.declareLocal('__limit__');
        this.emit(OPCODES.STORE_VAR, limitIdx);
        const iterIdx = this.declareLocal(node.variable.name);
        this.emit(OPCODES.STORE_VAR, iterIdx);

        const loopStart = this.instructions.length;
        const breakJumps = [];
        this.pushLoop(breakJumps, loopStart);
        this.labels.set('__continue__', loopStart);

        this.emit(OPCODES.NUMERIC_FOR, iterIdx, limitIdx, stepIdx);
        const exitJump = this.emitJump(OPCODES.JUMP_IF_FALSE);
        breakJumps.push(exitJump);

        this.pushScope();
        for (const stmt of node.body) this.compileNode(stmt);
        this.popScope();

        this.emit(OPCODES.LOAD_VAR, iterIdx);
        this.emit(OPCODES.LOAD_VAR, stepIdx);
        this.emit(OPCODES.ADD);
        this.emit(OPCODES.STORE_VAR, iterIdx);
        this.emit(OPCODES.JUMP, loopStart);

        for (const j of breakJumps) this.patchJump(j);
        this.popLoop();
    }

    compile_GenericForStatement(node) {
        const iterCount = node.iterators.length;
        for (const iter of node.iterators) this.compileNode(iter);

        const iterFuncIdx = this.declareLocal('__iterFunc__');
        this.emit(OPCODES.STORE_VAR, iterFuncIdx);
        const stateIdx = iterCount >= 2 ? (() => {
            const idx = this.declareLocal('__state__'); this.emit(OPCODES.STORE_VAR, idx); return idx;
        })() : null;
        const controlIdx = iterCount >= 3 ? (() => {
            const idx = this.declareLocal('__control__'); this.emit(OPCODES.STORE_VAR, idx); return idx;
        })() : null;

        const loopStart = this.instructions.length;
        const breakJumps = [];
        this.pushLoop(breakJumps, loopStart);
        this.labels.set('__continue__', loopStart);

        this.emit(OPCODES.LOAD_VAR, iterFuncIdx);
        if (stateIdx !== null) this.emit(OPCODES.LOAD_VAR, stateIdx);
        else this.emit(OPCODES.LOAD_NIL);
        if (controlIdx !== null) this.emit(OPCODES.LOAD_VAR, controlIdx);
        else this.emit(OPCODES.LOAD_NIL);
        this.emit(OPCODES.GENERIC_FOR, node.variables.length);

        const exitJump = this.emitJump(OPCODES.JUMP_IF_FALSE);
        breakJumps.push(exitJump);

        this.pushScope();
        const varIndices = [];
        for (const v of node.variables) {
            const idx = this.declareLocal(v.name);
            varIndices.push(idx);
        }
        for (let i = node.variables.length - 1; i >= 0; i--) {
            this.emit(OPCODES.STORE_VAR, varIndices[i]);
        }
        if (controlIdx !== null && varIndices.length > 0) {
            this.emit(OPCODES.LOAD_VAR, varIndices[0]);
            this.emit(OPCODES.STORE_VAR, controlIdx);
        }

        for (const stmt of node.body) this.compileNode(stmt);
        this.popScope();

        this.emit(OPCODES.JUMP, loopStart);
        for (const j of breakJumps) this.patchJump(j);
        this.popLoop();
    }

    compileFunctionBody(node, params, body) {
        const child = new BytecodeCompiler(this);
        for (const param of params) {
            if (param.type === 'Identifier') child.declareLocal(param.name);
            else if (param.type === 'VarargLiteral') child.declareLocal('...');
        }
        for (const stmt of body) child.compileNode(stmt);
        child.emit(OPCODES.LOAD_NIL);
        child.emit(OPCODES.RETURN, 1);
        return child;
    }

    compile_FunctionDeclaration(node) {
        const child = this.compileFunctionBody(node, node.parameters, node.body);
        const funcIdx = this.functions.length;
        this.functions.push(child.serialize());
        this.emit(OPCODES.MAKE_CLOSURE, funcIdx, ...child.upvalues.map(u => u.source === 'local' ? u.index : -(u.index + 1)));

        if (node.identifier) {
            const id = node.identifier;
            if (id.type === 'Identifier') {
                if (node.isLocal) {
                    const idx = this.declareLocal(id.name);
                    this.emit(OPCODES.STORE_VAR, idx);
                } else {
                    this.emitStore(id.name);
                }
            } else if (id.type === 'MemberExpression') {
                this.compileNode(id.base);
                if (id.indexer === '.') {
                    this.emit(OPCODES.SET_TABLE, this.addConstant(id.identifier.name));
                } else {
                    this.compileNode(id.identifier);
                    this.emit(OPCODES.SET_TABLE, -1);
                }
            }
        }
    }

    compile_FunctionExpression(node) {
        const child = this.compileFunctionBody(node, node.parameters, node.body);
        const funcIdx = this.functions.length;
        this.functions.push(child.serialize());
        this.emit(OPCODES.MAKE_CLOSURE, funcIdx, ...child.upvalues.map(u => u.source === 'local' ? u.index : -(u.index + 1)));
    }

    compile_ReturnStatement(node) {
        for (const arg of node.arguments) this.compileNode(arg);
        this.emit(OPCODES.RETURN, node.arguments.length);
    }

    compile_Identifier(node) {
        if (node.name === '...') { this.emit(OPCODES.VARARG); return; }
        this.emitLoad(node.name);
    }

    compile_NumericLiteral(node) { this.emit(OPCODES.LOAD_CONST, this.addConstant(node.value)); }
    compile_StringLiteral(node) { this.emit(OPCODES.LOAD_CONST, this.addConstant(node.value)); }
    compile_BooleanLiteral(node) { this.emit(OPCODES.LOAD_BOOL, node.value ? 1 : 0); }
    compile_NilLiteral(_node) { this.emit(OPCODES.LOAD_NIL); }
    compile_VarargLiteral(_node) { this.emit(OPCODES.VARARG); }

    compile_TableConstructorExpression(node) {
        this.emit(OPCODES.NEW_TABLE);
        let arrayIdx = 1;
        for (const field of node.fields) {
            if (field.type === 'TableKeyString') {
                this.compileNode(field.value);
                this.emit(OPCODES.SET_TABLE, this.addConstant(field.key.name));
            } else if (field.type === 'TableKey') {
                this.compileNode(field.value);
                this.compileNode(field.key);
                this.emit(OPCODES.SET_TABLE, -1);
            } else if (field.type === 'TableValue') {
                this.compileNode(field.value);
                this.emit(OPCODES.SET_TABLE, this.addConstant(arrayIdx++));
            }
        }
    }

    compile_MemberExpression(node) {
        this.compileNode(node.base);
        if (node.indexer === '.') {
            this.emit(OPCODES.GET_TABLE, this.addConstant(node.identifier.name));
        } else {
            this.compileNode(node.identifier || node.index);
            this.emit(OPCODES.GET_TABLE, -1);
        }
    }

    compile_IndexExpression(node) {
        this.compileNode(node.base);
        this.compileNode(node.index);
        this.emit(OPCODES.GET_TABLE, -1);
    }

    compile_UnaryExpression(node) {
        this.compileNode(node.argument);
        const opMap = { '-': OPCODES.NEGATE, 'not': OPCODES.NOT, '#': OPCODES.LENGTH, '~': OPCODES.BNOT };
        const op = opMap[node.operator];
        if (!op) throw new Error(`Unsupported unary op: ${node.operator}`);
        this.emit(op);
    }

    compile_BinaryExpression(node) {
        this.compileNode(node.left);
        this.compileNode(node.right);
        const opMap = {
            '+': OPCODES.ADD,  '-': OPCODES.SUB,  '*': OPCODES.MUL, '/': OPCODES.DIV,
            '%': OPCODES.MOD,  '^': OPCODES.POW,  '..': OPCODES.CONCAT,
            '==': OPCODES.EQ, '~=': OPCODES.NEQ,
            '<': OPCODES.LT,  '<=': OPCODES.LE,   '>': OPCODES.GT,  '>=': OPCODES.GE,
            '//': OPCODES.IDIV,
            '&': OPCODES.BAND, '|': OPCODES.BOR,  '~': OPCODES.BXOR,
            '<<': OPCODES.SHL, '>>': OPCODES.SHR,
        };
        const op = opMap[node.operator];
        if (op === undefined) throw new Error(`Unsupported binary op: ${node.operator}`);
        this.emit(op);
    }

    compile_LogicalExpression(node) {
        if (node.operator === 'and') {
            this.compileNode(node.left);
            this.emit(OPCODES.DUP);
            const shortCircuit = this.emitJump(OPCODES.JUMP_IF_FALSE);
            this.emit(OPCODES.POP);
            this.compileNode(node.right);
            this.patchJump(shortCircuit);
        } else {
            this.compileNode(node.left);
            this.emit(OPCODES.DUP);
            const shortCircuit = this.emitJump(OPCODES.JUMP_IF_TRUE);
            this.emit(OPCODES.POP);
            this.compileNode(node.right);
            this.patchJump(shortCircuit);
        }
    }

    compile_DoStatement(node) {
        this.pushScope();
        for (const stmt of node.body) this.compileNode(stmt);
        this.popScope();
    }

    compile_BreakStatement(_node) {
        const loop = this.currentLoop();
        if (!loop) throw new Error('break outside loop');
        const pos = this.emitJump(OPCODES.JUMP);
        loop.breakJumps.push(pos);
    }

    serialize() {
        return {
            instructions: this.instructions.map(i => ({ op: i.opcode, args: i.operands })),
            constants: this.constants,
            functions: this.functions,
            upvalues: this.upvalues,
        };
    }
}

module.exports = { BytecodeCompiler, OPCODES };
