# HashiMemo

**Notas rápidas em Markdown na borda da tela — leves, locais e legíveis por agentes de IA.**

<p align="center">
  <img src="src-tauri/icons/icon.svg" alt="Ícone do HashiMemo" width="132">
</p>

<p align="center">
  <img alt="licença GPL-3.0" src="https://img.shields.io/badge/licen%C3%A7a-GPL--3.0-cba6f7">
  <img alt="Rust" src="https://img.shields.io/badge/rust-1.90%2B-1e1e2e">
  <img alt="Tauri" src="https://img.shields.io/badge/tauri-v2-24c8db">
  <img alt="React" src="https://img.shields.io/badge/react-19-61dafb">
  <img alt="Windows" src="https://img.shields.io/badge/windows-10%2F11-0078d4">
  <img alt="Linux" src="https://img.shields.io/badge/linux-arch%2Fcachyos-1793d1">
  <img alt="status" src="https://img.shields.io/badge/status-alpha-f9e2af">
</p>

HashiMemo vive encaixado na borda direita da tela e guarda cada nota em um arquivo
`.md` comum, com frontmatter YAML. Não existe servidor, porta aberta ou banco de
dados: o diretório `~/HashiMemo/notes/` **é** o estado do aplicativo. Qualquer
agente, script ou editor de texto que saiba escrever um arquivo consegue ler e
editar suas notas — e a interface reage na hora.

O núcleo é Rust + Tauri v2 com WebView do sistema, sem runtime embutido e sem
Electron. A interface segue o tema Catppuccin Mocha.

## ✨ Recursos

**Disponível nesta versão**

- **Rail encaixado** na borda direita, largura de 360 px, altura da área útil do monitor
- **Três níveis de janela**: Docked (rail), Foco (70% centralizado) e Maximizado (100%), com animação de 180 ms e `Esc` para voltar
- **Toggle de encaixe**: com o encaixe ligado a janela fica no topo e fora da barra de tarefas; desligado, move-se livremente e lembra a posição
- **Bandeja do sistema** com mostrar/ocultar e sair; fechar a janela apenas a esconde
- **Instância única**: abrir o app de novo traz o rail de volta
- **Ícone próprio** vetorial no executável, na janela e na bandeja
- **Hyprland/Wayland**: detecta o compositor e usa `hyprctl dispatch` para posicionar, fixar e redimensionar, já que Wayland não permite posicionamento absoluto pelo cliente

- **Notas em `.md`** individuais com frontmatter YAML, escrita atômica e rename pelo título
- **Watcher** (`notify`, 250 ms) que reflete edições externas e da CLI na hora
- **Grupos, cores, `pinned` e `order`** por nota, com `mtime` guard e aviso de conflito
- **CLI `hashimemo`** (`new`, `list`, `read`, `search`, `edit`, `rm`, `context`, `path`) com `--json`
- **Escala de fonte** de 80% a 160% e **autostart** persistidos em `settings.json`

**Planejado (roadmap abaixo)**

- Imagens, GIFs e vídeos curtos colados ou arrastados, salvos com nome UUID em `media/`
- Cofre com PIN para notas sensíveis

## 📄 Estrutura das notas

Contrato de arquivos estável desde o primeiro commit (implementação em andamento):

```markdown
---
id: 0193b5f2-6a1e-7c3d-9f10-2b8c4d5e6f70
title: Docking no Wayland
color: mauve
group: Arquitetura
order: 1.5
pinned: true
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
| `group` | texto | pasta lógica da nota |
| `order` | número | posição no rail (reordenação sem reescrever as outras notas) |
| `pinned` | booleano | nota fixada no topo do rail |
| `created` / `updated` | RFC 3339 | datas de criação e última escrita |

Regras do formato:

- Nome do arquivo é o slug do título (`notes/2026-11-17-docking-no-wayland.md`).
- Chaves YAML desconhecidas são preservadas — a IA pode adicionar metadados próprios.
- A escrita é atômica (arquivo temporário + `rename`) e protegida por `mtime`: se o arquivo mudou por fora enquanto você editava, a interface avisa em vez de sobrescrever.

## 🚀 Instalação

### Windows 10/11

Pré-requisitos para compilar:

```powershell
# Rust + toolchain
winget install Rustlang.Rustup

# WebView2 (já vem no Windows 11)
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

> O toolchain `stable-msvc` é o caminho oficial do Tauri. O projeto também compila
> com `stable-x86_64-pc-windows-gnu` + MinGW, que é o ambiente usado no
> desenvolvimento atual.

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

## 🪟 Hyprland / Wayland

Wayland não permite que um cliente se posicione na tela, e o Hyprland é quem
decide onde a janela fica. O HashiMemo detecta a variável
`HYPRLAND_INSTANCE_SIGNATURE` e aplica `setfloating`, `pin` e o tamanho/posição
via `hyprctl dispatch` (usando o `address` da janela obtido de `hyprctl clients -j`).

Se preferir regras estáticas, adicione ao `~/.config/hypr/hyprland.conf`:

```conf
windowrulev2 = float,class:^(HashiMemo)$
windowrulev2 = pin,class:^(HashiMemo)$
windowrulev2 = size 360 100%,class:^(HashiMemo)$
windowrulev2 = move 100%-360 0,class:^(HashiMemo)$
windowrulev2 = noborder,class:^(HashiMemo)$
windowrulev2 = noshadow,class:^(HashiMemo)$
```

Confirme a classe real da janela com `hyprctl clients | grep class` e ajuste o
regex. Em X11 e no Windows o posicionamento é feito pela própria janela.

## ⌨️ CLI

O mesmo binário aceita subcomandos e **não abre a interface** quando chamado
assim. Nada de socket ou HTTP: a CLI escreve e lê os mesmos arquivos que o app
monitora.

```bash
hashimemo new "revisar o parser de mídia" --color blue --group dev
hashimemo list                        # tabela: id, título, grupo, updated
hashimemo list --json                 # saída para scripts e agentes
hashimemo read 0193b5f2               # id, prefixo de id ou slug
hashimemo search "wayland"            # busca em título e corpo
hashimemo context --notes 5           # últimas notas em formato de prompt
hashimemo edit 0193b5f2 --append "..." # acrescenta sem reescrever
hashimemo rm 0193b5f2                 # remove a nota (arquivo .md)
```

## 📥 Migração do Sticky Notes

As 22 notas exportadas do Sticky Notes viraram 13 arquivos, organizados em seis
grupos (`Acessos`, `Grafana`, `Docker`, `Infra`, `Banpará`, `Projetos`). O que era
duplicado ou curto demais foi mesclado:

- itens 9 e 10 (idênticos), 20 e 7 entraram em **Acessos e credenciais**
- itens 21 e 22 viraram **Docker — comandos básicos e de imagem**
- itens 17 e 6 viraram **Fluxo de entrega no Banpará**
- itens 2, 15, 16 e 18 viraram **Projetos — notas soltas**

O restante ficou como nota própria. O texto original está em
`import/Notas do Sticky Notes Copiadas Manualmente.txt`, fora do git.

## 🤖 Integração com OpenCode

O fluxo é o mesmo de qualquer arquivo de projeto:

```bash
# durante uma sessão no OpenCode
hashimemo new "decisões da refatoração" --group arquitetura
hashimemo context --notes 3 >> /tmp/contexto.md
```

Como as notas são Markdown puro, também funcionam sem a CLI: aponte o agente para
`~/HashiMemo/notes/`, e o watcher do HashiMemo reflete cada alteração no rail
em tempo real. O caminho inverso vale igual — escrever no rail atualiza o
arquivo que o agente lê na próxima rodada.

## 🗂️ Estrutura do repositório

```text
hashimemo/
├── src/                    # React + TypeScript + TailwindCSS (Catppuccin Mocha)
│   ├── App.tsx             # rail, cards, editor, configurações
│   └── styles/app.css      # tokens do tema
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs          # tray, instância única, hotkey e comandos IPC
│   │   ├── main.rs         # CLI (clap) e abertura da GUI
│   │   ├── notes/
│   │   │   ├── mod.rs      # comandos IPC e watcher
│   │   │   └── store.rs    # frontmatter, CRUD, escrita atômica
│   │   ├── settings.rs     # escala de fonte e autostart
│   │   └── window/
│   │       ├── mod.rs      # estado, geometria e comandos de nível
│   │       ├── anim.rs     # animação de resize (180 ms, ease-out-cubic)
│   │       ├── hypr.rs     # posicionamento via hyprctl
│   │       └── win.rs      # borda, cantos e tema escuro no Windows
│   ├── capabilities/       # permissões da janela
│   ├── icons/icon.svg      # ícone vetorial de origem
│   └── tauri.conf.json
└── package.json
```

## 🗺️ Roadmap

- [x] Estrutura Tauri v2 + React + Tailwind com tema Catppuccin
- [x] Rail encaixado, níveis Foco/Maximizado e toggle de encaixe
- [x] Bandeja, instância única e ícone próprio
- [x] Notas `.md` com frontmatter, escrita atômica e `mtime` guard
- [x] Watcher (`notify`) com atualização instantânea da interface
- [ ] Mídia por colar/arrastar em `media/`
- [x] CLI com `clap` e saída JSON
- [x] Grupos, cores, ordenação e destaque
- [x] Atalho global e autostart
- [ ] Builds automatizados para Windows e Arch

## 📜 Licença

GPL-3.0 — veja [LICENSE](LICENSE).
