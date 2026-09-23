import type { Usage, UsageMetric, UsageWindow } from '../types'

const titles: Record<string, string> = {
  opencode: 'OpenCode Go',
  workbuddy: 'WorkBuddy AI 额度',
  'trae-work': 'TRAE Work',
}

const providerClass: Record<string, string> = { opencode: 'opencode', workbuddy: 'workbuddy', 'trae-work': 'trae' }
const providerIcon: Record<string, string> = { opencode: 'O', workbuddy: 'W', 'trae-work': 'T' }

function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`
  return `${Math.floor(seconds / 86400)} days ago`
}

function number(value: number): string {
  return new Intl.NumberFormat().format(value)
}

export function UsageCard({ usage, index }: { usage: Usage, index: number }) {
  const windows = usage.windows?.length
    ? usage.windows
    : [{ label: 'Usage', used: usage.used, total: usage.total, remaining: usage.remaining, percent: usage.percent, resetAt: usage.resetAt }]
  return (
    <article className={`usage-card ${providerClass[usage.provider] ?? ''} ${usage.status === 'error' ? 'is-stale' : ''}`} style={{ animationDelay: `${index * 90}ms` }}>
      <header className="card-header"><span className="provider-icon" aria-hidden="true">{providerIcon[usage.provider] ?? 'A'}</span><span className="provider-title"><h2>{titles[usage.provider] ?? usage.provider}</h2><small>{usage.status === 'ok' ? '实时额度概览' : '保留最近一次成功数据'}</small></span>{usage.status === 'ok' && <strong className="headline-percent">{Math.round(Number.isFinite(usage.percent) ? Math.min(100, Math.max(0, usage.percent)) : 0)}<small>%</small></strong>}</header>
      {usage.total > 0 && windows.map((window) => <UsageWindowView key={window.label} window={window} />)}
      {usage.metrics?.length ? <MetricsView metrics={usage.metrics} /> : null}
      {usage.status === 'error' && <p className="warning">⚠ Unable to fetch latest data</p>}
      <p className="updated"><span className={`status-dot ${usage.status === 'ok' ? 'is-ok' : 'is-error'}`} />{usage.status === 'error' ? '最近一次成功更新：' : '更新于：'}{relativeTime(usage.updatedAt)}</p>
    </article>
  )
}

function MetricsView({ metrics }: { metrics: UsageMetric[] }) {
  return <dl className="metrics">
    {metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}
  </dl>
}

function UsageWindowView({ window }: { window: UsageWindow }) {
  const percent = Number.isFinite(window.percent) ? Math.min(100, Math.max(0, window.percent)) : 0
  if (window.total <= 0) return null
  return <div className="quota-window">
    <div className="card-heading"><h3>{window.label}</h3><span>{Math.round(percent)}%</span></div>
    <div className="progress" aria-label={`${window.label}: ${percent}% used`}><div style={{ width: `${percent}%` }} /></div>
    <dl><div><dt>已用</dt><dd>{number(window.used)}</dd></div><div><dt>总额度</dt><dd>{number(window.total)}</dd></div><div><dt>剩余</dt><dd>{number(window.remaining)}</dd></div></dl>
    {window.resetAt && <p className="reset">重置时间：{new Date(window.resetAt).toLocaleString()}</p>}
  </div>
}
