import { HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr'

/**
 * Conecta ao hub e entra no grupo do projeto.
 * Retorna a conexão (para stop) e cleanup.
 */
export async function conectarAoProjeto(baseUrl, idDoProjeto, handlers) {
  const conexao = new HubConnectionBuilder()
    .withUrl(`${baseUrl.replace(/\/$/, '')}/hubs/quadros`)
    .withAutomaticReconnect([0, 1000, 2000, 5000])
    .configureLogging(LogLevel.Warning)
    .build()

  conexao.on('quadroProcessado', (evento) => handlers.onQuadroProcessado?.(evento))
  conexao.on('projetoConsolidado', (evento) => handlers.onProjetoConsolidado?.(evento))

  await conexao.start()
  if (conexao.state === HubConnectionState.Connected) {
    await conexao.invoke('EntrarNoProjeto', idDoProjeto)
  }

  conexao.onreconnected(async () => {
    try {
      await conexao.invoke('EntrarNoProjeto', idDoProjeto)
    } catch {
      // reconnect — próximo poll cobre o gap
    }
  })

  return conexao
}

export function urlDoQuadro(baseUrl, idDoProjeto, numeroSequencial, cacheBust) {
  const base = baseUrl.replace(/\/$/, '')
  return `${base}/projetos/${idDoProjeto}/quadros/${numeroSequencial}?t=${cacheBust ?? Date.now()}`
}
