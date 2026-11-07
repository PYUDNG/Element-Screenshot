function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** `element-screenshot-example.com-20260101-120000.png` */
export function buildScreenshotName(url: string, date = new Date()): string {
  let host: string
  try {
    host = new URL(url).hostname || 'page'
  } catch {
    host = 'page'
  }

  host =
    host
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'page'

  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`

  return `element-screenshot-${host}-${stamp}.png`
}
