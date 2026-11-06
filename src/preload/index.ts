import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { Api, ChatEvent } from '@shared/types'

const inv = (ch: string) => (...a: unknown[]) => ipcRenderer.invoke(ch, ...a)
function on<T extends unknown[]>(ch: string, cb: (...a: T) => void) {
  const l = (_e: unknown, ...a: unknown[]) => cb(...(a as T))
  ipcRenderer.on(ch, l)
  return () => {
    ipcRenderer.removeListener(ch, l)
  }
}

const api: Api = {
  getState: inv('state:get') as Api['getState'],
  pickAndAddRepo: inv('repo:pick') as Api['pickAndAddRepo'],
  addRepo: inv('repo:add') as Api['addRepo'],
  removeRepo: inv('repo:remove') as Api['removeRepo'],
  setRepoHidden: inv('repo:hidden') as Api['setRepoHidden'],
  createWorkspace: inv('ws:create') as Api['createWorkspace'],
  openOrchestrator: inv('ws:orchestrator') as Api['openOrchestrator'],
  archiveWorkspace: inv('ws:archive') as Api['archiveWorkspace'],
  restoreWorkspace: inv('ws:restore') as Api['restoreWorkspace'],
  renameWorkspace: inv('ws:rename') as Api['renameWorkspace'],
  createChat: inv('chat:create') as Api['createChat'],
  closeChat: inv('chat:close') as Api['closeChat'],
  getChatItems: inv('chat:items') as Api['getChatItems'],
  updateChat: inv('chat:update') as Api['updateChat'],
  sendMessage: inv('chat:send') as Api['sendMessage'],
  stopChat: inv('chat:stop') as Api['stopChat'],
  respondPermission: (id, d) => ipcRenderer.send('permission:respond', id, d),
  pendingPermissions: inv('permission:pending') as Api['pendingPermissions'],
  addChatFolder: inv('chat:addFolder') as Api['addChatFolder'],
  removeChatFolder: inv('chat:removeFolder') as Api['removeChatFolder'],
  listFiles: inv('ws:files') as Api['listFiles'],
  listCommands: inv('ws:commands') as Api['listCommands'],
  getScripts: inv('scripts:get') as Api['getScripts'],
  runScript: inv('scripts:run') as Api['runScript'],
  stopScript: (id, kind) => ipcRenderer.send('scripts:stop', id, kind),
  isScriptRunning: inv('scripts:running') as Api['isScriptRunning'],
  getPr: inv('pr:get') as Api['getPr'],
  mergePr: inv('pr:merge') as Api['mergePr'],
  getChecks: inv('checks:get') as Api['getChecks'],
  rerunCheck: inv('checks:rerun') as Api['rerunCheck'],
  getArtifacts: inv('ws:artifacts') as Api['getArtifacts'],
  readFile: inv('ws:readFile') as Api['readFile'],
  revertTo: inv('chat:revert') as Api['revertTo'],
  saveSettings: inv('settings:save') as Api['saveSettings'],
  setZoom: (f) => webFrame.setZoomFactor(f),
  cloneRepo: inv('repo:clone') as Api['cloneRepo'],
  pickFolder: inv('folder:pick') as Api['pickFolder'],
  previewConductorImport: inv('conductor:preview') as Api['previewConductorImport'],
  importFromConductor: inv('conductor:import') as Api['importFromConductor'],
  listGithubRepos: inv('gh:repos') as Api['listGithubRepos'],
  quickStart: inv('repo:quickstart') as Api['quickStart'],
  listSources: inv('ws:sources') as Api['listSources'],
  onNavigate: (cb) => on<[string, string]>('navigate', cb),
  onChatEvent: (cb) => on<[ChatEvent]>('chat:event', cb),
  getChanges: inv('git:changes') as Api['getChanges'],
  getDiffStats: inv('git:stats') as Api['getDiffStats'],
  getFileDiff: inv('git:fileDiff') as Api['getFileDiff'],
  ptyCreate: inv('pty:create') as Api['ptyCreate'],
  ptyAttach: inv('pty:attach') as Api['ptyAttach'],
  onScriptStarted: (cb) => on<[string, 'setup' | 'run']>('script:started', cb),
  ptyWrite: (id, d) => ipcRenderer.send('pty:write', id, d),
  ptyResize: (id, c, r) => ipcRenderer.send('pty:resize', id, c, r),
  ptyKill: (id) => ipcRenderer.send('pty:kill', id),
  onPtyData: (cb) => on<[string, string]>('pty:data', cb),
  onPtyExit: (cb) => on<[string, number]>('pty:exit', cb),
  openExternal: inv('shell:open') as Api['openExternal'],
  revealInFinder: inv('shell:reveal') as Api['revealInFinder'],
  onMenu: (cb) => on<[string]>('menu', cb),
  onStateChanged: (cb) => on<[]>('state:changed', cb),
  onUpdateReady: (cb) => on<[string]>('update:ready', cb),
  installUpdate: inv('update:install') as Api['installUpdate'],
  shareStatus: inv('share:status') as Api['shareStatus'],
  shareWorkspace: inv('share:create') as Api['shareWorkspace'],
  setShareAutoSync: inv('share:autoSync') as Api['setShareAutoSync'],
  unshareWorkspace: inv('share:remove') as Api['unshareWorkspace'],
  listShares: inv('share:list') as Api['listShares'],
  openShare: inv('share:open') as Api['openShare'],
  openShareById: inv('share:openById') as Api['openShareById'],
  refreshShare: inv('share:refresh') as Api['refreshShare'],
  onOpenShareLink: (cb) => on<[string]>('share:link', cb)
}

contextBridge.exposeInMainWorld('api', api)

// Dev-only feedback mode (see src/main/devFeedback.ts).
if (process.env.ELECTRON_RENDERER_URL) {
  contextBridge.exposeInMainWorld('devFeedback', { submit: inv('devFeedback:submit') })
}
