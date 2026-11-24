# HashiMemo

**Notas rápidas em Markdown na borda da tela — leves, locais e legíveis por agentes de IA.**

<p align="center">
  <img src="public/assets/kami/classico.png" alt="Kami, o mascote do HashiMemo" width="132">
</p>

<p align="center">
  <img alt="licença GPL-3.0" src="https://img.shields.io/badge/licen%C3%A7a-GPL--3.0-cba6f7">
  <img alt="Rust" src="https://img.shields.io/badge/rust-1.90%2B-1e1e2e">
  <img alt="Tauri" src="https://img.shields.io/badge/tauri-v2-24c8db">
  <img alt="React" src="https://img.shields.io/badge/react-19-61dafb">
  <img alt="Windows" src="https://img.shields.io/badge/windows-10%2F11-0078d4">
  <img alt="Linux" src="https://img.shields.io/badge/linux-arch%2Fcachyos-1793d1">
  <img alt="status" src="https://img.shields.io/badge/vers%C3%A3o-0.3.1-f9e2af">
</p>

HashiMemo vive encaixado na borda direita da tela e guarda cada nota em um arquivo
`.md` comum, com frontmatter YAML. Não existe servidor, porta aberta ou banco de
dados: o diretório `~/HashiMemo/notes/` **é** o estado do aplicativo. Qualquer
agente, script ou editor de texto que saiba escrever um arquivo consegue ler e
editar suas notas — e a interface reage na hora.

O núcleo é Rust + Tauri v2 com WebView do sistema, sem runtime embutido e sem
Electron. A interface usa React + TypeScript + Tailwind e segue o tema Catppuccin.

## ✨ Recursos

**Janela e bandeja**

- Rail encaixado na borda direita (360 px), com três níveis: Docked, Foco (70%)
  e Maximizado, animados em 180 ms, e `Esc` para voltar
- Encaixe no topo com reserva da área útil; barra de tarefas só em Foco/Max
- **Bolinha do Kami**: minimiza para uma bolha flutuante com arrasto, inércia,
  snap magnético nas bordas, menu de contexto, bloqueio de posição e restauro
- Bandeja com mostrar/ocultar, modo bolinha/ocultar, resetar janelas e sair;
  ícone do tray é o rosto do Kami
- Instância única, atalho global `Ctrl+Alt+N` e autostart
- Hyprland/Wayland: `hyprctl dispatch` para posicionar, fixar e redimensionar

**Notas e editor**

- Arquivos `.md` individuais com frontmatter YAML, escrita atômica e rename pelo título
- Watcher (`notify`) que reflete edições externas e da CLI em tempo real
- Editor TipTap: títulos, negrito, itálico, sublinhado, tachado, código, citação,
  listas (com **lista de tarefas e checkbox**), imagens e modo Markdown cru
- Menu de contexto próprio com os atalhos ao lado de cada ação
- Atalhos: `Ctrl+B`, `Ctrl+I`, `Ctrl+U`, `Ctrl+Shift+X`, `Ctrl+Shift+8/7/9`
- Imagens coladas, arrastadas ou capturadas da janela ativa (salvas em `media/`;
  apps com composição por GPU ainda saem pretos — ver roadmap)
- Linhas em branco de verdade: o Enter duplo vira `\` ou `<br>` e sobrevive ao salvar
- Grupos, cores, `pinned`, `order`, busca e ordenação por `mtime`
- **Autosave por nota**: o on/off das Configurações é só o padrão da nota nova;
  o interruptor do rodapé vale só para aquela nota
- Lembretes (`remind_at`) com toast
- **Cofre**: PIN com Argon2id + AES-256-GCM por nota, 4 erros em 30 s apagam as
  notas protegidas

**CLI**

- `hashimemo new|list|read|search|edit|rm|context|path`, com `--json` em tudo
  que lista; a CLI não abre a janela

## 📄 Estrutura das notas

```markdown
---
id: 0193b5f2-6a1e-7c3d-9f10-2b8c4d5e6f70
title: Docking no Wayland
color: mauve
group: Arquitetura
order: 1.5
pinned: true
hidden: false
remind_at: ''
protected: false
created: 2026-11-17T09:12:04-03:00
updated: 2026-11-17T10:03:41-03:00
---

Wayland não aceita `set_position` do cliente.

- [x] `hyprctl dispatch`
- [ ] regra `windowrulev2` de fallback

![captura](../media/6f1c9d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f.png)
```

| Campo | Tipo | Função |
|---|---|---|
| `id` | UUID | identidade estável, usada pela CLI |
| `title` | texto | título exibido; renomear o arquivo não muda o `id` |
| `color` | `mauve`, `blue`, `green`, `peach`, `red`, `yellow`, `teal`, `pink` | cor de destaque |
| `group` | texto | pasta lógica (aba do rail) |
| `order` | número | posição no rail |
| `pinned` | booleano | nota fixada no topo |
| `hidden` | booleano | some do rail (usado pelo cofre) |
| `remind_at` | RFC 3339 ou vazio | lembrete |
| `protected` | booleano | nota cifrada no cofre |
| `autosave` | booleano, opcional | ausente = segue as Configurações |
| `created` / `updated` | RFC 3339 | datas de criação e última escrita |

Regras do formato:

- O nome do arquivo é o slug do título (`notes/2026-11-17-docking-no-wayland.md`).
- Chaves YAML desconhecidas são preservadas — a IA pode adicionar metadados próprios.
- A escrita é atômica (temporário + `rename`) e protegida por `mtime`: se o arquivo
  mudou por fora enquanto você editava, a interface avisa em vez de sobrescrever.
- Nota protegida guarda `secret_title`/`secret_body` cifrados; o corpo fica vazio no `.md`.

## 🚀 Instalação

### Windows 10/11

Pré-requisitos para compilar:

```powershell
winget install Rustlang.Rustup
winget install Microsoft.EdgeWebView2Runtime
```

Compilando:

```powershell
git clone https://github.com/weslinsx/hashimemo.git
cd hashimemo
npm install
npm run tauri build
```

O binário fica em `src-tauri\target\release\hashimemo.exe` e o instalador em
`src-tauri\target\release\bundle\`.

> Trocar o ícone exige limpar `src-tauri\target\release\build\hashimemo` antes do
> build: o `libresource.a` em cache mantém o ícone antigo no executável.

### Arch Linux / CachyOS

```bash
sudo pacman -S --needed base-devel webkit2gtk-4.1 gtk3 libsoup3 librsvg \
  nodejs npm rustup
rustup default stable

git clone https://github.com/weslinsx/hashimemo.git
cd hashimemo
npm install
npm run tauri build
```

Para rodar em desenvolvimento: `npm run tauri dev`.
Para validar o editor sem abrir a janela: `npm run smoke` (round-trip Markdown).

## 🪟 Hyprland / Wayland

Wayland não permite que um cliente se posicione na tela, e o Hyprland é quem
decide onde a janela fica. O HashiMemo detecta `HYPRLAND_INSTANCE_SIGNATURE` e
aplica `setfloating`, `pin` e tamanho/posição via `hyprctl dispatch` (usando o
`address` obtido de `hyprctl clients -j`).

Se preferir regras estáticas, adicione ao `~/.config/hypr/hyprland.conf`:

```conf
windowrulev2 = float,class:^(HashiMemo)$
windowrulev2 = pin,class:^(HashiMemo)$
windowrulev2 = size 360 100%,class:^(HashiMemo)$
windowrulev2 = move 100%-360 0,class:^(HashiMemo)$
windowrulev2 = noborder,class:^(HashiMemo)$
windowrulev2 = noshadow,class:^(HashiMemo)$
```

Confirme a classe real com `hyprctl clients | grep class`. Em X11 e no Windows o
posicionamento é feito pela própria janela — inclusive contra tiling WMs, graças
ao `WS_EX_TOOLWINDOW` da bolinha.

## ⌨️ CLI

O mesmo binário aceita subcomandos e **não abre a interface** quando chamado assim.
Nada de socket ou HTTP: a CLI lê e escreve os mesmos arquivos que o app monitora.

```bash
hashimemo new "revisar o parser de mídia" --color blue --group dev
hashimemo new --title "Reunião" --group trabalho
hashimemo list                        # tabela: id, título, grupo, updated
hashimemo list --json                 # saída para scripts e agentes
hashimemo read 0193b5f2               # id, prefixo de id ou slug
hashimemo search "wayland"            # título, corpo e grupo
hashimemo context --notes 5           # últimas notas em formato de prompt
hashimemo edit 0193b5f2 --append "..."  # também aceita --title/--body/--group/--color
hashimemo rm 0193b5f2                 # remove a nota (arquivo .md)
hashimemo path                        # pasta de notas em uso
```

## 🎨 Kami (mascote e ícones)

- **Poses**: 27 PNGs em `src/assets/kami/` (idle, dormindo, acordando, escrevendo,
  pesquisando, comemorando e as novas salvando, pensando, triste, orgulhoso,
  acenando, entediado, lendo-carta, prancheta, com-cafe), ligadas no `Kami.tsx`
- **Ícones do app**: 9 em `public/assets/kami/` — Clássico (em uso) e variações
- **Ícones de UI**: 9 ícones lineares em 128 px em `public/assets/ui/`
- **Originais**: `Kami/fontes/` (não editar; referência de estilo)
- Catálogo, uso de cada peça e regras de geração ficam na nota
  `Kami — catálogo de assets` no próprio HashiMemo

## 🗂️ Estrutura do repositório

```text
hashimemo/
├── src/                      # React + TypeScript + Tailwind
│   ├── App.tsx               # rail, cards, editor, configurações, modais
│   ├── RichEditor.tsx        # TipTap: markdown, atalhos, menu, tarefas
│   ├── Bubble.tsx            # bolha do Kami (arrasto, menu)
│   ├── Kami.tsx              # poses do mascote
│   └── assets/kami/          # poses em PNG
├── public/assets/            # ícones do app (kami/) e de UI (ui/)
├── Kami/fontes/              # folhas originais geradas no Gemini
├── scripts/smoke-md.mjs      # round-trip do markdown
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs            # tray, instância única, hotkey e comandos IPC
│   │   ├── main.rs           # CLI (clap) e abertura da GUI
│   │   ├── bubble.rs         # bolinha: snap, inércia, restauro
│   │   ├── capture.rs        # captura da janela ativa
│   │   ├── pin.rs            # PIN, bloqueio e wipe após 4 erros
│   │   ├── secure.rs         # Argon2id + AES-256-GCM
│   │   ├── settings.rs       # tema, motion, autosave, cofre, bolinha
│   │   ├── notes/            # CRUD, frontmatter, watcher
│   │   └── window/           # níveis, appbar, animação, Hyprland, Win32
│   ├── capabilities/         # permissões das janelas
│   ├── icons/                # ícones do bundle (gerados por `tauri icon`)
│   └── tauri.conf.json
└── package.json
```

## 🗺️ Roadmap

- [x] Estrutura Tauri v2 + React + Tailwind com tema Catppuccin
- [x] Rail, níveis Foco/Maximizado, toggle de encaixe e bandeja
- [x] Bolinha do Kami com arrasto, inércia, snap e menu
- [x] Notas `.md` com frontmatter, escrita atômica e `mtime` guard
- [x] Watcher com atualização instantânea da interface
- [x] Editor rico, listas de tarefas, imagens, atalhos e menu de contexto
- [x] Autosave global e por nota
- [x] Cofre com PIN (Argon2id + AES-GCM) e wipe após 4 erros
- [x] Lembretes com toast
- [x] CLI com `clap` e saída JSON
- [x] Grupo, cor, ordem, fixar e busca
- [ ] Print da janela ativa em apps com GPU (`PrintWindow` + `PW_RENDERFULLCONTENT`)
- [ ] Alças de bloco estilo Obsidian (arrastar/reordenar, menu de tipo, `/`)
- [ ] Autostart pelo plugin oficial (hoje há duas entradas `Run` no Windows)
- [ ] Teste ao vivo do PIN e do wipe
- [ ] Builds automatizados (Windows + Arch) e Android
- [ ] Segundo cérebro: `[[links]]`, backlinks, grafo e tags

## 📜 Licença

GPL-3.0 — veja [LICENSE](LICENSE).
