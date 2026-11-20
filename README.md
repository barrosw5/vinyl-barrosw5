# 💿 vinyl-now-playing

Um vinil em ASCII a rodar, com a última música que ouviste no **limusic** (através do **Last.fm**), para pores no README do teu perfil do GitHub.

```
limusic ──scrobble──▶ Last.fm ──API──▶ Vercel (/api/vinyl) ──SVG──▶ README do perfil
```

---

## Como funciona (em 30 segundos)

1. O limusic envia cada música que ouves para o Last.fm (isso chama-se *scrobble*).
2. Este projeto tem um **endpoint** (`/api/vinyl`) que, sempre que alguém abre o teu perfil:
   - pergunta ao Last.fm qual foi a tua última música (`lib/lastfm.ts`);
   - desenha 48 frames do vinil em ASCII + espectro (`lib/render.ts`);
   - junta tudo num **SVG animado** e devolve-o.
3. O README do teu perfil tem só um `<img>` a apontar para esse endpoint.

O GitHub não corre código no README, mas mostra imagens. E um SVG pode ter animações em CSS lá dentro. É esse o truque. 🙂

---

## Estrutura

```
vinyl-now-playing/
├── api/vinyl.ts        ← o endpoint (o Vercel transforma isto num URL)
├── lib/lastfm.ts       ← vai buscar a última música
├── lib/render.ts       ← desenha o vinil e gera o SVG  ← é aqui que brincas
├── scripts/preview.ts  ← gera SVGs de teste no teu PC
├── .env.example        ← modelo para as tuas chaves
└── package.json
```

---

## Passo 0 — O que precisas

- [ ] **Node.js 20 ou mais recente** → https://nodejs.org (instala a versão LTS). Confirma no terminal com `node -v`.
- [ ] **Git** (já deves ter, por causa do limusic).
- [ ] Conta no **GitHub** ✅
- [ ] Conta no **Last.fm** com o limusic ligado ✅
- [ ] Conta no **Vercel** → https://vercel.com/signup → entra com **"Continue with GitHub"** (gratuito, plano *Hobby*).

---

## Passo 1 — Confirmar que o Last.fm está a receber as músicas

1. Põe uma música a tocar no limusic.
2. Abre `https://www.last.fm/user/O_TEU_USER`.
3. Deve aparecer em "Recent Tracks" (às vezes com "Scrobbling now").

Se não aparecer, revê a ligação ao Last.fm nas definições do limusic antes de continuar.

---

## Passo 2 — Criar a API key do Last.fm

1. Vai a https://www.last.fm/api/account/create (com sessão iniciada).
2. Preenche:
   - **Contact email:** o teu email
   - **Application name:** `vinyl-now-playing`
   - **Application description:** `Vinil ASCII para o meu README`
   - **Callback URL** e **Application homepage:** deixa em branco
3. Carrega em **Submit**.
4. Guarda a **API key** (a string comprida). O *Shared secret* não é preciso.

> ⚠️ Não ponhas a API key em nenhum ficheiro que vá para o GitHub. Ela vive só no `.env` (no teu PC) e nas definições do Vercel.

---

## Passo 3 — Experimentar no teu PC

Abre a pasta do projeto no VS Code e abre o terminal (**Ctrl + `**).

```bash
npm install
npm run preview
```

Isto cria dois ficheiros de teste com músicas inventadas:
- `preview-playing.svg` → disco a rodar ("a ouvir agora")
- `preview-paused.svg` → disco parado ("ouvido por último · há 17 min")

**Arrasta-os para o Chrome/Edge** para ver a animação (a pré-visualização do VS Code nem sempre anima).

### Testar com o teu Last.fm a sério

1. Copia `.env.example` para um ficheiro novo chamado `.env`.
2. Preenche:
   ```
   LASTFM_USER=o_teu_user
   LASTFM_API_KEY=a_tua_api_key
   ```
3. Corre outra vez `npm run preview` → aparece também `preview-real.svg` com a tua última música. 🎉

---

## Passo 4 — Pôr o projeto no GitHub

Isto é um repositório **novo e separado** (não é o do perfil).

1. Em https://github.com/new cria um repositório chamado `vinyl-now-playing` (público ou privado, tanto faz). **Não** marques "Add a README".
2. No terminal do VS Code, dentro da pasta do projeto:
   ```bash
   git init
   git add .
   git commit -m "vinil ascii now playing"
   git branch -M main
   git remote add origin https://github.com/barrosw5/vinyl-now-playing.git
   git push -u origin main
   ```
3. Confirma no GitHub que **não** aparece nenhum `.env` nem `node_modules` (o `.gitignore` trata disso).

---

## Passo 5 — Publicar no Vercel

1. Vai a https://vercel.com/new
2. Em **Import Git Repository**, escolhe `vinyl-now-playing` → **Import**.
   (Se não aparecer, carrega em "Adjust GitHub App Permissions" e dá acesso a esse repo.)
3. **Framework Preset:** `Other`. Não mexas em Build/Output.
4. Abre **Environment Variables** e adiciona as duas:
   | Name | Value |
   |---|---|
   | `LASTFM_USER` | o teu user do Last.fm |
   | `LASTFM_API_KEY` | a tua API key |
5. Carrega em **Deploy** e espera ~1 minuto.
6. Vais ter um URL tipo `https://vinyl-now-playing-xxxx.vercel.app`. Testa:

   👉 `https://vinyl-now-playing-xxxx.vercel.app/api/vinyl`

   Tens de ver o disco com a tua música. Se vires, a parte difícil está feita. ✅

> A partir de agora, cada `git push` para o `main` faz deploy automático. Mudas o desenho → push → o perfil atualiza sozinho.

---

## Passo 6 — Pôr no README do teu perfil

O GitHub tem um **repositório especial**: se tiver **exatamente o mesmo nome que o teu username**, o `README.md` dele aparece no topo do teu perfil.

1. Vai a https://github.com/new
2. **Repository name:** `barrosw5` (igual ao username). O GitHub mostra uma mensagem tipo *"✨ You found a secret! barrosw5/barrosw5 is a special repository…"* — é isso mesmo.
3. Marca **Public** e marca **Add a README file** → **Create repository**.
4. No repo, abre o `README.md` → ícone do **lápis ✏️** (Edit).
5. Cola isto (troca o URL pelo teu):
   ```html
   <p align="center">
     <a href="https://www.last.fm/user/O_TEU_USER">
       <img src="https://vinyl-now-playing-xxxx.vercel.app/api/vinyl" alt="A música que estou a ouvir" />
     </a>
   </p>
   ```
   (O `<a>` faz com que clicar no disco abra o teu Last.fm. Opcional.)
6. **Commit changes…** → **Commit changes**.
7. Abre https://github.com/barrosw5 → o disco está lá a rodar. 💿

> Já tens o repo `barrosw5`? Então salta os pontos 1–3 e edita o README que lá está.

---

## Problemas comuns

| Problema | Solução |
|---|---|
| Imagem partida no perfil | Abre o URL `/api/vinyl` diretamente. Se der erro, vê **Vercel → o projeto → Logs**. |
| Diz "sem dados do last.fm" | Variáveis mal escritas no Vercel (têm de ser exatamente `LASTFM_USER` e `LASTFM_API_KEY`). Depois de as mudar, faz **Redeploy**. |
| A música não atualiza | O GitHub guarda a imagem em cache por uns minutos. Espera um pouco e faz **Ctrl+F5**. |
| Letras desalinhadas | Depende da fonte monoespaçada do sistema de quem vê. Ajusta `CHAR_W` em `lib/render.ts`. |
| `npm` não é reconhecido | O Node não está instalado ou o terminal foi aberto antes. Reinstala o Node e reabre o VS Code. |

---

## Personalizar (a parte divertida)

Tudo em `lib/render.ts`:

- **Cores** → objeto `COLORS` no topo.
- **Velocidade** → `FRAME_MS` (menos = mais rápido).
- **Suavidade** → `FRAMES` (mais frames = mais suave, mas SVG maior; 48 ≈ 100 KB).
- **Aspeto dos sulcos** → `Math.sin(r * 45)` em `vinylFrame` (experimenta 30 ou 70).
- **Caracteres** → `SHADE = " .:-=+*#%@"` (experimenta `" ░▒▓█"`).
- **O braço do gira-discos** → lista `arm` (linha, coluna, caractere).
- **Ideias para ires mais longe:**
  - fazer o reflexo de luz vir do lado do braço;
  - mostrar as 3 últimas músicas por baixo;
  - mudar a cor do espectro consoante o artista (usa o `hash()`).

Depois de mudares: `npm run preview` para ver no PC → `git push` para ir para o perfil.
