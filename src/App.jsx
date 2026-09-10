import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  API_PADRAO,
  carregarBaseUrlSalva,
  consultarProjeto,
  enviarProjeto,
  salvarBaseUrl,
  urlDoQuadro,
  urlDoVideo,
  verificarSaude,
} from './api.js'
import { conectarAoProjeto } from './live.js'

const WORKERS = ['worker-1', 'worker-2', 'worker-3']

function formatarBytes(bytes) {
  if (!bytes) return '0 B'
  const unidades = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), unidades.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${unidades[i]}`
}

function estadoInicialWorkers() {
  return Object.fromEntries(
    WORKERS.map((id) => [id, { atual: null, contagem: 0, vistos: [], atualizadoEm: 0 }]),
  )
}

/**
 * Atualiza contagem e o quadro exibido.
 * Se surgirem frames novos desde o poll anterior, mostra o mais recente (por dataDeConclusao).
 */
function workersAPartirDaSituacao(situacao, anterior = null) {
  const mapa = estadoInicialWorkers()
  if (!situacao?.quadros?.length) return mapa

  const porWorker = Object.fromEntries(WORKERS.map((id) => [id, []]))

  for (const quadro of situacao.quadros) {
    const id = quadro.idDoWorkerProcessador
    if (!id || !porWorker[id]) continue
    if (quadro.status !== 'Concluído') continue
    porWorker[id].push(quadro)
  }

  for (const id of WORKERS) {
    const frames = porWorker[id]
    const numeros = frames.map((f) => f.numeroSequencial)
    const prev = anterior?.[id]
    const vistosAnteriores = new Set(prev?.vistos ?? [])
    const novos = frames.filter((f) => !vistosAnteriores.has(f.numeroSequencial))

    mapa[id].contagem = frames.length
    mapa[id].vistos = numeros

    if (novos.length > 0) {
      const escolhido = escolherMaisRecente(novos)
      mapa[id].atual = escolhido.numeroSequencial
      mapa[id].atualizadoEm = Date.now()
    } else if (prev?.atual != null && numeros.includes(prev.atual)) {
      mapa[id].atual = prev.atual
      mapa[id].atualizadoEm = prev.atualizadoEm
    } else if (frames.length > 0) {
      const escolhido = escolherMaisRecente(frames)
      mapa[id].atual = escolhido.numeroSequencial
      mapa[id].atualizadoEm = Date.now()
    }
  }

  return mapa
}

function escolherMaisRecente(frames) {
  return [...frames].sort((a, b) => {
    const ta = a.dataDeConclusao ? Date.parse(a.dataDeConclusao) : 0
    const tb = b.dataDeConclusao ? Date.parse(b.dataDeConclusao) : 0
    if (tb !== ta) return tb - ta
    return b.numeroSequencial - a.numeroSequencial
  })[0]
}

function mesclarQuadroNoWorker(atual, idWorker, numero) {
  const anterior = atual[idWorker] ?? { atual: null, contagem: 0, vistos: [], atualizadoEm: 0 }
  const jaVisto = anterior.vistos.includes(numero)
  const vistos = jaVisto ? anterior.vistos : [...anterior.vistos, numero]
  return {
    ...atual,
    [idWorker]: {
      atual: numero,
      contagem: Math.max(anterior.contagem, vistos.length),
      vistos,
      atualizadoEm: Date.now(),
    },
  }
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
  const [workers, setWorkers] = useState(estadoInicialWorkers)
  const [liveOk, setLiveOk] = useState(false)
  const inputArquivoRef = useRef(null)
  const pollRef = useRef(null)
  const hubRef = useRef(null)
  const saudeAbortRef = useRef(null)
  const saudeSeqRef = useRef(0)

  const base = baseUrl.replace(/\/$/, '')

  const checarApi = useCallback(async (url = baseUrl, { silencioso = false } = {}) => {
    if (!silencioso) setVerificando(true)

    saudeAbortRef.current?.abort()
    const controlador = new AbortController()
    saudeAbortRef.current = controlador
    const sequencia = ++saudeSeqRef.current

    try {
      await verificarSaude(url.replace(/\/$/, ''), { signal: controlador.signal })
      if (sequencia !== saudeSeqRef.current) return
      setApiOnline(true)
      salvarBaseUrl(url.replace(/\/$/, ''))
      setErro((atual) => (atual.includes('API local') ? '' : atual))
    } catch (erroChecagem) {
      if (erroChecagem?.name === 'AbortError') return
      if (sequencia !== saudeSeqRef.current) return
      setApiOnline(false)
    } finally {
      if (sequencia === saudeSeqRef.current && !silencioso) {
        setVerificando(false)
      }
    }
  }, [baseUrl])

  useEffect(() => {
    checarApi(baseUrl)
    const id = setInterval(() => checarApi(baseUrl, { silencioso: true }), 2000)
    return () => {
      clearInterval(id)
      saudeAbortRef.current?.abort()
    }
  }, [checarApi, baseUrl])

  useEffect(() => {
    if (!projeto?.idDoProjeto || !apiOnline) return undefined

    let cancelado = false

    const tick = async () => {
      try {
        const dados = await consultarProjeto(base, projeto.idDoProjeto)
        if (cancelado) return
        setSituacao(dados)
        setWorkers((anterior) => workersAPartirDaSituacao(dados, anterior))
        if (dados.consolidado) {
          clearInterval(pollRef.current)
        }
      } catch (e) {
        if (!cancelado) setErro(e.message)
      }
    }

    tick()
    pollRef.current = setInterval(tick, 1500)

    ;(async () => {
      try {
        await hubRef.current?.stop()
      } catch {
        // ignore
      }

      try {
        const conexao = await conectarAoProjeto(base, projeto.idDoProjeto, {
          onQuadroProcessado: (evento) => {
            const idWorker = evento.idDoWorker
            if (!WORKERS.includes(idWorker)) return
            setWorkers((atual) => mesclarQuadroNoWorker(atual, idWorker, evento.numeroSequencial))
          },
          onProjetoConsolidado: async () => {
            try {
              const dados = await consultarProjeto(base, projeto.idDoProjeto)
              setSituacao(dados)
              setWorkers((anterior) => workersAPartirDaSituacao(dados, anterior))
            } catch {
              // poll cobre
            }
          },
        })
        if (cancelado) {
          await conexao.stop()
          return
        }
        hubRef.current = conexao
        setLiveOk(true)
      } catch {
        if (!cancelado) setLiveOk(false)
      }
    })()

    return () => {
      cancelado = true
      clearInterval(pollRef.current)
      setLiveOk(false)
      hubRef.current?.stop().catch(() => {})
      hubRef.current = null
    }
  }, [projeto, apiOnline, base])

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
    setWorkers(estadoInicialWorkers())

    try {
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

  const totalVistos = WORKERS.reduce((acc, id) => acc + (workers[id]?.contagem ?? 0), 0)

  return (
    <div className="page wide">
      <div className="glow" aria-hidden="true" />
      <header className="top">
        <div className="intro">
          <p className="brand">StreamRender</p>
          <h1>Envie um vídeo. A farm renderiza em paralelo.</h1>
          <p className="lead">
            À esquerda você sobe o arquivo. À direita, cada worker mostra o quadro atual
            em tela cheia — competing consumers em tempo real.
          </p>
        </div>

        <div className="api-side">
          <div className={`status-pill ${apiOnline === true ? 'on' : apiOnline === false ? 'off' : ''}`}>
            <span className="dot" />
            {verificando && apiOnline === null && 'Verificando API…'}
            {apiOnline === true && 'API local online'}
            {apiOnline === false && 'API local offline'}
            {apiOnline === null && !verificando && 'Status desconhecido'}
          </div>
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
        </div>
      </header>

      <div className="workspace">
        <form className="panel upload" onSubmit={onSubmit}>
          <h2 className="panel-title">Entrada</h2>
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
                <span>{progressoUpload < 100 ? 'Upload' : 'Extraindo quadros…'}</span>
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

        <section className="panel farm">
          <div className="farm-head">
            <h2 className="panel-title">Farm ao vivo</h2>
            <span className={`live-pill ${liveOk ? 'on' : ''}`}>
              {projeto ? (liveOk ? 'SignalR conectado' : 'Aguardando live…') : 'Sem projeto'}
            </span>
          </div>

          {projeto ? (
            <>
              <dl className="meta-grid compact">
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
                <div>
                  <dt>Na farm</dt>
                  <dd>{totalVistos}</dd>
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
            </>
          ) : (
            <p className="hint farm-empty">
              Depois do upload, cada coluna troca o quadro atual pelo próximo que o worker
              processar. O número sobre a imagem é a posição real no vídeo.
            </p>
          )}

          <div className="worker-grid">
            {WORKERS.map((id) => {
              const slot = workers[id]
              const lider = situacao?.idDoWorkerLider === id
              const atual = slot?.atual ?? null
              const contagem = slot?.contagem ?? 0
              return (
                <article key={id} className={`worker-card ${lider ? 'leader' : ''}`}>
                  <header>
                    <strong className="mono">{id}</strong>
                    {lider && <span className="badge">líder</span>}
                  </header>
                  <div className="worker-stage">
                    {!projeto || atual == null ? (
                      <span className="waiting">
                        {projeto ? 'aguardando…' : 'ocioso'}
                      </span>
                    ) : (
                      <figure
                        key={`${id}-${atual}-${slot.atualizadoEm}`}
                        className="frame-view"
                      >
                        <img
                          src={urlDoQuadro(base, projeto.idDoProjeto, atual, slot.atualizadoEm)}
                          alt={`Quadro ${atual}`}
                        />
                        <span className="frame-badge" aria-label={`Posição ${atual} no vídeo`}>
                          #{atual}
                        </span>
                      </figure>
                    )}
                  </div>
                  <footer>
                    <span>{atual != null ? `quadro #${atual}` : '—'}</span>
                    <span>{projeto ? `${contagem} feitos` : '0 feitos'}</span>
                  </footer>
                </article>
              )
            })}
          </div>

          {situacao?.consolidado && projeto && (
            <div className="done">
              <p>Vídeo pronto. O líder montou o arquivo final.</p>
              <a
                className="primary link"
                href={urlDoVideo(base, projeto.idDoProjeto)}
                download
              >
                Baixar vídeo
              </a>
              <video
                className="result-video"
                src={urlDoVideo(base, projeto.idDoProjeto)}
                controls
              />
            </div>
          )}
        </section>
      </div>

      <footer>
        Cliente estático · SignalR em <code>/hubs/quadros</code> · API em{' '}
        <code>localhost:8080</code>
      </footer>
    </div>
  )
}
