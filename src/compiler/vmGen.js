'use strict';

const { shuffleArray } = require('../utils/nameGen');

function encodeConstant(val) {
    if (val === null || val === undefined) return 'nil';
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'number') {
        if (!isFinite(val)) return val === Infinity ? '(1/0)' : '(-1/0)';
        if (Object.is(val, -0)) return '-0';
        return val.toString();
    }
    if (typeof val === 'string') {
        const chars = [];
        for (let i = 0; i < val.length; i++) chars.push(val.charCodeAt(i));
        return `(function(t)local s=""for i=1,#t do s=s..string.char(t[i])end return s end){${chars.join(',')}}`;
    }
    return 'nil';
}

function serializeBytecode(bc) {
    const instrs = bc.instructions.map(i => {
        const args = i.args.length ? i.args.join(',') : '0';
        return `{${i.op},${args}}`;
    }).join(',');
    const consts = bc.constants.map(encodeConstant).join(',');
    const funcs = bc.functions.map(serializeBytecode).join(',');
    const upvals = (bc.upvalues || []).map(u => `{s="${u.source}",i=${u.index}}`).join(',');
    return `{i={${instrs}},k={${consts}},f={${funcs}},u={${upvals}}}`;
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

function generateVM(bytecode) {
    const n = generateVMNames();
    const vExec   = n(); const vProto  = n(); const vStack  = n();
    const vPC     = n(); const vInstr  = n(); const vOp     = n();
    const vConsts = n(); const vFuncs  = n(); const vArgs   = n();
    const vA      = n(); const vLocals = n(); const vTop    = n();
    const vUpvals = n(); const vFunc   = n(); const vEnv    = n();
    const vUV     = n();

    const UP = `(table and table.unpack or unpack)`;

    const vmCode = `
local function ${vExec}(${vProto},${vEnv},${vArgs},${vUpvals})
local ${vConsts}=${vProto}.k
local ${vFuncs}=${vProto}.f
local ${vStack}={}
local ${vLocals}={}
local ${vPC}=1
local ${vTop}=0
${vUpvals}=${vUpvals} or {}
if ${vArgs} then
  for _,v in ipairs(${vArgs}) do ${vTop}=${vTop}+1;${vStack}[${vTop}]=v end
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
  elseif ${vOp}==36 then
    push(${vUpvals}[${vA}+1])
  elseif ${vOp}==37 then
    ${vUpvals}[${vA}+1]=pop()
  elseif ${vOp}==6 then
    local argc=${vA}
    local targs={}
    for i=argc,1,-1 do targs[i]=pop() end
    local fn=pop()
    if type(fn)~="function" and type(fn)~="table" then
      error("attempt to call a "..type(fn).." value")
    end
    local res={fn(${UP}(targs))}
    for _,v in ipairs(res) do push(v) end
  elseif ${vOp}==7 then
    local argc=${vA}
    local rets={}
    for i=argc,1,-1 do rets[i]=pop() end
    return ${UP}(rets)
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
    local b=pop();local a=pop();push(tostring(a)..tostring(b))
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
  elseif ${vOp}==23 then
    push(not pop())
  elseif ${vOp}==24 then
    push(-pop())
  elseif ${vOp}==25 then
    ${vPC}=${vA}
  elseif ${vOp}==26 then
    if not pop() then ${vPC}=${vA} end
  elseif ${vOp}==27 then
    if pop() then ${vPC}=${vA} end
  elseif ${vOp}==28 then
    local key
    if ${vA}==-1 then key=pop() else key=${vConsts}[${vA}+1] end
    local tbl=pop()
    local mt=getmetatable(tbl)
    local v=rawget(tbl,key)
    if v==nil and mt and mt.__index then
      if type(mt.__index)=="function" then v=mt.__index(tbl,key)
      else v=mt.__index[key] end
    end
    push(v)
  elseif ${vOp}==29 then
    local val=pop()
    local key
    if ${vA}==-1 then key=pop() else key=${vConsts}[${vA}+1] end
    local tbl=peek()
    local mt=getmetatable(tbl)
    if mt and mt.__newindex then
      if type(mt.__newindex)=="function" then mt.__newindex(tbl,key,val)
      else mt.__newindex[key]=val end
    else rawset(tbl,key,val) end
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
    local capUV={}
    local uvDesc=${vProto}.u
    local extraArgs={${UP}(${vInstr},{3})}
    for ci,uspec in ipairs(fp.u) do
      local refIdx=extraArgs[ci] or 0
      if uspec.s=="local" then
        capUV[ci]=${vLocals}[refIdx+1]
      elseif uspec.s=="upvalue" then
        capUV[ci]=${vUpvals}[refIdx+1]
      end
    end
    local captured_env=${vEnv}
    local capturedUV=capUV
    push(function(...)
      return ${vExec}(fp,captured_env,{...},capturedUV)
    end)
  elseif ${vOp}==38 then
    push(${vLocals}[${vA}+1])
  elseif ${vOp}==41 then
    pop()
  elseif ${vOp}==42 then
    local v=peek();push(v)
  elseif ${vOp}==43 then
    local b=pop();local a=pop();push(math.floor(a/b))
  elseif ${vOp}==44 then
    local b=pop();local a=pop()
    push(bit32 and bit32.band(a,b) or a&b)
  elseif ${vOp}==45 then
    local b=pop();local a=pop()
    push(bit32 and bit32.bor(a,b) or a|b)
  elseif ${vOp}==46 then
    local b=pop();local a=pop()
    push(bit32 and bit32.bxor(a,b) or a~b)
  elseif ${vOp}==47 then
    push(bit32 and bit32.bnot(pop()) or ~pop())
  elseif ${vOp}==48 then
    local b=pop();local a=pop()
    push(bit32 and bit32.lshift(a,b) or a<<b)
  elseif ${vOp}==49 then
    local b=pop();local a=pop()
    push(bit32 and bit32.rshift(a,b) or a>>b)
  elseif ${vOp}==50 then
    local nv=${vA}
    local vals={}
    for i=nv,1,-1 do vals[i]=pop() end
    local state=pop()
    local iterf=pop()
    local res={iterf(state,vals[1])}
    if res[1]==nil then push(false) else
      push(true)
      for i=#res,1,-1 do push(res[i]) end
    end
  elseif ${vOp}==51 then
    local iter=${vLocals}[${vInstr}[3]+1]
    local lim=${vLocals}[${vInstr}[4]+1]
    local stp=${vLocals}[${vA}+1]
    local cond=(stp>=0 and iter<=lim) or (stp<0 and iter>=lim)
    push(cond)
  elseif ${vOp}==255 then
    return
  end
end
end
local ${vFunc}=${serializeBytecode(bytecode)}
local ${vEnv}=setmetatable({},{__index=_G,__newindex=function(t,k,v) _G[k]=v end})
${vExec}(${vFunc},${vEnv},{},{})
`.trim();

    return vmCode;
}

module.exports = { generateVM };
