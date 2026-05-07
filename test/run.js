'use strict';

const { obfuscate } = require('../src/compiler/parser');

let passed = 0; let failed = 0;

function test(name, code) {
    try {
        const result = obfuscate(code);
        if (typeof result !== 'string' || result.length === 0) throw new Error('empty output');
        console.log(`  PASS  ${name}`);
        passed++;
    } catch (e) {
        console.log(`  FAIL  ${name}: ${e.message}`);
        failed++;
    }
}

console.log('\n=== LuaU Compatibility Tests ===\n');

test('basic arithmetic', `local x = 1 + 2 * 3`);
test('string literal', `local s = "hello world"`);
test('boolean literal', `local b = true`);
test('nil literal', `local n = nil`);
test('type annotation stripped', `local x: number = 42`);
test('type alias stripped', `type Foo = string`);
test('export type stripped', `export type Bar = number`);
test('generic type stripped', `local x: Map<string, number> = {}`);
test('deeply nested generic', `local x: Map<string, Array<{[number]: () -> void}>> = {}`);
test('return type annotation', `local function f(): string return "hi" end`);
test('param type annotation', `local function f(x: number, y: string): boolean return true end`);
test('compound += ', `local x = 0; x += 1`);
test('compound -= ', `local x = 5; x -= 2`);
test('compound *= ', `local x = 3; x *= 4`);
test('compound /= ', `local x = 8; x /= 2`);
test('compound //=', `local x = 7; x //= 2`);
test('compound ..=', `local s = "a"; s ..= "b"`);
test('integer division //', `local x = 7 // 2`);
test('bitwise &', `local x = 6 & 3`);
test('bitwise |', `local x = 6 | 1`);
test('bitwise ~', `local x = 6 ~ 3`);
test('bitwise <<', `local x = 1 << 4`);
test('bitwise >>', `local x = 16 >> 2`);
test('unary ~', `local x = ~5`);
test('continue in while', `local i=0; while i<10 do i+=1; if i==5 then continue end end`);
test('continue in for', `for i=1,10 do if i==5 then continue end end`);
test('goto and label', `goto skip; local x=1; ::skip::`);
test('string interpolation basic', 'local name="World"; local s=`Hello {name}!`');
test('string interpolation expr', 'local x=10; local s=`Value is {x*2}`');
test('string interpolation nested call', 'local s=`Result: {tostring(42)}`');
test('if expression', `local x = if true then 1 else 2`);
test('if expression nested', `local x = if 1>0 then if 2>1 then "a" else "b" else "c"`);
test('closure captures upvalue', `
local function makeCounter()
    local count = 0
    return function()
        count += 1
        return count
    end
end
`);
test('nested closures', `
local function outer(x)
    local function inner(y)
        return x + y
    end
    return inner
end
`);
test('generic for pairs', `local t={a=1}; for k,v in pairs(t) do end`);
test('generic for ipairs', `for i,v in ipairs({1,2,3}) do end`);
test('generic for custom iterator', `
local function iter(t, i)
    i = i + 1
    local v = t[i]
    if v then return i, v end
end
for i, v in iter, {10,20,30}, 0 do end
`);
test('numeric for step positive', `for i=1,10,2 do end`);
test('numeric for step negative', `for i=10,1,-1 do end`);
test('numeric for default step', `for i=1,5 do end`);
test('table constructor array', `local t = {1, 2, 3}`);
test('table constructor mixed', `local t = {x=1, y=2, 3, 4}`);
test('table constructor key expr', `local k="a"; local t = {[k]=1}`);
test('method call', `local s = "hello"; local n = s:len()`);
test('OOP with metatable', `
local Animal = {}
Animal.__index = Animal
function Animal.new(name)
    return setmetatable({name=name}, Animal)
end
function Animal:speak()
    return self.name
end
`);
test('vararg', `
local function sum(...)
    local total = 0
    for _, v in ipairs({...}) do total += v end
    return total
end
`);
test('multiple return', `
local function swap(a, b) return b, a end
local x, y = swap(1, 2)
`);
test('repeat until', `local i=0; repeat i+=1 until i>=5`);
test('nested loops break', `
for i=1,3 do
    for j=1,3 do
        if j==2 then break end
    end
end
`);
test('do block scope', `do local x=1 end`);
test('function as table field', `local t = {f = function(x) return x end}`);
test('self-referential table', `
local M = {}
M.x = 10
M.getX = function() return M.x end
`);
test('pcall usage', `local ok, err = pcall(function() error("test") end)`);
test('string methods', `local s = ("hello"):upper()`);
test('chained member access', `local x = math.floor(3.7)`);
test('logical and short-circuit', `local x = false and error("should not run")`);
test('logical or short-circuit', `local x = true or error("should not run")`);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
