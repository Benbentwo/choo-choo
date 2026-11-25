/** Image types sent to the model as pictures; any other file goes as a path the agent reads. */
export const INLINE_IMAGE = /^image\/(png|jpeg|gif|webp)$/

export const MAX_ATTACHED_FILES = 20

/** Adds paths to the attached list: no duplicates, no empty paths, capped. */
export function addAttachedFiles(current: string[], paths: string[]): string[] {
  return [...new Set([...current, ...paths.filter(Boolean)])].slice(0, MAX_ATTACHED_FILES)
}

export function fileName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
}

/** The message as sent: what the person typed, then the attached files as paths for the agent to read. */
export function withAttachedFiles(text: string, paths: string[]): string {
  if (!paths.length) return text
  const typed = text.trim() || (paths.length === 1 ? 'See the attached file.' : 'See the attached files.')
  return `${typed}\n\nAttached files (read them from these paths):\n${paths.map((p) => `- ${p}`).join('\n')}`
}
