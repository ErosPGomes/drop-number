# Drop Number

Puzzle mobile no estilo *Drop the Number*: solte blocos numerados em 5 colunas, combine iguais
e multiplique. Web app (PWA) instalável na tela inicial, roda offline, sem dependências de runtime.

## Como jogar

- **Toque** em uma coluna para soltar o bloco. **Arraste** para escolher a coluna e solte o dedo para largar.
- Blocos iguais adjacentes (abaixo, esquerda, direita, acima) se fundem: `v × 2^k`, onde `k` é o número de
  vizinhos absorvidos (2 blocos de 8 → 16; 3 → 32; 4 → 64).
- Fusões em cascata geram **combos** (pontos + moedas extras).
- A barra de tempo solta o bloco automaticamente quando zera.
- Coluna cheia só aceita o bloco se o topo tiver o mesmo valor.
- **Martelo**: destrói um bloco. **Super martelo**: destrói todos os blocos com o número escolhido.
  Sem cargas, cada uso custa 100 moedas.
- Teclado (desktop): `←/→` move, `Espaço/↓/Enter` solta, `1–5` solta direto na coluna, `P/Esc` pausa.

## Animações

Queda com aceleração e *stretch*, *squash* elástico no pouso com poeira, fusão com deslize dos absorvidos +
flash + pulso + partículas + estrelas, texto flutuante de pontos, banners de combo, tremor de tela proporcional
ao combo, gravidade com quique, moldura dourada animada no maior bloco, zona de perigo pulsante, contorno de
pouso (ghost), aparição do próximo bloco com *overshoot*, martelo com tremida e estilhaços, celebração de novo
bloco (raios girando + confete), recorde, fim de jogo em cascata de dessaturação, reinício derrubando os blocos.

## Desenvolvimento

```bash
npm install
npm run dev        # servidor local com --host (abra pelo IP no celular, mesma rede)
npm test           # testes das regras (Vitest)
npm run build      # typecheck + build de produção em dist/
```

## Arquitetura

| Camada | Arquivo | Responsabilidade |
| --- | --- | --- |
| Regras | `src/core/board.ts` | Tabuleiro puro; cada jogada devolve uma lista de `Step` (merge/fall). Testável sem DOM. |
| Spawn | `src/core/spawn.ts` | Faixa de valores em função do maior bloco; RNG injetável. |
| Animação | `src/engine/tween.ts` | Tweens baseados em Promise, dirigidos pelo loop principal (sem timers). |
| Render | `src/render/*` | Canvas 2D em unidades de grade (resize-safe), partículas com pool limitado. |
| Controle | `src/game/controller.ts` | Máquina de estados; sequencia `Step`s com async/await. |
| UI | `src/ui/hud.ts`, `src/style.css` | HUD em DOM com animações CSS. |
| Áudio | `src/audio/sfx.ts` | Efeitos sintetizados via WebAudio (zero assets). |

Separar simulação (síncrona, determinística) de apresentação (assíncrona) elimina estados intermediários
inconsistentes: o tabuleiro lógico já está resolvido quando a animação começa, e a entrada do usuário é
ignorada fora dos estados `aim`/`hammer`/`super`.

## Deploy

O workflow `.github/workflows/deploy.yml` publica no GitHub Pages a cada push em `main`
(ative em *Settings → Pages → Source: GitHub Actions*). O build usa caminhos relativos (`base: './'`).
