# StreamRender Client

Cliente web (React + Vite) para enviar vídeos à API local do StreamRender.

Pensado para publicar como **site estático** (ex.: Render). O browser de quem abre o site fala com `http://localhost:8080` — a API precisa estar rodando **na máquina de quem testa**.

## Pré-requisitos

- Node via [nvs](https://github.com/jasongin/nvs) (ex.: `nvs use 22`)
- API StreamRender no ar (`docker compose up --build` na pasta `StreamRender`)

## Desenvolvimento

```powershell
nvs use 22
cd "D:\Pessoal\Projetos\Trabalho Edgar\StreamRenderClient"
npm install
npm run dev
```

Abra a URL do Vite (geralmente `http://localhost:5173`).

## Build (Render / estático)

```powershell
nvs use 22
npm install
npm run build
```

Publique a pasta `dist/`. No Render: Static Site, build command `npm run build`, publish directory `dist`.

## Fluxo

1. O cliente chama `GET /saude` a cada 2 segundos.
2. Se a API responder, libera o upload.
3. `POST /projetos` envia o vídeo (multipart).
4. Consulta `GET /projetos/{id}` até consolidar.
5. Oferece download em `GET /projetos/{id}/video`.

A URL da API padrão é `http://localhost:8080` (editável na tela e salva no `localStorage`).
