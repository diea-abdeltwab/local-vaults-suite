// ════════════════════════════════════════════════════════════
// Code Vault — shared extension → language metadata map
// Works in both the Node main process (module.exports) and the
// browser renderer (window.LANG_MAP), loaded via <script> tag.
// ════════════════════════════════════════════════════════════
(function (root) {
  // color = catppuccin mocha variable name (see :root in index.html)
  const LANG_MAP = {
    // ── JavaScript / TypeScript family ──
    js:       { lang: 'JavaScript',  hljs: 'javascript', color: 'yellow' },
    mjs:      { lang: 'JavaScript',  hljs: 'javascript', color: 'yellow' },
    cjs:      { lang: 'JavaScript',  hljs: 'javascript', color: 'yellow' },
    jsx:      { lang: 'JSX',         hljs: 'javascript', color: 'sky' },
    ts:       { lang: 'TypeScript',  hljs: 'typescript', color: 'blue' },
    mts:      { lang: 'TypeScript',  hljs: 'typescript', color: 'blue' },
    tsx:      { lang: 'TSX',         hljs: 'typescript', color: 'sky' },
    vue:      { lang: 'Vue',         hljs: 'xml',        color: 'green' },
    svelte:   { lang: 'Svelte',      hljs: 'xml',        color: 'peach' },

    // ── Python / notebooks ──
    py:       { lang: 'Python',      hljs: 'python',     color: 'blue' },
    pyw:      { lang: 'Python',      hljs: 'python',     color: 'blue' },
    pyi:      { lang: 'Python Stub', hljs: 'python',     color: 'blue' },
    ipynb:    { lang: 'Jupyter Notebook', hljs: 'python', color: 'peach', kind: 'notebook' },

    // ── JVM ──
    java:     { lang: 'Java',        hljs: 'java',       color: 'red' },
    kt:       { lang: 'Kotlin',      hljs: 'kotlin',     color: 'mauve' },
    kts:      { lang: 'Kotlin Script', hljs: 'kotlin',   color: 'mauve' },
    scala:    { lang: 'Scala',       hljs: 'scala',      color: 'red' },
    groovy:   { lang: 'Groovy',      hljs: 'groovy',     color: 'green' },
    gradle:   { lang: 'Gradle',      hljs: 'groovy',     color: 'green' },

    // ── C family ──
    c:        { lang: 'C',           hljs: 'c',          color: 'blue' },
    h:        { lang: 'C Header',    hljs: 'c',          color: 'blue' },
    cpp:      { lang: 'C++',         hljs: 'cpp',        color: 'mauve' },
    cc:       { lang: 'C++',         hljs: 'cpp',        color: 'mauve' },
    cxx:      { lang: 'C++',         hljs: 'cpp',        color: 'mauve' },
    hpp:      { lang: 'C++ Header',  hljs: 'cpp',        color: 'mauve' },
    hh:       { lang: 'C++ Header',  hljs: 'cpp',        color: 'mauve' },
    cs:       { lang: 'C#',         hljs: 'csharp',     color: 'mauve' },
    csx:      { lang: 'C# Script',   hljs: 'csharp',     color: 'mauve' },

    // ── Systems / compiled ──
    go:       { lang: 'Go',          hljs: 'go',         color: 'sky' },
    rs:       { lang: 'Rust',        hljs: 'rust',       color: 'peach' },
    swift:    { lang: 'Swift',       hljs: 'swift',      color: 'peach' },
    m:        { lang: 'Objective-C', hljs: 'objectivec', color: 'sky' },
    mm:       { lang: 'Objective-C++', hljs: 'objectivec', color: 'sky' },
    zig:      { lang: 'Zig',         hljs: 'plaintext',  color: 'peach' },
    nim:      { lang: 'Nim',         hljs: 'plaintext',  color: 'yellow' },
    d:        { lang: 'D',           hljs: 'plaintext',  color: 'red' },
    v:        { lang: 'V',           hljs: 'plaintext',  color: 'blue' },
    asm:      { lang: 'Assembly',    hljs: 'x86asm',     color: 'red' },
    s:        { lang: 'Assembly',    hljs: 'x86asm',     color: 'red' },

    // ── Scripting ──
    rb:       { lang: 'Ruby',        hljs: 'ruby',       color: 'red' },
    erb:      { lang: 'Ruby ERB',    hljs: 'ruby',       color: 'red' },
    php:      { lang: 'PHP',         hljs: 'php',        color: 'mauve' },
    lua:      { lang: 'Lua',         hljs: 'lua',        color: 'blue' },
    pl:       { lang: 'Perl',        hljs: 'perl',       color: 'blue' },
    pm:       { lang: 'Perl Module', hljs: 'perl',       color: 'blue' },
    r:        { lang: 'R',           hljs: 'r',          color: 'blue' },
    jl:       { lang: 'Julia',       hljs: 'julia',      color: 'mauve' },
    dart:     { lang: 'Dart',        hljs: 'dart',       color: 'sky' },
    ex:       { lang: 'Elixir',      hljs: 'elixir',     color: 'mauve' },
    exs:      { lang: 'Elixir Script', hljs: 'elixir',   color: 'mauve' },
    erl:      { lang: 'Erlang',      hljs: 'erlang',     color: 'red' },
    hs:       { lang: 'Haskell',     hljs: 'haskell',    color: 'mauve' },
    clj:      { lang: 'Clojure',     hljs: 'clojure',    color: 'green' },
    cljs:     { lang: 'ClojureScript', hljs: 'clojure',  color: 'green' },
    fs:       { lang: 'F#',          hljs: 'fsharp',     color: 'blue' },
    fsx:      { lang: 'F# Script',   hljs: 'fsharp',     color: 'blue' },
    vb:       { lang: 'VB.NET',      hljs: 'vbnet',      color: 'mauve' },

    // ── Shell ──
    sh:       { lang: 'Shell',       hljs: 'bash',       color: 'green' },
    bash:     { lang: 'Bash',        hljs: 'bash',       color: 'green' },
    zsh:      { lang: 'Zsh',         hljs: 'bash',       color: 'green' },
    fish:     { lang: 'Fish',        hljs: 'bash',       color: 'green' },
    ps1:      { lang: 'PowerShell',  hljs: 'powershell', color: 'blue' },
    psm1:     { lang: 'PowerShell Module', hljs: 'powershell', color: 'blue' },
    bat:      { lang: 'Batch',       hljs: 'dos',        color: 'subtext0' },
    cmd:      { lang: 'Batch',       hljs: 'dos',        color: 'subtext0' },

    // ── Web / markup ──
    html:     { lang: 'HTML',        hljs: 'xml',        color: 'peach' },
    htm:      { lang: 'HTML',        hljs: 'xml',        color: 'peach' },
    xml:      { lang: 'XML',         hljs: 'xml',        color: 'peach' },
    svg:      { lang: 'SVG',         hljs: 'xml',        color: 'peach' },
    css:      { lang: 'CSS',         hljs: 'css',        color: 'blue' },
    scss:     { lang: 'SCSS',        hljs: 'scss',       color: 'pink' },
    sass:     { lang: 'Sass',        hljs: 'scss',       color: 'pink' },
    less:     { lang: 'LESS',        hljs: 'less',       color: 'blue' },

    // ── Data / config ──
    json:     { lang: 'JSON',        hljs: 'json',       color: 'yellow' },
    jsonc:    { lang: 'JSON',        hljs: 'json',       color: 'yellow' },
    json5:    { lang: 'JSON5',       hljs: 'json',       color: 'yellow' },
    yaml:     { lang: 'YAML',        hljs: 'yaml',       color: 'red' },
    yml:      { lang: 'YAML',        hljs: 'yaml',       color: 'red' },
    toml:     { lang: 'TOML',        hljs: 'ini',        color: 'blue' },
    ini:      { lang: 'INI',         hljs: 'ini',        color: 'subtext0' },
    cfg:      { lang: 'Config',      hljs: 'ini',        color: 'subtext0' },
    conf:     { lang: 'Config',      hljs: 'ini',        color: 'subtext0' },
    env:      { lang: 'Env',         hljs: 'ini',        color: 'green' },
    properties: { lang: 'Properties', hljs: 'ini',       color: 'subtext0' },
    graphql:  { lang: 'GraphQL',     hljs: 'graphql',    color: 'pink' },
    gql:      { lang: 'GraphQL',     hljs: 'graphql',    color: 'pink' },
    proto:    { lang: 'Protocol Buffers', hljs: 'protobuf', color: 'peach' },

    // ── Database ──
    sql:      { lang: 'SQL',         hljs: 'sql',        color: 'green' },
    psql:     { lang: 'PostgreSQL',  hljs: 'sql',        color: 'green' },
    ddl:      { lang: 'SQL DDL',     hljs: 'sql',        color: 'green' },

    // ── Docs / text ──
    md:       { lang: 'Markdown',    hljs: 'markdown',   color: 'subtext1' },
    markdown: { lang: 'Markdown',    hljs: 'markdown',   color: 'subtext1' },
    mdx:      { lang: 'MDX',         hljs: 'markdown',   color: 'subtext1' },
    rst:      { lang: 'reStructuredText', hljs: 'plaintext', color: 'subtext1' },
    tex:      { lang: 'LaTeX',       hljs: 'latex',      color: 'blue' },
    txt:      { lang: 'Text',       hljs: 'plaintext',  color: 'subtext0' },
    log:      { lang: 'Log',        hljs: 'plaintext',  color: 'subtext0' },
    csv:      { lang: 'CSV',        hljs: 'plaintext',  color: 'teal' },
    tsv:      { lang: 'TSV',        hljs: 'plaintext',  color: 'teal' },
    diff:     { lang: 'Diff',       hljs: 'diff',       color: 'green' },
    patch:    { lang: 'Patch',      hljs: 'diff',       color: 'green' },

    // ── Build / project files ──
    makefile: { lang: 'Makefile',    hljs: 'makefile',   color: 'peach' },
    dockerfile: { lang: 'Dockerfile', hljs: 'dockerfile', color: 'sky' },
    cmake:    { lang: 'CMake',       hljs: 'cmake',      color: 'blue' },
    csproj:   { lang: 'Project File', hljs: 'xml',       color: 'mauve' },
    vbproj:   { lang: 'Project File', hljs: 'xml',       color: 'mauve' },
    vcxproj:  { lang: 'Project File', hljs: 'xml',       color: 'mauve' },
    sqlproj:  { lang: 'Project File', hljs: 'xml',       color: 'green' },
    sln:      { lang: 'Solution',    hljs: 'plaintext',  color: 'mauve' },
    gitignore:{ lang: 'Git Ignore',  hljs: 'plaintext',  color: 'maroon' },
    gitattributes: { lang: 'Git Attributes', hljs: 'plaintext', color: 'maroon' },
    editorconfig: { lang: 'Editor Config', hljs: 'ini',  color: 'subtext0' },
    npmrc:    { lang: 'NPM Config',  hljs: 'ini',        color: 'red' },
    htaccess: { lang: 'Apache Config', hljs: 'apache',   color: 'green' },
  };

  // Filenames without a (useful) extension — matched exactly, case-insensitive
  const NAME_MAP = {
    dockerfile: { lang: 'Dockerfile', hljs: 'dockerfile', color: 'sky' },
    makefile:   { lang: 'Makefile',   hljs: 'makefile',   color: 'peach' },
    rakefile:   { lang: 'Rakefile',   hljs: 'ruby',       color: 'red' },
    gemfile:    { lang: 'Gemfile',    hljs: 'ruby',       color: 'red' },
    procfile:   { lang: 'Procfile',   hljs: 'yaml',       color: 'subtext0' },
    '.gitignore': { lang: 'Git Ignore', hljs: 'plaintext', color: 'maroon' },
    '.gitattributes': { lang: 'Git Attributes', hljs: 'plaintext', color: 'maroon' },
    '.env':       { lang: 'Env',        hljs: 'ini',       color: 'green' },
    '.env.local': { lang: 'Env',        hljs: 'ini',       color: 'green' },
    '.env.example': { lang: 'Env',      hljs: 'ini',       color: 'green' },
    '.editorconfig': { lang: 'Editor Config', hljs: 'ini', color: 'subtext0' },
    '.eslintrc': { lang: 'ESLint Config', hljs: 'json',   color: 'mauve' },
    '.eslintignore': { lang: 'ESLint Ignore', hljs: 'plaintext', color: 'mauve' },
    '.babelrc':  { lang: 'Babel Config',  hljs: 'json',   color: 'yellow' },
    '.prettierrc': { lang: 'Prettier Config', hljs: 'json', color: 'sky' },
    '.stylelintrc': { lang: 'Stylelint Config', hljs: 'json', color: 'pink' },
    '.browserslistrc': { lang: 'Browserslist', hljs: 'plaintext', color: 'subtext0' },
    '.nvmrc':    { lang: 'NVM Config',   hljs: 'plaintext', color: 'green' },
    '.npmignore': { lang: 'NPM Ignore',  hljs: 'plaintext', color: 'red' },
    '.dockerignore': { lang: 'Docker Ignore', hljs: 'plaintext', color: 'sky' },
    'license':  { lang: 'License',    hljs: 'plaintext',  color: 'subtext1' },
    'license.md': { lang: 'License',  hljs: 'markdown',   color: 'subtext1' },
    'license.txt': { lang: 'License', hljs: 'plaintext',  color: 'subtext1' },
    'readme':   { lang: 'Markdown',   hljs: 'markdown',   color: 'subtext1' },
  };

  const EXPORT = { LANG_MAP, NAME_MAP };
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORT;
  else root.CODE_VAULT_LANGMAP = EXPORT;
})(typeof window !== 'undefined' ? window : globalThis);
