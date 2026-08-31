# Litera — UI/UX Technical Specification

**Status:** Draft técnico para implementação  
**Objetivo:** servir como contrato central de interface para o frontend moderno, reader, modo `/legacy` e painel administrativo.  
**Regra principal:** telas não devem inventar padrões visuais locais quando um token, primitive, component ou pattern existente puder resolver o problema.

---

## 1. Princípios de interface

1. **Conteúdo é o herói.** Capa, título, autor e leitura têm prioridade sobre decoração.
2. **Consistência antes de criatividade local.** Se duas telas têm o mesmo problema, devem usar o mesmo componente/pattern.
3. **Hierarquia por tipografia e espaçamento.** Evitar excesso de bordas, cards, sombras e caixas dentro de caixas.
4. **Reader é um subsistema.** Ele não deve herdar indiscriminadamente o chrome da aplicação.
5. **Admin é separado da experiência de leitura**, mas reutiliza os mesmos primitives, tokens, estados e padrões de formulário.
6. **Progressive enhancement é arquitetura.** O modo moderno pode enriquecer; o `/legacy` preserva os fluxos essenciais com UI simplificada.
7. **Nenhum valor visual arbitrário em feature code.** Cores, espaços, radius, tipografia, sombras e duração de animação vêm de tokens.
8. **Estados assíncronos são parte do componente.** Loading, empty, filtered-empty, error, disabled e read-only devem ser previstos.
9. **Acessibilidade é default.** HTML semântico, foco visível, labels, teclado, touch targets e reduced motion.
10. **Compatibilidade é explícita.** Componentes devem declarar se suportam Modern, Reduced e Legacy.

---

## 2. Camadas da UI

```text
Screen / Route
    ↓
Page Pattern
    ↓
Domain Component
    ↓
Shared Component
    ↓
Primitive
    ↓
Semantic Token
```

### Exemplo correto

```text
LibraryPage
  → CatalogPageLayout
    → BookGrid
      → BookCard
        → Surface + Text + ProgressIndicator
          → semantic tokens
```

### Exemplo proibido

```text
LibraryPage
  → divs locais
  → cor #323232
  → border-radius: 13px
  → padding: 17px
  → botão customizado só desta tela
```

---

## 3. Rotas principais

### Aplicação do leitor

| Rota | Tela | Autenticação |
|---|---|---:|
| `/login` | Login | Não |
| `/` | Home | Sim |
| `/library` | Biblioteca | Sim |
| `/authors` | Autores | Sim |
| `/authors/:id` | Detalhe do autor | Sim |
| `/series` | Séries | Sim |
| `/series/:id` | Detalhe da série | Sim |
| `/genres` | Gêneros | Sim |
| `/genres/:slug` | Livros por gênero | Sim |
| `/search` | Busca | Sim |
| `/favorites` | Favoritos | Sim, se feature ativa |
| `/books/:id` | Detalhe do livro | Sim |
| `/read/:bookId` | Reader | Sim |
| `/settings` | Preferências do usuário | Sim |

### Admin

| Rota | Tela |
|---|---|
| `/admin` | Dashboard |
| `/admin/libraries` | Bibliotecas |
| `/admin/libraries/:id` | Biblioteca / scan / problemas |
| `/admin/users` | Usuários |
| `/admin/metadata` | Metadata providers |
| `/admin/jobs` | Jobs / scans |
| `/admin/system` | Sistema |
| `/admin/compatibility` | Modern / Legacy |

### Legacy

| Rota | Tela |
|---|---|
| `/legacy/login` | Login simplificado |
| `/legacy` | Home simplificada |
| `/legacy/library` | Biblioteca |
| `/legacy/search` | Busca |
| `/legacy/books/:id` | Livro |
| `/legacy/read/:bookId` | Reader legado |

O `/legacy` usa **a mesma API e os mesmos dados**. Não existe API duplicada para legacy.

---

# 4. Shells globais

## 4.1 AppShell — desktop

```text
┌──────────────────────────────────────────────────────────────┐
│ LITERA                 Search…               User / Profile │
├──────────────┬───────────────────────────────────────────────┤
│ Home         │                                               │
│ Library      │               PageHeader                      │
│ Authors      │                                               │
│ Series       │               Page content                    │
│ Genres       │                                               │
│ Favorites    │                                               │
│              │                                               │
│ Settings     │                                               │
├──────────────┤                                               │
│ Admin*       │                                               │
└──────────────┴───────────────────────────────────────────────┘
```

`Admin` só aparece para usuários autorizados.

### Regras

- Sidebar persistente em viewport largo.
- Busca global disponível no shell.
- Conteúdo usa largura máxima quando a leitura visual melhora; grids podem ocupar área maior.
- Não usar card como container padrão da página inteira.

---

## 4.2 AppShell — tablet/mobile

```text
┌──────────────────────────────┐
│ ☰   LITERA            Search│
├──────────────────────────────┤
│ Page title                   │
│                              │
│ Content                      │
│                              │
└──────────────────────────────┘
```

Navigation abre em `Drawer` reutilizável.

### Regra

Nunca criar um menu mobile diferente por módulo. A aplicação inteira usa o mesmo `AppNavigationDrawer`.

---

## 4.3 AdminShell

```text
┌──────────────────────────────────────────────────────────────┐
│ LITERA ADMIN                              Back to Library    │
├──────────────┬───────────────────────────────────────────────┤
│ Overview     │ PageHeader                                    │
│ Libraries    │                                               │
│ Users        │ Admin content                                 │
│ Metadata     │                                               │
│ Jobs         │                                               │
│ Compatibility│                                              │
│ System       │                                               │
└──────────────┴───────────────────────────────────────────────┘
```

Admin reutiliza `Button`, `Input`, `Select`, `Dialog`, `Toast`, `Badge`, `Table`, etc. Não deve virar um design system paralelo.

---

## 4.4 ReaderShell

O Reader não usa `AppShell` completo.

```text
┌──────────────────────────────────────────────────────────────┐
│ ← Library     Book title          37%      ☰  Aa  🔍  ⋯     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                                                              │
│                         BOOK CONTENT                         │
│                                                              │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                  contextual progress / nav                   │
└──────────────────────────────────────────────────────────────┘
```

- chrome desaparece quando não necessário;
- reaparece por toque/clique/movimento/tecla;
- foco deve continuar no conteúdo;
- configuração visual abre `ReaderSettingsPanel`, não uma tela nova.

---

# 5. Design tokens

Todos os valores concretos devem viver em um único módulo, por exemplo:

```text
src/ui/tokens/
  colors.css
  spacing.css
  typography.css
  shape.css
  motion.css
  breakpoints.ts
```

## 5.1 Spacing

Escala inicial permitida:

```text
space-0  = 0
space-1  = 4px
space-2  = 8px
space-3  = 12px
space-4  = 16px
space-5  = 24px
space-6  = 32px
space-7  = 48px
space-8  = 64px
```

**Regra:** feature code não cria `margin: 19px` ou `gap: 27px`.

## 5.2 Radius

```text
radius-sm   = 6px
radius-md   = 10px
radius-lg   = 16px
radius-pill = 999px
```

Usos:
- `sm`: inputs e controles compactos;
- `md`: buttons/surfaces comuns;
- `lg`: dialogs/drawers e cards grandes;
- `pill`: badges/chips somente.

## 5.3 Tipografia

```text
text-xs    = 12px
text-sm    = 14px
text-md    = 16px
text-lg    = 18px
text-xl    = 22px
text-2xl   = 28px
text-3xl   = 36px
```

Semantic aliases:

```text
text-body
text-caption
text-label
text-page-title
text-section-title
text-book-title
text-reader-body
```

O reader pode ter sua própria escala controlada pelo usuário, mas usa tokens/variáveis próprias do subsystem.

## 5.4 Cores semânticas

Nunca consumir palette raw diretamente na feature.

```text
color-bg
color-surface
color-surface-raised
color-text
color-text-muted
color-border
color-primary
color-primary-hover
color-focus
color-success
color-warning
color-danger
color-info
color-overlay
```

A paleta concreta pode mudar sem alterar componentes.

## 5.5 Elevação

Usar somente onde há sobreposição real:

```text
elevation-0  normal flow
elevation-1  dropdown/popover
elevation-2  drawer/dialog
elevation-3  critical overlay only
```

Não usar sombra apenas para “deixar bonito”.

## 5.6 Motion

```text
motion-fast   = 120ms
motion-normal = 180ms
motion-slow   = 240ms
```

- sem animações longas;
- `prefers-reduced-motion` remove transições não essenciais;
- `/legacy` remove motion não essencial.

---

# 6. Breakpoints e layout

Referência inicial:

```text
mobile   < 640px
tablet   640–899px
compact  900–1199px
desktop  1200–1439px
wide     >= 1440px
```

Não criar CSS baseado no nome do dispositivo. Usar espaço disponível e capability checks.

### Grid de livros

- mobile: 2 colunas quando comportar, senão 1;
- tablet: 3–4;
- desktop: 4–6;
- wide: 6–8;
- cards preservam proporção da capa;
- título pode truncar após duas linhas;
- autor deve continuar identificável.

---

# 7. Primitives obrigatórios

Implementar cedo e reutilizar no projeto inteiro.

### Action
- `Button`
- `IconButton`
- `LinkButton`

### Form
- `Input`
- `PasswordInput`
- `SearchInput`
- `Textarea`
- `Select`
- `Checkbox`
- `Switch`
- `Field`
- `FieldError`

### Overlay
- `Dialog`
- `ConfirmDialog`
- `Drawer`
- `Popover`
- `Menu`
- `Tooltip` apenas quando realmente necessário

### Feedback
- `Toast`
- `Alert`
- `Badge`
- `ProgressIndicator`
- `Skeleton`
- `Spinner`
- `EmptyState`
- `ErrorState`

### Structure
- `Stack`
- `Inline`
- `Cluster`
- `Divider`
- `Surface`
- `PageHeader`
- `SectionHeader`

**Não criar** `BlueButton`, `LibraryButton`, `AdminInput`, `BookDialog` se a diferença for apenas visual.

---

# 8. Domain components

## Catálogo

- `BookCard`
- `BookCover`
- `BookGrid`
- `BookListItem`
- `BookMetadata`
- `BookProgress`
- `BookActions`
- `AuthorLink`
- `SeriesLink`
- `GenreChip`

## Reader

- `ReaderToolbar`
- `ReaderProgress`
- `ReaderNavigation`
- `ReaderToc`
- `ReaderSettingsPanel`
- `ReaderSearchPanel`
- `ReaderError`

## Admin

- `AdminStat`
- `DataTable`
- `StatusBadge`
- `JobProgress`
- `LibraryPathField`
- `ProviderStatus`

Admin components podem ser específicos do domínio, porém usam os primitives compartilhados.

---

# 9. Page patterns reutilizáveis

## 9.1 CatalogPage

Usado em Library, Favorites, Genre, Series books, Author books.

```text
PageHeader
  title
  optional description
  primary action
  filters/sort

FilterBar

BookGrid | BookList

Pagination / incremental load
```

Essas telas **não devem reimplementar** toolbar e filtros separadamente.

## 9.2 DetailPage

Usado para Book, Author, Series.

```text
Breadcrumb / back
Hero identity
Primary metadata
Primary action
Secondary actions
Content sections
Related content
```

## 9.3 AdminListPage

Usado para Libraries, Users, Jobs, Providers.

```text
PageHeader
Primary action
Filter/search
DataTable / responsive list
Pagination
```

## 9.4 SettingsPage

```text
PageHeader
SettingsSection
  title
  explanation
  controls
  optional dangerous action
```

Não transformar cada configuração em um card diferente.

---

# 10. Tela — Login

## Objetivo

Autenticar com o menor ruído possível.

```text
Desktop

┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                       L I T E R A                            │
│               Your personal library                         │
│                                                              │
│               ┌────────────────────────┐                     │
│               │ Username / email       │                     │
│               │ [____________________] │                     │
│               │                        │                     │
│               │ Password               │                     │
│               │ [____________________] │                     │
│               │                        │                     │
│               │ [ Sign in           ]  │                     │
│               │                        │                     │
│               │ error area             │                     │
│               └────────────────────────┘                     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Componentes

- `AuthLayout`
- `Field`
- `Input`
- `PasswordInput`
- `Button`
- `Alert`

### Regras

- sem sidebar;
- Enter envia;
- erros aparecem inline/Alert, nunca somente Toast;
- botão mostra loading e evita duplo submit;
- focus inicial no primeiro campo;
- `/legacy/login` mantém o mesmo fluxo, com CSS/JS simplificados.

---

# 11. Tela — Home

```text
┌──────────────────────────────────────────────────────────────┐
│ Home                                                         │
│                                                              │
│ Continue Reading                              View all        │
│ [Cover 34%] [Cover 81%] [Cover 12%]                          │
│                                                              │
│ Recently Added                               View library     │
│ [book] [book] [book] [book] [book]                           │
│                                                              │
│ Library Highlights                                           │
│ [series/author/genre collection sections]                    │
└──────────────────────────────────────────────────────────────┘
```

### Regras

- `ContinueReadingRail` reutiliza `BookCard` em variante horizontal/compacta;
- progresso sempre visualmente consistente;
- se não há leitura ativa, a seção desaparece ou usa `EmptyState` útil;
- evitar dashboard com métricas irrelevantes ao leitor.

---

# 12. Tela — Library

```text
Library                                           [Grid/List]
All your books

[ Search library __________________ ] [Filters] [Sort ▼]

Active filters: [EPUB ×] [Unread ×]

[Cover] [Cover] [Cover] [Cover] [Cover]
Title   Title   Title   Title   Title
Author  Author  Author  Author  Author
 12%             Read           67%
```

### Componentes

- `CatalogPageLayout`
- `SearchInput`
- `FilterButton`
- `FilterDrawer`
- `SortMenu`
- `ViewToggle`
- `BookGrid`
- `BookCard`
- `EmptyState`
- `ErrorState`

### Mobile

Filtros abrem em `Drawer`. Não comprimir 8 filtros numa barra horizontal.

---

# 13. Tela — Search

Busca global deve usar a mesma linguagem visual do catálogo.

```text
Search
[ Tolkien______________________________________ ]

Books (18)
[book grid/list]

Authors (2)
[AuthorResult]

Series (1)
[SeriesResult]
```

### Estados

1. nenhum termo → sugestões/recentes opcionais;
2. buscando → skeleton;
3. resultados;
4. zero resultados → filtered-empty;
5. erro → retry.

---

# 14. Tela — Book Detail

```text
← Library

┌────────────┐   The Book Title
│            │   Author Name
│   COVER    │   Series Name · #2
│            │
│            │   37% read
└────────────┘   [ Continue reading ] [♡] [⋯]

                 Description...

                 Metadata
                 Language · Published · ISBN · Format

                 Genres
                 [Fantasy] [Adventure]
```

### Desktop

Capa + conteúdo em duas colunas.

### Mobile

Capa menor centralizada ou alinhada; ações não podem ficar dependentes de hover.

### Componentes

- `BookCover`
- `BookMetadata`
- `BookProgress`
- `BookActions`
- `GenreChip`
- `MetadataList`

`Continue reading` é a ação primária quando há progresso. Caso contrário `Start reading`.

---

# 15. Reader — EPUB

## Estrutura

```text
Hidden/auto toolbar

←            Book title                     37%   TOC   Aa   ⋯
───────────────────────────────────────────────────────────────

            Chapter title

            Long-form content with controlled measure.
            Typography prioritizes sustained reading.

───────────────────────────────────────────────────────────────
          previous       chapter/progress       next
```

## ReaderSettingsPanel

```text
Reading settings

Theme
[Light] [Sepia] [Dark]

Text size
[-]  100%  [+]

Font
[Default ▼]

Line height
[Compact] [Normal] [Relaxed]

Margins
[Narrow] [Normal] [Wide]
```

Use controles discretos com presets. Evitar sliders para tudo.

## State ownership

```text
ReaderShell
  ├── reader session state
  ├── UI chrome state
  └── format adapter
        └── semantic locator
```

O componente visual nunca decide sozinho o formato persistido de progresso.

---

# 16. Reader — PDF

Mesma casca, controles específicos.

```text
← Book       Page 42 / 318       - 100% +    Fit width   Search
───────────────────────────────────────────────────────────────

                         PDF PAGE

───────────────────────────────────────────────────────────────
       ← page                                    page →
```

`ReaderToolbar` recebe capabilities do adapter e mostra somente ações disponíveis.

Exemplo:

```ts
interface ReaderCapabilities {
  toc: boolean
  textSettings: boolean
  search: boolean
  zoom: boolean
  pagination: boolean
  twoPage: boolean
}
```

Não usar `if (format === 'pdf')` espalhado por dezenas de componentes.

---

# 17. Tela — User Settings

Seções iniciais:

```text
Settings

Appearance
- theme
- language (future-ready)

Reading
- default EPUB theme
- default text size
- reduced motion preference, if app override exists

Account
- display name
- password change
- sessions (future)
```

Não misturar configurações do servidor com configurações pessoais.

---

# 18. Admin — Dashboard

Objetivo: estado operacional, não BI decorativo.

```text
Admin Overview

[ 1,284 Books ] [ 3 Libraries ] [ 8 Users ] [ Healthy ]

System status
Database       Healthy
Metadata       Healthy
Storage        Available
Legacy         Enabled

Recent jobs
Scan Main Library      Completed     4m ago
Metadata enrichment    Running       42%

Problems requiring attention
3 files failed ingestion
1 metadata provider unavailable
```

### Componentes

- `AdminStat`
- `StatusBadge`
- `JobProgress`
- `AlertList`

Não criar gráficos sem uma pergunta operacional concreta.

---

# 19. Admin — Libraries

```text
Libraries                                      [ Add library ]

Main Books
/volume/books
1,204 books · Last scan 12 min ago · Healthy
[ Open ] [ Scan now ] [ ⋯ ]

Comics
/volume/comics
80 books · Last scan yesterday · 2 warnings
[ Open ] [ Scan now ] [ ⋯ ]
```

## Add/Edit Library

Usar `Dialog` em formulário curto ou página dedicada se crescer.

```text
Library name
[________________________]

Filesystem path
[________________________]

Formats
[x] EPUB
[x] PDF

[ Cancel ] [ Save library ]
```

Path deve ter validação clara e não expor detalhes desnecessários para usuários não-admin.

---

# 20. Admin — Library Detail

```text
Main Books                                   Healthy
/volume/books

[ Scan now ] [ Edit ]

Overview
Books          1,204
Files          1,208
Errors         4
Last scan      12 min ago

Scan history
[DataTable]

Ingestion problems
File                 Type     Problem          Action
foo.epub             EPUB     Invalid archive  Details
bar.pdf              PDF      Parse failed     Details
```

`DataTable` é um único componente reutilizável para admin desktop, com fallback para linhas/cards responsivos em viewport estreito.

---

# 21. Admin — Users

```text
Users                                           [ Add user ]

Search users…

Name       Role      Status       Last activity       Actions
Rafael     Admin     Active       Today               ⋯
Ana        Reader    Active       Yesterday           ⋯
```

## User detail/edit

- identidade;
- role;
- bibliotecas acessíveis;
- status ativo/desativado;
- reset de credenciais quando implementado;
- nunca mostrar progresso de leitura de outro usuário sem requisito administrativo explícito.

---

# 22. Admin — Metadata Providers

```text
Metadata

Open Library               Connected / Enabled
Description...
[ Configure ] [ Test ] [ Disable ]

Provider B                 Disabled
Description...
[ Configure ] [ Enable ]
```

Configuração de secret/key usa `PasswordInput` e nunca reexibe valor integral após persistência.

Provider status deve usar `StatusBadge`, não cores inventadas por provider.

---

# 23. Admin — Jobs

```text
Jobs

[All] [Running] [Failed] [Completed]

Metadata enrichment
Running · 421 / 1,204
████████████░░░░░ 35%
Started 10:42

Library scan
Completed
1,204 files · 4 problems
```

Jobs de longa duração devem ter status persistente no backend; a UI apenas observa.

---

# 24. Admin — Compatibility / Legacy

Essa tela centraliza compatibilidade e evita flags dispersas.

```text
Compatibility

Legacy client
Provide a simplified interface for older browsers and devices.

[ ON ] Enable /legacy

Legacy URL
https://litera.example/legacy

Target profile
Older WebKit / iOS 10 generation

Supported core flows
✓ Sign in
✓ Browse library
✓ Search
✓ Book details
✓ EPUB reading
✓ Reading progress sync
~ PDF reading: best effort

[ Save changes ]
```

## Comportamento

Configuração inicial:

```ts
legacy.enabled: boolean
```

Quando `false`:

- `/legacy/*` não carrega a aplicação;
- backend retorna uma resposta controlada 404/403 conforme política escolhida;
- não redirecionar automaticamente para app moderno.

Quando `true`:

- `/legacy` é servido;
- utiliza os mesmos endpoints `/api/*`;
- nenhum recurso administrativo é obrigatório no legacy.

### Browser incompatível na aplicação moderna

Pode ser oferecida uma tela simples:

```text
This browser may not support the full Litera interface.

[ Open compatibility mode ]
```

Não fazer redirect automático baseado apenas em User-Agent.

---

# 25. `/legacy` — princípios

Legacy **não é outro produto** e **não é uma cópia antiga da UI moderna**.

## Deve preservar

- identidade Litera;
- conteúdo;
- hierarquia tipográfica;
- actions principais;
- mesmos modelos e API;
- mesmos conceitos de navegação.

## Pode remover

- animações;
- overlays complexos;
- grids sofisticados;
- filtros avançados;
- virtualização moderna;
- efeitos visuais;
- administração;
- recursos não essenciais ao fluxo de leitura.

## Shell legado

```text
┌──────────────────────────────────┐
│ LITERA                Search     │
├──────────────────────────────────┤
│ Home | Library | Favorites | Me │
├──────────────────────────────────┤
│                                  │
│ Content                          │
│                                  │
└──────────────────────────────────┘
```

Preferir navegação simples e server-compatible markup quando útil.

---

# 26. Estados obrigatórios

Cada componente/pattern assíncrono declara explicitamente:

| Estado | Exemplo |
|---|---|
| `idle` | antes da consulta |
| `loading` | skeleton/spinner contextual |
| `loaded` | conteúdo normal |
| `empty` | biblioteca sem livros |
| `filtered-empty` | filtro não encontrou resultados |
| `error` | falha + ação de retry |
| `disabled` | ação indisponível |
| `read-only` | conteúdo visível sem edição |
| `partial` | provider falhou, dados locais ainda existem |

Não retornar página em branco porque uma API falhou.

---

# 27. Feedback e ações destrutivas

## Toast

Usar para confirmação não bloqueante:

- “Settings saved”;
- “Scan started”;
- “Added to favorites”.

## Alert inline

Usar quando a mensagem pertence ao contexto atual:

- login incorreto;
- path inválido;
- provider indisponível;
- erro de carregamento.

## ConfirmDialog

Obrigatório para ações destrutivas importantes:

- remover biblioteca;
- desativar usuário;
- limpar dados;
- cancelar operação com impacto real.

Nunca confirmar ações comuns como “salvar configuração”.

---

# 28. Ícones

- uma única biblioteca de ícones;
- tamanho normalizado por token/componente;
- nenhum SVG copiado aleatoriamente para features;
- icon-only actions exigem accessible label;
- não depender apenas do ícone em ações administrativas ambíguas.

---

# 29. Convenção de componentes

Sugestão de estrutura:

```text
src/
  ui/
    tokens/
    primitives/
    components/
    patterns/
  domains/
    catalog/
      components/
      pages/
    reader/
      components/
      adapters/
      pages/
    account/
    admin/
  shells/
    AppShell.vue
    AdminShell.vue
    ReaderShell.vue
  legacy/
```

## Critério para criar um componente

Criar componente compartilhado quando uma destas condições for verdadeira:

1. usado em 2+ contextos;
2. encapsula comportamento/acessibilidade difícil;
3. representa conceito de domínio claro;
4. precisa manter consistência global.

Não extrair componentes triviais apenas para reduzir linhas de arquivo.

---

# 30. Variantes em vez de componentes duplicados

Preferir:

```vue
<BookCard variant="grid" />
<BookCard variant="compact" />
```

em vez de:

```text
BookCard.vue
HomeBookCard.vue
SearchBookCard.vue
FavoriteBookCard.vue
SmallBookCard.vue
```

Mas não transformar componentes em APIs gigantes com dezenas de booleanos. Quando o significado muda, criar pattern/domain component apropriado.

---

# 31. Capability-driven Reader UI

O adapter define funcionalidades disponíveis.

```ts
interface ReaderCapabilities {
  toc: boolean
  search: boolean
  typography: boolean
  themes: boolean
  zoom: boolean
  pages: boolean
  continuousFlow: boolean
  twoPage: boolean
}
```

`ReaderToolbar` renderiza ações a partir dessas capabilities.

Isso evita duas toolbars completamente diferentes para EPUB e PDF.

---

# 32. Responsividade central

Cada componente compartilhado deve resolver sua própria adaptação quando possível.

Exemplo:

```text
BookGrid owns its columns
AppShell owns navigation mode
DataTable owns responsive representation
ReaderToolbar owns compact controls
```

A feature não deve duplicar media queries para corrigir componentes que já deveriam ser responsivos.

---

# 33. Regras anti “sopa de UI/UX”

Antes de qualquer PR com interface, o programador deve responder:

1. Existe primitive para isso?
2. Existe shared component para isso?
3. Existe domain component para isso?
4. Existe page pattern para isso?
5. Estou introduzindo uma nova cor/espaçamento/radius?
6. Estou criando um novo padrão de Dialog/Toast/formulário?
7. Essa diferença visual representa diferença semântica real?
8. Funciona em desktop, touch e teclado?
9. Qual é o comportamento Reduced/Legacy?

Se a resposta para 5 ou 6 for “sim”, exige alteração explícita desta foundation/design system antes da feature.

---

# 34. Definition of Done — UI

Uma tela não está pronta até:

- [ ] usar somente tokens oficiais;
- [ ] reutilizar primitives/shared components existentes;
- [ ] loading definido;
- [ ] empty definido quando aplicável;
- [ ] error + retry definido quando aplicável;
- [ ] teclado funciona;
- [ ] foco é visível;
- [ ] labels acessíveis existem;
- [ ] touch targets são adequados;
- [ ] mobile/tablet/desktop foram testados;
- [ ] reduced motion foi considerado;
- [ ] não existem valores visuais arbitrários sem justificativa;
- [ ] feature não duplicou um pattern existente;
- [ ] Reader declara capabilities corretamente, quando aplicável;
- [ ] comportamento `/legacy` foi classificado: supported / reduced / unavailable;

---

# 35. Ordem recomendada de implementação

## Fase 1 — foundation

1. semantic tokens;
2. primitives de form/action;
3. overlays/feedback;
4. layout primitives;
5. AppShell;
6. AdminShell;
7. estados padrão.

## Fase 2 — catálogo

1. BookCover;
2. BookCard;
3. BookGrid;
4. CatalogPageLayout;
5. Login;
6. Home;
7. Library;
8. Search;
9. Book Detail.

## Fase 3 — reader

1. ReaderShell;
2. ReaderCapabilities contract;
3. EPUB adapter;
4. ReaderToolbar;
5. TOC;
6. Settings;
7. progress persistence;
8. PDF adapter.

## Fase 4 — admin

1. AdminListPage pattern;
2. DataTable;
3. Dashboard;
4. Libraries;
5. Users;
6. Metadata;
7. Jobs;
8. System;
9. Compatibility.

## Fase 5 — legacy

1. legacy shell;
2. login;
3. library;
4. search;
5. book detail;
6. reader;
7. real-device compatibility acceptance tests.

---

# 36. Regra final para o programador

> Antes de desenhar uma tela nova, componha-a com peças existentes. Antes de criar uma peça nova, verifique se o problema realmente é novo. Antes de adicionar um valor visual, procure o token semântico correspondente. O Litera deve parecer um único produto, independentemente de qual módulo ou programador implementou cada tela.

