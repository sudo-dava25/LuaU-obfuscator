# LuaU-obfuscator

A server-side obfuscation engine for Lua 5.x and LuaU (Roblox dialect). Source code is compiled into a custom bytecode format and embedded inside a generated stack-based virtual machine, making the original logic unrecoverable through static analysis or decompilation.

---

## How It Works

1. **Pre-processing** — LuaU-specific syntax (type annotations, compound operators, integer division, `continue`) is stripped or desugared into standard Lua before parsing.
2. **Compilation** — The cleaned AST produced by `luaparse` is walked and compiled into a flat instruction stream using a custom opcode set.
3. **Code generation** — A randomized, self-contained Lua VM is generated around the serialized bytecode. Variable names are shuffled on every run, and string constants are encoded as character-code arrays.
4. **Output** — The result is a valid Lua/LuaU script with no readable identifiers, no original string literals, and no recoverable control flow.

---

## Supported LuaU Features

| Feature | Handling |
|---|---|
| Type annotations (`local x: number`, `: string`, `-> void`) | Stripped at pre-processing |
| Type aliases (`type Foo = ...`, `export type`) | Stripped at pre-processing |
| Compound assignment (`+=`, `-=`, `*=`, `/=`, `%=`, `^=`, `..=`, `//=`) | Desugared to standard assignment |
| Integer division (`//`) | Desugared to `math.floor(a / b)` |
| `continue` statement | Desugared to `goto __continue__` |
| `goto` and `::label::` | Compiled with forward-patch resolution |
| Bitwise operators (`&`, `\|`, `~`, `<<`, `>>`) | Dedicated VM opcodes with `bit32` fallback |
| `table.unpack` vs `unpack` | Runtime-adaptive in generated VM |

---

**Limits**

- Maximum input size: 512 KB
- Rate limit: 60 requests per 15 minutes per IP

---

## Project Structure

```
luau-obfuscator/
├── public/
│   └── index.html          # Web UI
├── src/
│   ├── compiler/
│   │   ├── parser.js       # Pre-processing, desugaring, orchestration
│   │   ├── bytecodeGen.js  # AST walker and bytecode compiler
│   │   └── vmGen.js        # VM code generator and bytecode serializer
│   └── utils/
│       └── nameGen.js      # Randomized name generation
├── server.js               # Express HTTP server
├── package.json
├── DockerFile
└── docker-compose.yml
```

---

## Limitations

- `continue` is desugared to `goto`, which is valid in LuaU but behaves correctly only inside single-level loops. Nested `continue` targeting an outer loop is not supported.
- Type annotations are removed via regex, not a full LuaU parser. Deeply nested generic types (e.g., `Map<string, Array<Foo | Bar>>`) may not strip cleanly in all edge cases.
- The generated VM is a tree-walking interpreter. It is not intended for performance-critical scripts; obfuscation correctness is the primary goal.
- Scripts relying on `debug`, `load`, or `loadstring` at runtime may behave unexpectedly inside the VM environment.
