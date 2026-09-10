import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  API_PADRAO,
  carregarBaseUrlSalva,
  consultarProjeto,
  enviarProjeto,
  salvarBaseUrl,
  urlDoVideo,
  verificarSaude,
} from './api.js'

function formatarBytes(bytes) {
  if (!bytes) return '0 B'
  const unidades = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), unidades.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${unidades[i]}`
}

export default function App() {
  const [baseUrl, setBaseUrl] = useState(carregarBaseUrlSalva)
  const [apiOnline, setApiOnline] = useState(null)
  const [verificando, setVerificando] = useState(false)
  const [nomeDoProjeto, setNomeDoProjeto] = useState('')
  const [arquivo, setArquivo] = useState(null)
  const [arrastando, setArrastando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [progressoUpload, setProgressoUpload] = useState(0)
  const [erro, setErro] = useState('')
  const [projeto, setProjeto] = useState(null)
  const [situacao, setSituacao] = useState(null)
  const inputArquivoRef = useRef(null)
  const pollRef = useRef(null)

  const checarApi = useCallback(async (url = baseUrl, { silencioso = false } = {}) => {
    if (!silencioso) setVerificando(true)
    try {
      await verificarSaude(url.replace(/\/$/, ''))
      setApiOnline(true)
      salvarBaseUrl(url.replace(/\/$/, ''))
      setErro((atual) => (atual.includes('API local') ? '' : atual))
    } catch {
      setApiOnline(false)
    } finally {
      if (!silencioso) setVerificando(false)
    }
  }, [baseUrl])

  useEffect(() => {
    checarApi(baseUrl)
    const id = setInterval(() => checarApi(baseUrl, { silencioso: true }), 2000)
    return () => clearInterval(id)
  }, [checarApi, baseUrl])

  useEffect(() => {
    if (!projeto?.idDoProjeto || !apiOnline) return undefined

    const base = baseUrl.replace(/\/$/, '')
    const tick = async () => {
      try {
        const dados = await consultarProjeto(base, projeto.idDoProjeto)
        setSituacao(dados)
        if (dados.consolidado) {
          clearInterval(pollRef.current)
        }
      } catch (e) {
        setErro(e.message)
      }
    }

    tick()
    pollRef.current = setInterval(tick, 1500)
    return () => clearInterval(pollRef.current)
  }, [projeto, apiOnline, baseUrl])

  const previewUrl = useMemo(() => (arquivo ? URL.createObjectURL(arquivo) : null), [arquivo])

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  function escolherArquivo(file) {
    if (!file) return
    if (!file.type.startsWith('video/') && !file.name.match(/\.(mp4|webm|mov|mkv|avi|gif)$/i)) {
      setErro('Envie um arquivo de vídeo (mp4, webm, mov, mkv, avi ou gif).')
      return
    }
    setErro('')
    setArquivo(file)
    if (!nomeDoProjeto) {
      setNomeDoProjeto(file.name.replace(/\.[^.]+$/, ''))
    }
  }

  async function onSubmit(evento) {
    evento.preventDefault()
    if (!apiOnline) {
      setErro('A API local não está respondendo. Suba o StreamRender e tente de novo.')
      return
    }
    if (!arquivo) {
      setErro('Selecione um vídeo para enviar.')
      return
    }

    setEnviando(true)
    setErro('')
    setProgressoUpload(0)
    setProjeto(null)
    setSituacao(null)

    try {
      const base = baseUrl.replace(/\/$/, '')
      const resposta = await enviarProjeto(base, {
        nomeDoProjeto: nomeDoProjeto || arquivo.name,
        arquivo,
        onProgresso: setProgressoUpload,
      })
      setProjeto(resposta)
    } catch (e) {
      setErro(e.message)
    } finally {
      setEnviando(false)
    }
  }

  const progressoRender = situacao
    ? Math.round((situacao.quadrosConcluidos / Math.max(situacao.quadrosTotais, 1)) * 100)
    : 0

  return (
    <div className="page">
      <div className="glow" aria-hidden="true" />
      <header className="top">
        <div>
          <p className="brand">StreamRender</p>
          <h1>Envie um vídeo. A farm renderiza em paralelo.</h1>
          <p className="lead">
            Este cliente fala com a API na sua máquina. Deixe o Docker do StreamRender no ar
            e use o check abaixo antes de enviar.
          </p>
        </div>
        <div className={`status-pill ${apiOnline === true ? 'on' : apiOnline === false ? 'off' : ''}`}>
          <span className="dot" />
          {verificando && apiOnline === null && 'Verificando API…'}
          {apiOnline === true && 'API local online'}
          {apiOnline === false && 'API local offline'}
          {apiOnline === null && !verificando && 'Status desconhecido'}
        </div>
      </header>

      <section className="panel connection">
        <label htmlFor="apiUrl">URL da API (localhost)</label>
        <div className="row">
          <input
            id="apiUrl"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={API_PADRAO}
            spellCheck={false}
          />
          <button type="button" className="secondary" onClick={() => checarApi()} disabled={verificando}>
            {verificando ? 'Checando…' : 'Checar'}
          </button>
        </div>
        {apiOnline === false && (
          <p className="hint warn">
            Não encontrei <code>/saude</code> em {baseUrl}. Rode{' '}
            <code>docker compose up --build</code> na pasta StreamRender.
          </p>
        )}
      </section>

      <form className="panel upload" onSubmit={onSubmit}>
        <div
          className={`dropzone ${arrastando ? 'dragging' : ''} ${arquivo ? 'has-file' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setArrastando(true)
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => {
            e.preventDefault()
            setArrastando(false)
            escolherArquivo(e.dataTransfer.files?.[0])
          }}
          onClick={() => inputArquivoRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputArquivoRef.current?.click()
          }}
        >
          <input
            ref={inputArquivoRef}
            type="file"
            accept="video/*,.mp4,.webm,.mov,.mkv,.avi,.gif"
            hidden
            onChange={(e) => escolherArquivo(e.target.files?.[0])}
          />
          {previewUrl ? (
            <video className="preview" src={previewUrl} muted playsInline controls />
          ) : (
            <div className="drop-copy">
              <strong>Solte o vídeo aqui</strong>
              <span>ou clique para escolher · mp4, webm, mov, mkv…</span>
            </div>
          )}
        </div>

        {arquivo && (
          <p className="file-meta">
            {arquivo.name} · {formatarBytes(arquivo.size)}
          </p>
        )}

        <label htmlFor="nome">Nome do projeto</label>
        <input
          id="nome"
          value={nomeDoProjeto}
          onChange={(e) => setNomeDoProjeto(e.target.value)}
          placeholder="Ex.: Demo da apresentação"
        />

        {enviando && (
          <div className="progress-block">
            <div className="progress-label">
              <span>Upload</span>
              <span>{progressoUpload}%</span>
            </div>
            <div className="bar">
              <div style={{ width: `${progressoUpload}%` }} />
            </div>
          </div>
        )}

        {erro && <p className="hint error">{erro}</p>}

        <button type="submit" className="primary" disabled={enviando || !arquivo}>
          {enviando ? 'Enviando…' : 'Renderizar na farm'}
        </button>
      </form>

      {projeto && (
        <section className="panel result">
          <h2>Projeto em andamento</h2>
          <dl className="meta-grid">
            <div>
              <dt>ID</dt>
              <dd className="mono">{projeto.idDoProjeto}</dd>
            </div>
            <div>
              <dt>Quadros</dt>
              <dd>
                {situacao
                  ? `${situacao.quadrosConcluidos} / ${situacao.quadrosTotais}`
                  : `${projeto.quantidadeDeQuadros} enfileirados`}
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{situacao?.status ?? 'Aguardando workers…'}</dd>
            </div>
            {situacao?.idDoWorkerLider && (
              <div>
                <dt>Líder</dt>
                <dd className="mono">{situacao.idDoWorkerLider}</dd>
              </div>
            )}
          </dl>

          <div className="progress-block">
            <div className="progress-label">
              <span>Renderização</span>
              <span>{progressoRender}%</span>
            </div>
            <div className="bar">
              <div style={{ width: `${progressoRender}%` }} />
            </div>
          </div>

          {situacao?.consolidado && (
            <div className="done">
              <p>Vídeo pronto. Os workers terminaram e o líder montou o arquivo final.</p>
              <a
                className="primary link"
                href={urlDoVideo(baseUrl.replace(/\/$/, ''), projeto.idDoProjeto)}
                download
              >
                Baixar vídeo
              </a>
              <video
                className="result-video"
                src={urlDoVideo(baseUrl.replace(/\/$/, ''), projeto.idDoProjeto)}
                controls
              />
            </div>
          )}
        </section>
      )}

      <footer>
        Cliente estático · API em <code>localhost:8080</code> · sem autenticação
      </footer>
    </div>
  )
}
