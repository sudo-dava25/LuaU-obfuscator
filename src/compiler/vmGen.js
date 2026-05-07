const { shuffleArray } = require('../utils/nameGen');

function encodeConstant(val) {
    if (val === null || val === undefined) return 'nil';
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'number') return val.toString();
    if (typeof val === 'string') {
        const chars = [];
        for (const ch of val) chars.push(ch.charCodeAt(0));
        return `(function(t)local s=""for i=1,#t do s=s..string.char(t[i])end return s end){${chars.join(',')}}`;
    }
    return 'nil';
}

function serializeBytecode(bytecode) {
    function serializeSingle(bc) {
        const instrs = bc.instructions.map(i => {
            const args = i.args.map(a => a.toString()).join(',');
            return `{${i.op},${args || '0'}}`;
        }).join(',');
        const consts = bc.constants.map(encodeConstant).join(',');
        const funcs = bc.functions.map(serializeSingle).join(',');
        return `{i={${instrs}},k={${consts}},f={${funcs}}}`;
    }
    return serializeSingle(bytecode);
}

function generateVMNames() {
    const pool = [];
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < chars.length; i++)
        for (let j = 0; j < chars.length; j++)
            pool.push(chars[i] + chars[j]);
    const shuffled = shuffleArray(pool);
    let idx = 0;
    return () => shuffled[idx++] || `_v${idx}`;
}

function generateVM(bytecodeStr) {
    const n = generateVMNames();
    const vExec  = n(); const vProto  = n(); const vStack  = n();
    const vPC    = n(); const vInstr  = n(); const vOp     = n();
    const vEnv   = n(); const vConsts = n(); const vFuncs  = n();
    const vArgs  = n(); const vRet    = n(); const vA      = n();
    const vB     = n(); const vC      = n(); const vLocals = n();
    const vTop   = n(); const vFunc   = n();

    const unpackFn = `(table and table.unpack or unpack)`;

    const vmCode = `
local function ${vExec}(${vProto},${vEnv},${vArgs})
local ${vConsts}=${vProto}.k
local ${vFuncs}=${vProto}.f
local ${vStack}={}
local ${vLocals}={}
local ${vPC}=1
local ${vTop}=0
if ${vArgs} then
  for _,v in ipairs(${vArgs}) do
    ${vTop}=${vTop}+1
    ${vStack}[${vTop}]=v
  end
end
local function push(v) ${vTop}=${vTop}+1;${vStack}[${vTop}]=v end
local function pop() local v=${vStack}[${vTop}];${vTop}=${vTop}-1;return v end
local function peek() return ${vStack}[${vTop}] end
while true do
  local ${vInstr}=${vProto}.i[${vPC}]
  ${vPC}=${vPC}+1
  local ${vOp}=${vInstr}[1]
  local ${vA}=${vInstr}[2] or 0
  if ${vOp}==1 then
    push(${vConsts}[${vA}+1])
  elseif ${vOp}==2 then
    push(${vLocals}[${vA}+1])
  elseif ${vOp}==3 then
    ${vLocals}[${vA}+1]=pop()
  elseif ${vOp}==4 then
    push(${vEnv}[${vConsts}[${vA}+1]])
  elseif ${vOp}==5 then
    ${vEnv}[${vConsts}[${vA}+1]]=pop()
  elseif ${vOp}==6 then
    local argc=${vA}
    local targs={}
    for i=argc,1,-1 do targs[i]=pop() end
    local fn=pop()
    if type(fn)~="function" and type(fn)~="table" then
      error("attempt to call a "..type(fn).." value")
    end
    local results={fn(${unpackFn}(targs))}
    for _,v in ipairs(results) do push(v) end
  elseif ${vOp}==7 then
    local argc=${vA} or 1
    local rets={}
    for i=argc,1,-1 do rets[i]=pop() end
    return ${unpackFn}(rets)
  elseif ${vOp}==8 then
    local b=pop();local a=pop();push(a+b)
  elseif ${vOp}==9 then
    local b=pop();local a=pop();push(a-b)
  elseif ${vOp}==10 then
    local b=pop();local a=pop();push(a*b)
  elseif ${vOp}==11 then
    local b=pop();local a=pop();push(a/b)
  elseif ${vOp}==12 then
    local b=pop();local a=pop();push(a%b)
  elseif ${vOp}==13 then
    local b=pop();local a=pop();push(a^b)
  elseif ${vOp}==14 then
    local b=pop();local a=pop();push(a..b)
  elseif ${vOp}==15 then
    local b=pop();local a=pop();push(a==b)
  elseif ${vOp}==16 then
    local b=pop();local a=pop();push(a~=b)
  elseif ${vOp}==17 then
    local b=pop();local a=pop();push(a<b)
  elseif ${vOp}==18 then
    local b=pop();local a=pop();push(a<=b)
  elseif ${vOp}==19 then
    local b=pop();local a=pop();push(a>b)
  elseif ${vOp}==20 then
    local b=pop();local a=pop();push(a>=b)
  elseif ${vOp}==21 then
    local b=pop();local a=pop();push(a and b)
  elseif ${vOp}==22 then
    local b=pop();local a=pop();push(a or b)
  elseif ${vOp}==23 then
    push(not pop())
  elseif ${vOp}==24 then
    push(-pop())
  elseif ${vOp}==25 then
    ${vPC}=${vA}
  elseif ${vOp}==26 then
    local cond=pop()
    if not cond then ${vPC}=${vA} end
  elseif ${vOp}==27 then
    local cond=pop()
    if cond then ${vPC}=${vA} end
  elseif ${vOp}==28 then
    local key
    if ${vA}==-1 then key=pop() else key=${vConsts}[${vA}+1] end
    local tbl=pop()
    push(tbl[key])
  elseif ${vOp}==29 then
    local val=pop()
    local key
    if ${vA}==-1 then key=pop() else key=${vConsts}[${vA}+1] end
    local tbl=peek()
    tbl[key]=val
  elseif ${vOp}==30 then
    push({})
  elseif ${vOp}==31 then
    push(#pop())
  elseif ${vOp}==32 then
    push(nil)
  elseif ${vOp}==33 then
    push(${vA}==1)
  elseif ${vOp}==35 then
    local fp=${vFuncs}[${vA}+1]
    local captured_env=${vEnv}
    push(function(...)
      return ${vExec}(fp,captured_env,{...})
    end)
  elseif ${vOp}==41 then
    pop()
  elseif ${vOp}==42 then
    local v=peek();push(v)
  elseif ${vOp}==43 then
    local b=pop();local a=pop();push(math.floor(a/b))
  elseif ${vOp}==44 then
    local b=pop();local a=pop();push(bit32 and bit32.band(a,b) or a&b)
  elseif ${vOp}==45 then
    local b=pop();local a=pop();push(bit32 and bit32.bor(a,b) or a|b)
  elseif ${vOp}==46 then
    local b=pop();local a=pop();push(bit32 and bit32.bxor(a,b) or a~b)
  elseif ${vOp}==47 then
    push(bit32 and bit32.bnot(pop()) or ~pop())
  elseif ${vOp}==48 then
    local b=pop();local a=pop();push(bit32 and bit32.lshift(a,b) or a<<b)
  elseif ${vOp}==49 then
    local b=pop();local a=pop();push(bit32 and bit32.rshift(a,b) or a>>b)
  elseif ${vOp}==255 then
    return
  end
end
end
local ${vFunc}=${serializeBytecode(bytecodeStr)}
local ${vEnv}=setmetatable({},{__index=_G,__newindex=function(t,k,v) _G[k]=v end})
${vExec}(${vFunc},${vEnv},{})
`.trim();

    return vmCode;
}

module.exports = { generateVM };
