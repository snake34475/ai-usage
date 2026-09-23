import { useCallback, useEffect, useState } from 'react'
import { getUsage, refreshUsage } from './api'
import { UsageCard } from './components/UsageCard'
import type { UsageResponse } from './types'
import './index.css'

function relativeTime(iso: string | null): string {
  if (!iso) return '等待首次更新'
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return '刚刚更新'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前更新`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前更新`
  return `${Math.floor(seconds / 86400)} 天前更新`
}

function safePercent(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0
}

const providerNames: Record<string, string> = { opencode: 'OpenCode Go', workbuddy: 'WorkBuddy', 'trae-work': 'TRAE Work' }

export default function App() {
  const [data, setData] = useState<UsageResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const load = useCallback(async () => { try { setData(await getUsage()); setError(null) } catch { setError('Unable to load usage') } }, [])
  useEffect(() => { void load(); const id = window.setInterval(() => void load(), 60_000); return () => window.clearInterval(id) }, [load])
  async function refresh() { try { setRefreshing(true); setData(await refreshUsage()); setError(null) } catch { setError('Unable to refresh usage. Please wait and try again.') } finally { setRefreshing(false) } }
  if (!data && !error) return <main className="loading"><p>正在读取用量数据…</p></main>
  if (!data) return <main className="loading"><p className="warning">{error}</p><button className="refresh-button" onClick={() => void load()}>重新加载</button></main>
  return <>
    <div className="ambient" aria-hidden="true"><i /><i /><i /></div>
    <header className="topbar"><div className="topbar-inner">
      <div className="brand"><span className="brand-mark" aria-hidden="true">⌁</span><span><strong>AI 用量</strong><small>{relativeTime(data.updatedAt)}</small></span></div>
      <button className={`refresh-button ${refreshing ? 'is-refreshing' : ''}`} onClick={() => void refresh()} disabled={refreshing}><span aria-hidden="true">↻</span>{refreshing ? '刷新中' : '刷新'}</button>
    </div></header>
    <main className="dashboard">
      {error && <p className="warning global-warning">{error}</p>}
      <section className="overview" aria-label="用量概览">
        {data.providers.map((usage) => <div className="overview-item" key={usage.provider}><div><span className={`status-dot ${usage.status === 'ok' ? 'is-ok' : 'is-error'}`} /><span>{providerNames[usage.provider] ?? usage.provider}</span><b>{usage.status === 'ok' ? `${Math.round(safePercent(usage.percent))}%` : '—'}</b></div><i><em style={{ width: `${safePercent(usage.percent)}%` }} /></i></div>)}
      </section>
      <section className="usage-grid" aria-label="各平台用量">{data.providers.map((usage, index) => <UsageCard key={usage.provider} usage={usage} index={index} />)}</section>
      <footer><span className="status-dot is-ok" />服务端缓存每 5 分钟更新；页面每分钟读取一次最新缓存。</footer>
    </main>
  </>
}
