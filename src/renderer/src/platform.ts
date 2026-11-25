// The app's platform, from preload. Stand-ins without it (tests, browser previews) count as macOS.
export const isMac = (): boolean => (window.api?.platform ?? 'darwin') === 'darwin'
