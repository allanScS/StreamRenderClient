const API_PADRAO = 'http://localhost:8080'

export async function verificarSaude(baseUrl, { signal } = {}) {
  const controlador = new AbortController()
  const encerrarPorTimeout = setTimeout(() => controlador.abort(), 2500)

  if (signal) {
    if (signal.aborted) {
      clearTimeout(encerrarPorTimeout)
      throw new DOMException('Aborted', 'AbortError')
    }
    signal.addEventListener('abort', () => controlador.abort(), { once: true })
  }

  try {
    const resposta = await fetch(`${baseUrl}/saude?t=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      mode: 'cors',
      signal: controlador.signal,
    })
    if (!resposta.ok) {
      throw new Error(`API respondeu ${resposta.status}`)
    }
    return await resposta.json()
  } finally {
    clearTimeout(encerrarPorTimeout)
  }
}

export async function enviarProjeto(baseUrl, { nomeDoProjeto, arquivo, onProgresso }) {
  return new Promise((resolve, reject) => {
    const formulario = new FormData()
    formulario.append('nomeDoProjeto', nomeDoProjeto)
    formulario.append('video', arquivo)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${baseUrl}/projetos`)

    xhr.upload.onprogress = (evento) => {
      if (evento.lengthComputable && onProgresso) {
        onProgresso(Math.round((evento.loaded / evento.total) * 100))
      }
    }

    xhr.onload = () => {
      let corpo = null
      try {
        corpo = JSON.parse(xhr.responseText)
      } catch {
        corpo = { mensagem: xhr.responseText }
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(corpo)
      } else {
        reject(new Error(corpo?.mensagem || corpo?.title || `Falha no upload (${xhr.status})`))
      }
    }

    xhr.onerror = () => reject(new Error('Não foi possível enviar o vídeo. Confira se a API está no ar.'))
    xhr.send(formulario)
  })
}

export async function consultarProjeto(baseUrl, idDoProjeto) {
  const resposta = await fetch(`${baseUrl}/projetos/${idDoProjeto}`)
  if (!resposta.ok) {
    throw new Error(`Não foi possível consultar o projeto (${resposta.status})`)
  }
  return resposta.json()
}

export function urlDoVideo(baseUrl, idDoProjeto) {
  return `${baseUrl}/projetos/${idDoProjeto}/video`
}

export function urlDoQuadro(baseUrl, idDoProjeto, numeroSequencial, cacheBust) {
  return `${baseUrl}/projetos/${idDoProjeto}/quadros/${numeroSequencial}?t=${cacheBust ?? Date.now()}`
}

export function carregarBaseUrlSalva() {
  return localStorage.getItem('streamrender.apiBaseUrl') || API_PADRAO
}

export function salvarBaseUrl(url) {
  localStorage.setItem('streamrender.apiBaseUrl', url)
}

export { API_PADRAO }
