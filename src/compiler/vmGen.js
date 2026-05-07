'use strict';

const { parseLuaU } = require('../luau/parser');
const { BytecodeCompiler } = require('./bytecodeGen');
const { generateVM } = require('./vmGen');

function obfuscate(sourceCode) {
    if (!sourceCode || typeof sourceCode !== 'string') {
        throw new TypeError('Source code must be a non-empty string');
    }
    if (sourceCode.length > 512 * 1024) {
        throw new RangeError('Source code exceeds 512KB limit');
    }

    let ast;
    try {
        ast = parseLuaU(sourceCode);
    } catch (parseErr) {
        const err = new Error(`Parse error: ${parseErr.message}`);
        err.code = 'PARSE_ERROR';
        err.line = parseErr.line;
        err.column = parseErr.col;
        throw err;
    }

    const compiler = new BytecodeCompiler(null);
    try {
        compiler.compileNode(ast);
    } catch (compileErr) {
        const err = new Error(`Compilation error: ${compileErr.message}`);
        err.code = 'COMPILE_ERROR';
        throw err;
    }

    return generateVM(compiler.serialize());
}

module.exports = { obfuscate };
