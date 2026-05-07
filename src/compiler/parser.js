const luaparse = require('luaparse');
const { BytecodeCompiler } = require('./bytecodeGen');
const { generateVM } = require('./vmGen');

function stripTypeAnnotations(source) {
    let s = source;
    s = s.replace(/--\[=*\[[\s\S]*?\]=*\]/g, m => '\n'.repeat((m.match(/\n/g)||[]).length));
    s = s.replace(/--[^\n]*/g, '');
    s = s.replace(/^[ \t]*(?:export\s+)?type\s+\w[\w<>, ]*\s*=\s*[^\n]+/gm, m => ' '.repeat(m.length));
    s = s.replace(/:\s*\([^)]*\)\s*->\s*[A-Za-z_][A-Za-z0-9_?|.<>, \[\]]*/g, '');
    s = s.replace(/:\s*[A-Za-z_][A-Za-z0-9_?|.<>, \[\]]*/g, '');
    s = s.replace(/->\s*[A-Za-z_][A-Za-z0-9_?|.<>, \[\]]*/g, '');
    return s;
}

function desugarCompound(source) {
    let s = source;
    s = s.replace(/([\w.]+(?:\[[^\]]+\])?)\s*\/\/=\s*([^\n;]+)/g, '$1 = math.floor($1 / ($2))');
    s = s.replace(/([\w.]+(?:\[[^\]]+\])?)\s*\+=\s*([^\n;]+)/g, '$1 = $1 + ($2)');
    s = s.replace(/([\w.]+(?:\[[^\]]+\])?)\s*-=\s*([^\n;]+)/g, '$1 = $1 - ($2)');
    s = s.replace(/([\w.]+(?:\[[^\]]+\])?)\s*\*=\s*([^\n;]+)/g, '$1 = $1 * ($2)');
    s = s.replace(/([\w.]+(?:\[[^\]]+\])?)\s*\/=\s*([^\n;]+)/g, '$1 = $1 / ($2)');
    s = s.replace(/([\w.]+(?:\[[^\]]+\])?)\s*%=\s*([^\n;]+)/g, '$1 = $1 % ($2)');
    s = s.replace(/([\w.]+(?:\[[^\]]+\])?)\s*\^=\s*([^\n;]+)/g, '$1 = $1 ^ ($2)');
    s = s.replace(/([\w.]+(?:\[[^\]]+\])?)\s*\.\.=\s*([^\n;]+)/g, '$1 = $1 .. ($2)');
    s = s.replace(/([^/])\/\/([^/])/g, (_, pre, post) => `${pre}/__idiv__/${post}`);
    s = s.replace(/\b(\d+)\/__idiv__\/(\d+)/g, (_, a, b) => String(Math.floor(Number(a) / Number(b))));
    s = s.replace(/__idiv__/g, '/');
    s = s.replace(/\bcontinue\b/g, 'goto __continue__');
    return s;
}

function obfuscate(sourceCode) {
    if (!sourceCode || typeof sourceCode !== 'string') {
        throw new TypeError('Source code must be a non-empty string');
    }
    if (sourceCode.length > 512 * 1024) {
        throw new RangeError('Source code exceeds 512KB limit');
    }

    let processed = stripTypeAnnotations(sourceCode);
    processed = desugarCompound(processed);

    let ast;
    try {
        ast = luaparse.parse(processed, {
            scope: true,
            comments: false,
            locations: false,
            ranges: false,
            luaVersion: '5.2',
        });
    } catch (parseErr) {
        const err = new Error(`Parse error: ${parseErr.message}`);
        err.code = 'PARSE_ERROR';
        err.line = parseErr.line;
        err.column = parseErr.column;
        throw err;
    }

    const compiler = new BytecodeCompiler();
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
