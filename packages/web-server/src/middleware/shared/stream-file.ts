import mime from 'mime'
import fs from 'fs'

interface Range {
  start: number
  end: number
  total: number
}

interface Options {
  /**
   * expires time, in seconds
   */
  maxAge: number
  immutable: boolean
  public: boolean
  hidden: boolean
  // setHeaders: <T>(ctx: T, filepath: string) => void
  // root: string
}

const getType = (filepath: string) => mime.getType(filepath) ?? 'application/octet-stream'

const parseRange = (total: number, range?: string) => {
  if (range == null || range.length === 0) return null

  let array = range.split(/bytes=(\d*)-(\d*)/)
  let result: Range = {
    start: parseInt(array[1]),
    end: parseInt(array[2]),
    total,
  }

  if (isNaN(result.end) || result.end < 0) {
    result.end = total - 1
  }

  if (isNaN(result.start) || result.start < 0) {
    result.start = 0
  }

  // if (result.start == 0 && result.end == total - 1) return null

  return result
}

const headRequest = (ctx: AnyListen.RequestContext, filepath: string, stats: fs.Stats) => {
  ctx.set('Content-Length', String(stats.size))
  ctx.set('Content-Type', getType(filepath))
  ctx.set('Accept-Ranges', 'bytes')
  ctx.set('Last-Modified', stats.mtime.toUTCString())
  ctx.status = 200
}

const endRequest = (ctx: AnyListen.RequestContext, size: number) => {
  ctx.set('Content-Range', `bytes */${size}`)
  ctx.body = null
  ctx.status = 416
}

const sendFile = (ctx: AnyListen.RequestContext, filepath: string, stats: fs.Stats, options: Options) => {
  ctx.set('Content-Type', getType(filepath))
  ctx.set('Content-Length', String(stats.size))
  ctx.set('Accept-Ranges', 'bytes')

  ctx.set('Last-Modified', stats.mtime.toUTCString())
  const directives = [`max-age=${options.maxAge}`]
  if (options.immutable) directives.push('immutable')
  if (options.public) directives.push('public')
  ctx.set('Cache-Control', directives.join(','))
  ctx.set('Expires', new Date(Date.now() + options.maxAge * 1000).toUTCString())

  ctx.body = fs.createReadStream(filepath)
}

const streamRange = (
  ctx: AnyListen.RequestContext,
  body: fs.ReadStream,
  range: Range,
  contentType: string,
  stats: fs.Stats,
  options: Options
) => {
  ctx.set('Content-Type', contentType)
  ctx.set('Content-Length', String(range.end - range.start + 1))
  ctx.set('Accept-Ranges', 'bytes')
  ctx.set('Last-Modified', stats.mtime.toUTCString())
  ctx.set('Content-Range', `bytes ${range.start}-${range.end}/${range.total}`)
  const directives = [`max-age=${options.maxAge}`]
  if (options.immutable) directives.push('immutable')
  if (options.public) directives.push('public')
  ctx.set('Cache-Control', directives.join(','))
  ctx.set('Expires', new Date(Date.now() + options.maxAge * 1000).toUTCString())
  // ctx.set('Cache-Control', 'no-cache')
  ctx.status = 206
  ctx.body = body
}

const handleFileStream = (ctx: AnyListen.RequestContext, range: Range, filepath: string, stat: fs.Stats, options: Options) => {
  let stream = fs.createReadStream(filepath, { start: range.start, end: range.end })
  let contentType = getType(filepath)
  streamRange(ctx, stream, range, contentType, stat, options)
}

const FILE_ERRORS = ['ENOENT', 'ENAMETOOLONG', 'ENOTDIR'] as const
const getFileStat = async (filepath: string) => {
  try {
    let stats = await fs.promises.stat(filepath)
    if (stats.isDirectory()) return false
    return stats
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
    if (FILE_ERRORS.includes(err.code)) return false
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    err.status = 500
    throw err as Error
  }
}

const isHidden = (path: string) => {
  const pathArr = path.split(/\/|\\/)
  return pathArr.some((s) => s.startsWith('.'))
}

export const handleRequest = async (ctx: AnyListen.RequestContext, filepath: string, options: Options) => {
  const stat = await getFileStat(filepath)
  if (!stat) return

  if (ctx.method == 'HEAD') {
    headRequest(ctx, filepath, stat)
    return
  }
  const range = parseRange(stat.size, ctx.headers.range)

  if (range == null) {
    sendFile(ctx, filepath, stat, options)
    return
  }

  if (range.start >= stat.size || range.end >= stat.size) {
    endRequest(ctx, stat.size)
    return
  }

  handleFileStream(ctx, range, filepath, stat, options)
}

export const sendFileStream = async (ctx: AnyListen.RequestContext, filepath: string, options: Partial<Options>) => {
  if (!options.hidden && isHidden(filepath)) return
  return handleRequest(ctx, filepath, {
    hidden: options.hidden ?? false,
    immutable: options.immutable ?? false,
    public: options.public ?? false,
    maxAge: options.maxAge ?? 0,
  })
}
