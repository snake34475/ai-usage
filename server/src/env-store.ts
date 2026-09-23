import fs from 'node:fs/promises'
import path from 'node:path'

let pendingWrite = Promise.resolve()

function valueForEnv(value: string): string {
  return value.replaceAll('\r', '').replaceAll('\n', '')
}

function escaped(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function write(values: Record<string, string>): Promise<void> {
  const envPath = path.resolve(process.cwd(), '.env')
  let content = ''
  try {
    content = await fs.readFile(envPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  for (const [name, rawValue] of Object.entries(values)) {
    const value = valueForEnv(rawValue)
    const line = `${name}=${value}`
    const matcher = new RegExp(`^${escaped(name)}=.*$`, 'm')
    content = matcher.test(content)
      ? content.replace(matcher, line)
      : `${content}${content && !content.endsWith('\n') ? '\n' : ''}${line}\n`
    process.env[name] = value
  }
  const tempPath = `${envPath}.${process.pid}.tmp`
  await fs.writeFile(tempPath, content, { encoding: 'utf8', mode: 0o600 })
  await fs.rename(tempPath, envPath)
}

/** Serializes secret-file writes so concurrent providers cannot lose updates. */
export function updateServerEnv(values: Record<string, string>): Promise<void> {
  const operation = pendingWrite.then(() => write(values))
  pendingWrite = operation.catch(() => undefined)
  return operation
}
